import { supabase as defaultClient } from './supabaseClient.js';

// DELLVERY 3 — Adapter Mesas (dining_tables, FASE A).
// company_id sempre do contexto, nunca do payload. Escrita exige
// OWNER/ADMIN/MANAGER no banco (RLS); leitura, qualquer membro ativo.
// Sem delete físico: desativar preserva o histórico de pedidos.

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

export function toSupabaseTablePatch(data) {
  const patch = {};
  if (data.name !== undefined) patch.name = String(data.name || '').trim();
  if (data.code !== undefined) patch.code = String(data.code || '').trim() || null;
  if (data.notes !== undefined) patch.notes = String(data.notes || '').trim() || null;
  if (data.sort_order !== undefined) patch.sort_order = Number(data.sort_order) || 0;
  if (data.active !== undefined) patch.active = !!data.active;
  return patch;
}

export async function listTables(client, companyId, { onlyActive = false } = {}) {
  const c = mustBeConfigured(client);
  let q = c.from('dining_tables').select('*')
    .eq('company_id', requireCompanyId(companyId))
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (onlyActive) q = q.eq('active', true);
  const { data, error } = await q;
  if (error) rpcError(error);
  return data || [];
}

export async function createTable(client, companyId, data) {
  const c = mustBeConfigured(client);
  const patch = toSupabaseTablePatch(data);
  if (!patch.name) throw new Error('Nome da mesa é obrigatório');
  const { data: row, error } = await c.from('dining_tables').insert({
    company_id: requireCompanyId(companyId),
    ...patch,
    active: patch.active !== undefined ? patch.active : true,
  }).select().single();
  if (error) rpcError(error);
  return row;
}

export async function updateTable(client, companyId, tableId, data) {
  const c = mustBeConfigured(client);
  if (!tableId) throw new Error('Mesa não identificada');
  const patch = toSupabaseTablePatch(data);
  if (patch.name !== undefined && !patch.name) throw new Error('Nome da mesa é obrigatório');
  delete patch.company_id;
  const { data: row, error } = await c.from('dining_tables').update(patch)
    .eq('id', tableId)
    .eq('company_id', requireCompanyId(companyId))
    .select()
    .maybeSingle();
  if (error) rpcError(error);
  if (!row) throw new Error('Mesa não encontrada ou sem permissão');
  return row;
}

export async function setTableActive(client, companyId, tableId, active) {
  return updateTable(client, companyId, tableId, { active: !!active });
}

// Resolução pública do token (QR Code): valida no servidor (existência,
// mesa ativa, empresa). Retorna { company_slug, table_name } — sem IDs.
export async function resolveTableToken(client, token) {
  const c = mustBeConfigured(client);
  const clean = String(token || '').trim();
  if (!clean) throw new Error('Mesa não identificada');
  const { data, error } = await c.rpc('resolve_table_token', { p_token: clean });
  if (error) rpcError(error);
  return data;
}

// Exclusão física via RPC (atômica): só OWNER/ADMIN (verificado dentro da
// função) e só sem nenhum pedido referenciando. Erro traz os bloqueios.
export async function deleteTable(client, companyId, tableId) {
  const c = mustBeConfigured(client);
  requireCompanyId(companyId);
  if (!tableId) throw new Error('Mesa não identificada');
  const { data, error } = await c.rpc('delete_table_if_unused', { p_table_id: tableId });
  if (error) rpcError(error);
  return data;
}

// Referências para o diálogo de confirmação (pedidos por table_id).
// Leitura escopada por empresa (RLS); sem N+1 (1 consulta).
export async function getTableBlockers(client, companyId, tableId) {
  const c = mustBeConfigured(client);
  const { data, error } = await c.from('orders')
    .select('id,order_number,status')
    .eq('company_id', requireCompanyId(companyId))
    .eq('table_id', tableId)
    .order('order_number', { ascending: true })
    .limit(20);
  if (error) rpcError(error);
  return data || [];
}
