import { supabase as defaultClient } from './supabaseClient.js';
import { changeOrderStatus } from './orders.js';
import { getNextStatus, STATUS_LABELS } from '../lib/orderStatusFlow.js';

// DELLVERY 3 — Adapter Kanban configurável (FASE 1)
// Compatibilidade com o legado (decisão Fase 1):
//  - `orders.status` (enum) continua fonte da verdade; escrita SEMPRE via
//    RPC manage_order (changeOrderStatus). Nenhum status novo é criado.
//  - `restaurant_order_stages` é apresentação/ordenação por company:
//    cada stage tem `key` + `mapsTo` (status legado efetivo).
//  - Avançar/voltar navega pelas stages VISÍVEIS (maps_to != cancelado)
//    e traduz para UMA transição de status legado por vez.
//  - Banco usa `sort_order` (padrão categories/products); aqui exposto
//    como `position` (mesmo padrão de catalog.js: order<->sort_order).

const withClient = (client) => client || defaultClient;

function mustBeConfigured(client) {
  const c = withClient(client);
  if (!c) throw new Error('Supabase não configurado (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)');
  return c;
}

function requireCompanyId(companyId) {
  if (!companyId) throw new Error('Empresa atual não definida');
  return companyId;
}

function rpcError(error) {
  const msg = error?.message || 'Erro na operação';
  throw new Error(msg);
}

// ---------- Seed / constantes ----------

export const LEGACY_STATUSES = [
  'novo',
  'confirmado',
  'em_preparo',
  'aguardando_retirada',
  'saiu_entrega',
  'finalizado',
  'cancelado',
];

// Espelho do seed da migration (etiquetas/cores/ordem atuais do Kanban).
export const LEGACY_STAGE_SEED = [
  { key: 'novo', mapsTo: 'novo', name: 'Novo', color: '#3b82f6', position: 0, isInitial: true, isFinal: false },
  { key: 'confirmado', mapsTo: 'confirmado', name: 'Confirmado', color: '#eab308', position: 1, isInitial: false, isFinal: false },
  { key: 'em_preparo', mapsTo: 'em_preparo', name: 'Em preparo', color: '#f97316', position: 2, isInitial: false, isFinal: false },
  { key: 'aguardando_retirada', mapsTo: 'aguardando_retirada', name: 'Pronto', color: '#a855f7', position: 3, isInitial: false, isFinal: false },
  { key: 'saiu_entrega', mapsTo: 'saiu_entrega', name: 'Saiu p/ entrega', color: '#6366f1', position: 4, isInitial: false, isFinal: false },
  { key: 'finalizado', mapsTo: 'finalizado', name: 'Finalizado', color: '#22c55e', position: 5, isInitial: false, isFinal: true },
  { key: 'cancelado', mapsTo: 'cancelado', name: 'Cancelado', color: '#ef4444', position: 6, isInitial: false, isFinal: false },
];

export const TERMINAL_MAPS_TO = ['finalizado', 'cancelado'];

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export function isValidHexColor(color) {
  return typeof color === 'string' && HEX_COLOR_RE.test(color.trim());
}

export function isLegacyStageKey(key) {
  return LEGACY_STATUSES.includes(key);
}

export function slugifyStageKey(name, suffix = '') {
  const base = (name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'etapa';
  return `${base}${suffix}`;
}

// ---------- Mapeamento ----------

export function fromSupabaseStage(row) {
  if (!row) return row;
  return {
    id: row.id,
    company_id: row.company_id,
    key: row.stage_key,
    mapsTo: row.maps_to,
    name: row.name,
    color: row.color,
    position: Number(row.sort_order) || 0,
    isInitial: !!row.is_initial,
    isFinal: !!row.is_final,
    active: row.active !== false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Whitelist do patch (nunca envia company_id/stage_key: proteção + trigger).
export function toSupabaseStagePatch(patch = {}, stageKey = null) {
  const out = {};
  if (patch.name !== undefined) {
    const name = String(patch.name || '').trim();
    if (!name) throw new Error('Nome da etapa é obrigatório');
    out.name = name;
  }
  if (patch.color !== undefined) {
    const color = String(patch.color || '').trim();
    if (!isValidHexColor(color)) throw new Error('Cor inválida (use hexadecimal, ex. #3b82f6)');
    out.color = color;
  }
  if (patch.position !== undefined) out.sort_order = Number(patch.position) || 0;
  if (patch.isInitial !== undefined) out.is_initial = !!patch.isInitial;
  if (patch.isFinal !== undefined) out.is_final = !!patch.isFinal;
  if (patch.active !== undefined) out.active = !!patch.active;
  // maps_to só para stages customizadas; chave legada tem mapeamento
  // travado no banco (trigger enforce_legacy_stage_mapping).
  if (patch.mapsTo !== undefined && stageKey && !isLegacyStageKey(stageKey)) {
    if (!LEGACY_STATUSES.includes(patch.mapsTo) || patch.mapsTo === 'cancelado') {
      throw new Error('Etapa customizada deve mapear para um status válido (exceto cancelado)');
    }
    out.maps_to = patch.mapsTo;
  }
  return out;
}

// ---------- Leitura ----------

export async function listStages(client, companyId) {
  const c = mustBeConfigured(client);
  const { data, error } = await c
    .from('restaurant_order_stages')
    .select('*')
    .eq('company_id', requireCompanyId(companyId))
    .order('sort_order', { ascending: true });
  if (error) rpcError(error);
  return (data || []).map(fromSupabaseStage);
}

// ---------- Escrita (RLS: OWNER/ADMIN/MANAGER; demais papéis bloqueados) ----------

function validateNewStage({ name, color, mapsTo }) {
  const cleanName = String(name || '').trim();
  if (!cleanName) throw new Error('Nome da etapa é obrigatório');
  const cleanColor = String(color || '#6366f1').trim();
  if (!isValidHexColor(cleanColor)) throw new Error('Cor inválida (use hexadecimal, ex. #3b82f6)');
  if (!LEGACY_STATUSES.includes(mapsTo) || mapsTo === 'cancelado') {
    throw new Error('Etapa customizada deve mapear para um status válido (exceto cancelado)');
  }
  return { name: cleanName, color: cleanColor, mapsTo };
}

export async function createStage(client, companyId, { name, color, mapsTo }) {
  const c = mustBeConfigured(client);
  const cid = requireCompanyId(companyId);
  const valid = validateNewStage({ name, color, mapsTo });
  const current = await listStages(c, cid);
  const stageKey = slugifyStageKey(valid.name, `-${Date.now().toString(36)}`);
  const position = current.length > 0 ? Math.max(...current.map((s) => s.position)) + 1 : 0;
  const { data, error } = await c
    .from('restaurant_order_stages')
    .insert({
      company_id: cid,
      stage_key: stageKey,
      maps_to: valid.mapsTo,
      name: valid.name,
      color: valid.color,
      sort_order: position,
      is_initial: false,
      is_final: false,
      active: true,
    })
    .select('*')
    .maybeSingle();
  if (error) rpcError(error);
  return fromSupabaseStage(data);
}

export async function updateStage(client, companyId, stageId, patch) {
  const c = mustBeConfigured(client);
  const cid = requireCompanyId(companyId);
  if (!stageId) throw new Error('Etapa não identificada');
  const current = await listStages(c, cid);
  const stage = current.find((s) => s.id === stageId);
  if (!stage) throw new Error('Etapa não encontrada ou sem permissão');
  const payload = toSupabaseStagePatch(patch, stage.key);
  if (Object.keys(payload).length === 0) return stage;
  const { data, error } = await c
    .from('restaurant_order_stages')
    .update(payload)
    .eq('id', stageId)
    .eq('company_id', cid)
    .select('*')
    .maybeSingle();
  if (error) rpcError(error);
  return fromSupabaseStage(data);
}

async function hasOrdersInStatus(client, companyId, status) {
  const c = mustBeConfigured(client);
  const { data, error } = await c
    .from('orders')
    .select('id')
    .eq('company_id', companyId)
    .eq('status', status)
    .limit(1);
  if (error) rpcError(error);
  return (data || []).length > 0;
}

export async function setStageActive(client, companyId, stageId, active) {
  const c = mustBeConfigured(client);
  const cid = requireCompanyId(companyId);
  if (active) return updateStage(c, cid, stageId, { active: true });
  const current = await listStages(c, cid);
  const stage = current.find((s) => s.id === stageId);
  if (!stage) throw new Error('Etapa não encontrada ou sem permissão');
  // Proteção: desativar a última coluna VISÍVEL de um status com pedidos
  // OPERACIONAIS deixaria esses pedidos sem coluna no fluxo. Com pedidos,
  // exige coluna irmã. Etapas terminais (finalizado/cancelado) guardam só
  // histórico: podem ser ocultadas mesmo com pedidos, sem mover/alterar nada.
  const visibleSibling = current.some(
    (s) => s.id !== stageId && s.mapsTo === stage.mapsTo && s.active,
  );
  const isTerminal = TERMINAL_MAPS_TO.includes(stage.mapsTo);
  if (!visibleSibling && !isTerminal && (await hasOrdersInStatus(c, cid, stage.mapsTo))) {
    throw new Error(
      `Existe pedido em "${stage.name}". Crie/mantenha outra etapa visível para este status antes de desativar.`,
    );
  }
  return updateStage(c, cid, stageId, { active: false });
}

export async function deleteStage(client, companyId, stageId) {
  const c = mustBeConfigured(client);
  const cid = requireCompanyId(companyId);
  const current = await listStages(c, cid);
  const stage = current.find((s) => s.id === stageId);
  if (!stage) throw new Error('Etapa não encontrada ou sem permissão');
  if (current.length <= 1) throw new Error('Não é possível excluir a última etapa do Kanban');
  // Proteção: sem coluna irmã para o mesmo status legado e com pedidos
  // nesse status, a exclusão deixaria pedidos sem coluna natural.
  const hasSibling = current.some((s) => s.id !== stageId && s.mapsTo === stage.mapsTo);
  if (!hasSibling && (await hasOrdersInStatus(c, cid, stage.mapsTo))) {
    throw new Error(
      `Existe pedido em "${stage.name}". Crie outra etapa para este status antes de excluir.`,
    );
  }
  const { error } = await c
    .from('restaurant_order_stages')
    .delete()
    .eq('id', stageId)
    .eq('company_id', cid);
  if (error) rpcError(error);
  return true;
}

export async function reorderStages(client, companyId, orderedIds) {
  const c = mustBeConfigured(client);
  const cid = requireCompanyId(companyId);
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    throw new Error('Ordem das etapas inválida');
  }
  const current = await listStages(c, cid);
  const currentIds = new Set(current.map((s) => s.id));
  // Validação anti cross-company/perda: mesmos ids, sem falta nem sobra.
  if (orderedIds.length !== current.length || !orderedIds.every((id) => currentIds.has(id))) {
    throw new Error('Ordem das etapas inválida (divergência com o servidor; recarregue)');
  }
  for (let i = 0; i < orderedIds.length; i += 1) {
    const { error } = await c
      .from('restaurant_order_stages')
      .update({ sort_order: i })
      .eq('id', orderedIds[i])
      .eq('company_id', cid);
    if (error) rpcError(error);
  }
  return listStages(c, cid);
}

// ---------- Fluxo puro (uma etapa por vez; cancelado fora do fluxo) ----------

export function sortStages(stages) {
  return [...(stages || [])].sort((a, b) => (a.position - b.position) || String(a.id).localeCompare(String(b.id)));
}

export function visibleStages(stages) {
  return sortStages(stages).filter((s) => s.active !== false);
}

// Colunas do fluxo avançar/voltar: visíveis e fora do cancelamento
// (cancelar continua via diálogo com motivo, como no legado).
export function flowStages(stages) {
  return visibleStages(stages).filter((s) => s.mapsTo !== 'cancelado');
}

// Colunas exibidas no Kanban: visíveis + terminais (finalizado/cancelado)
// mesmo quando inativas. Sem isso, pedidos terminais caem pelo fallback em
// outra coluna (ex.: Novo) e seus cards ficam sem ação e sem contexto.
export function displayStages(stages) {
  const vis = visibleStages(stages);
  const terms = sortStages(stages).filter(
    (s) => TERMINAL_MAPS_TO.includes(s.mapsTo) && !vis.some((v) => v.id === s.id),
  );
  return [...vis, ...terms];
}

// Coluna natural de um status legado: primeira visível com mapsTo igual;
// terminais usam a coluna própria mesmo inativa (nunca caem no Novo);
// demais casos: primeira visível (pedido nunca some do Kanban).
export function stageForStatus(stages, status) {
  const vis = visibleStages(stages);
  if (vis.length === 0) return null;
  const natural = vis.find((s) => s.mapsTo === status);
  if (natural) return natural;
  if (TERMINAL_MAPS_TO.includes(status)) {
    const own = sortStages(stages).find((s) => s.mapsTo === status);
    if (own) return own;
  }
  return vis[0];
}

// Regra legada preservada (orderStatusFlow.getNextStatus): delivery pula
// "aguardando_retirada" e vai direto para "saiu_entrega". Retirada só pula
// "saiu_entrega" quando existe uma etapa Pronto ativa; sem Pronto ativo,
// todos os tipos usam "saiu_entrega" (se essa etapa estiver ativa) como
// fallback. Mesa mantém a navegação atual por stages.
function flowForOrder(flow, order) {
  const type = order?.order_type;
  if (type === 'delivery') {
    return flow.filter((s) => s.mapsTo !== 'aguardando_retirada');
  }
  if (type === 'retirada') {
    const hasReadyStage = flow.some((s) => s.mapsTo === 'aguardando_retirada');
    return hasReadyStage
      ? flow.filter((s) => s.mapsTo !== 'saiu_entrega')
      : flow;
  }
  return flow;
}

function anchorStage(stages, status) {
  const all = sortStages(stages);
  return all.find((s) => s.mapsTo === status) || null;
}

export function resolveAdvanceTarget(stages, order) {
  if (!order || TERMINAL_MAPS_TO.includes(order.status)) return null;
  const flow = flowForOrder(flowStages(stages), order);
  if (flow.length === 0) return null;
  const anchor = anchorStage(stages, order.status);
  const anchorPos = anchor ? anchor.position : -1;
  const next = flow.find((s) => s.position > anchorPos && s.mapsTo !== order.status);
  if (!next) return null;
  return { targetStatus: next.mapsTo, targetStage: next };
}

export function resolveRegressTarget(stages, order) {
  if (!order || TERMINAL_MAPS_TO.includes(order.status)) return null;
  const flow = flowForOrder(flowStages(stages), order);
  if (flow.length === 0) return null;
  const anchor = anchorStage(stages, order.status);
  const anchorPos = anchor ? anchor.position : Number.MAX_SAFE_INTEGER;
  const prev = [...flow].reverse().find((s) => s.position < anchorPos && s.mapsTo !== order.status);
  if (!prev) return null;
  return { targetStatus: prev.mapsTo, targetStage: prev };
}

// Valida movimento de UMA etapa (drag ou botão). Lança erro ao pular etapa.
// 'cancelado' passa (caminho legado via changeOrderStatus, como no drag atual).
// Destino terminal (ex.: coluna Finalizado inativa) passa quando é o próximo
// legado do pedido — a baixa nunca fica sem caminho no Kanban.
export function assertSingleStep(stages, fromStatus, toStatus, orderType = null) {
  if (!fromStatus || !toStatus) throw new Error('Status de origem/destino inválidos');
  if (fromStatus === toStatus) return { noop: true };
  if (toStatus === 'cancelado') return { cancel: true };
  const order = { status: fromStatus, order_type: orderType };
  const next = resolveAdvanceTarget(stages, order);
  if (next && next.targetStatus === toStatus) return { direction: 'advance', ...next };
  const prev = resolveRegressTarget(stages, order);
  if (prev && prev.targetStatus === toStatus) return { direction: 'regress', ...prev };
  if (TERMINAL_MAPS_TO.includes(toStatus) && getNextStatus(order) === toStatus) {
    return { direction: 'advance', targetStatus: toStatus, targetStage: null };
  }
  throw new Error('Só é permitido mover o pedido uma etapa por vez');
}

// Um status só pode ser alvo se tiver coluna própria no Kanban. Terminais
// são sempre exibidos (mesmo inativos); os demais exigem uma etapa ativa.
// Sem stages (modo legado), as colunas fixas continuam válidas.
function hasRenderableStatusColumn(stages, status) {
  const all = sortStages(stages);
  if (all.length === 0) return true;
  if (TERMINAL_MAPS_TO.includes(status)) {
    return all.some((s) => s.mapsTo === status);
  }
  return all.some((s) => s.active !== false && s.mapsTo === status);
}

// Ação primária do card: próxima etapa configurada; com fallback legado para
// pedido não-terminal quando o destino tem coluna própria (stages incompletas
// não podem deixar o card sem ação). `fallback: true` indica que a UI deve
// sinalizar o uso do fluxo padrão (nunca silencioso). Se o fallback levaria a
// um status sem coluna, não há ação: evita transição invisível e pedido preso.
// Status desconhecido do sistema (fora do enum legado) também não recebe ação.
export function resolveCardPrimary(stages, order) {
  if (!order || TERMINAL_MAPS_TO.includes(order.status)) return null;
  // Status fora do enum do sistema: sem ação (o card exibe diagnóstico).
  if (!LEGACY_STATUSES.includes(order.status)) return null;
  const target = resolveAdvanceTarget(stages, order);
  if (target) {
    return {
      id: order.status === 'novo' ? 'accept' : 'advance',
      label: order.status === 'novo' ? 'Aceitar' : `→ ${target.targetStage.name}`,
      next: target.targetStatus,
      fallback: false,
    };
  }
  const legacyNext = getNextStatus(order);
  if (!legacyNext || !hasRenderableStatusColumn(stages, legacyNext)) return null;
  return {
    id: order.status === 'novo' ? 'accept' : 'advance',
    label: order.status === 'novo' ? 'Aceitar' : `→ ${STATUS_LABELS[legacyNext] || legacyNext}`,
    next: legacyNext,
    fallback: true,
  };
}

export async function advanceOrder(client, stages, order) {
  if (!order?.id) throw new Error('Pedido não identificado');
  const target = resolveAdvanceTarget(stages, order);
  if (!target) throw new Error('Pedido já está na etapa final');
  return changeOrderStatus(mustBeConfigured(client), order.id, target.targetStatus);
}

export async function regressOrder(client, stages, order) {
  if (!order?.id) throw new Error('Pedido não identificado');
  const target = resolveRegressTarget(stages, order);
  if (!target) throw new Error('Pedido já está na etapa inicial');
  return changeOrderStatus(mustBeConfigured(client), order.id, target.targetStatus);
}

// Modal fecha sozinho após ações que concluem a interação.
export function shouldAutoCloseOnAction(actionId) {
  return ['accept', 'advance', 'regress'].includes(actionId);
}
