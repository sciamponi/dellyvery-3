import { supabase as defaultClient } from './supabaseClient.js';
import { validateIngredient, validateConfigStep, validateConfigOption } from '../lib/configEditor.js';

// DELLVERY 3 — Gestão de complementos V2 (ingredientes + passos + opções).
// RLS + triggers de tenant fazem a barreira real (OWNER/ADMIN/MANAGER
// escrevem; membros leem); aqui: escopo por empresa, validação pré-rede e
// erros amigáveis (ex.: origem em uso). Sem tocar em pedidos/RPCs.

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
  throw new Error(error?.message || 'Erro na operação');
}

function isFkRestrict(error) {
  const msg = `${error?.message || ''} ${error?.code || ''}`;
  return /foreign key|violates|restrict/i.test(msg) && /23503/.test(`${error?.code || ''} 23503`);
}

// ---------- Ingredientes (catálogo reutilizável) ----------

export async function listIngredients(client, companyId) {
  const c = mustBeConfigured(client);
  const { data, error } = await c.from('ingredients')
    .select('*').eq('company_id', requireCompanyId(companyId))
    .order('sort_order', { ascending: true }).order('name');
  if (error) rpcError(error);
  return (data || []).map((r) => ({
    id: r.id, company_id: r.company_id, name: r.name || '',
    description: r.description || '', active: r.active !== false,
    sort_order: r.sort_order ?? 0,
  }));
}

export async function createIngredient(client, companyId, data) {
  const c = mustBeConfigured(client);
  const cid = requireCompanyId(companyId);
  const err = validateIngredient(data || {});
  if (err) throw new Error(err);
  const payload = {
    company_id: cid,
    name: String(data.name).trim(),
    description: data.description ? String(data.description).trim() : null,
    active: data.active !== false,
    sort_order: data.sort_order === '' || data.sort_order == null ? 0 : Number(data.sort_order),
  };
  const { data: row, error } = await c.from('ingredients').insert(payload).select().single();
  if (error) rpcError(error);
  return row;
}

export async function updateIngredient(client, id, data) {
  const c = mustBeConfigured(client);
  if (!id) throw new Error('Ingrediente não identificado');
  const err = validateIngredient({ name: 'x', ...(data || {}) });
  if (err && data?.name !== undefined) throw new Error(err);
  const patch = {};
  if (data.name !== undefined) patch.name = String(data.name).trim();
  if (data.description !== undefined) patch.description = data.description ? String(data.description).trim() : null;
  if (data.active !== undefined) patch.active = !!data.active;
  if (data.sort_order !== undefined) patch.sort_order = Number(data.sort_order) || 0;
  if (patch.name !== undefined && patch.name === '') throw new Error('Nome do ingrediente é obrigatório');
  const { data: row, error } = await c.from('ingredients').update(patch).eq('id', id).select().single();
  if (error) rpcError(error);
  return row;
}

export async function deleteIngredient(client, id) {
  const c = mustBeConfigured(client);
  if (!id) throw new Error('Ingrediente não identificado');
  const { error } = await c.from('ingredients').delete().eq('id', id);
  if (error) {
    if (isFkRestrict(error)) throw new Error('Em uso em montagens: desative em vez de excluir');
    rpcError(error);
  }
}

// ---------- Passos (grupos por produto) ----------

export async function listSteps(client, companyId, productId) {
  const c = mustBeConfigured(client);
  const { data, error } = await c.from('product_config_steps')
    .select('*').eq('company_id', requireCompanyId(companyId)).eq('product_id', productId)
    .order('position', { ascending: true });
  if (error) rpcError(error);
  return data || [];
}

export async function createStep(client, companyId, productId, data) {
  const c = mustBeConfigured(client);
  const cid = requireCompanyId(companyId);
  if (!productId) throw new Error('Produto não identificado');
  const err = validateConfigStep(data || {});
  if (err) throw new Error(err);
  const { data: siblings } = await c.from('product_config_steps')
    .select('position').eq('company_id', cid).eq('product_id', productId)
    .order('position', { ascending: false }).limit(1);
  const nextPos = siblings && siblings.length > 0 ? (Number(siblings[0].position) || 0) + 1 : 0;
  const payload = {
    company_id: cid,
    product_id: productId,
    position: nextPos,
    title: String(data.title).trim(),
    description: data.description ? String(data.description).trim() : null,
    select_mode: data.select_mode === 'single' ? 'single' : 'multi',
    min_select: Number(data.min_select) || 0,
    max_select: Number(data.max_select) || 1,
    free_qty: Number(data.free_qty) || 0,
    required: !!data.required,
    active: data.active !== false,
  };
  const { data: row, error } = await c.from('product_config_steps').insert(payload).select().single();
  if (error) rpcError(error);
  return row;
}

export async function updateStep(client, id, data) {
  const c = mustBeConfigured(client);
  if (!id) throw new Error('Grupo não identificado');
  const current = await getStep(client, id);
  const merged = { ...current, ...(data || {}) };
  const err = validateConfigStep(merged);
  if (err) throw new Error(err);
  const patch = {};
  for (const k of ['title', 'description', 'select_mode', 'min_select', 'max_select', 'free_qty', 'required', 'active', 'position']) {
    if (data[k] !== undefined) patch[k] = data[k];
  }
  if (patch.title !== undefined) patch.title = String(patch.title).trim();
  if (patch.description !== undefined) patch.description = patch.description ? String(patch.description).trim() : null;
  const { data: row, error } = await c.from('product_config_steps').update(patch).eq('id', id).select().single();
  if (error) rpcError(error);
  return row;
}

export async function getStep(client, id) {
  const c = mustBeConfigured(client);
  const { data, error } = await c.from('product_config_steps').select('*').eq('id', id).maybeSingle();
  if (error) rpcError(error);
  if (!data) throw new Error('Grupo não encontrado');
  return data;
}

export async function deleteStep(client, id) {
  const c = mustBeConfigured(client);
  if (!id) throw new Error('Grupo não identificado');
  // Opções caem em cascata (FK); histórico de pedidos usa snapshot legado,
  // nunca estas linhas — exclusão segura por desenho.
  const { error } = await c.from('product_config_steps').delete().eq('id', id);
  if (error) rpcError(error);
}

// Reordena trocando position com o vizinho (up/down); unique parcial.
export async function moveStep(client, stepId, dir) {
  const c = mustBeConfigured(client);
  const step = await getStep(client, stepId);
  const { data: siblings, error } = await c.from('product_config_steps')
    .select('id,position').eq('company_id', step.company_id).eq('product_id', step.product_id)
    .order('position', { ascending: true });
  if (error) rpcError(error);
  const idx = (siblings || []).findIndex((s) => s.id === stepId);
  const j = dir > 0 ? idx + 1 : idx - 1;
  if (idx < 0 || j < 0 || j >= (siblings || []).length) return false;
  const a = siblings[idx];
  const b = siblings[j];
  // Troca em 3 updates com sentinela alta (position >= 0 por CHECK; sem
  // transação no adapter; unique só por par produto/posição).
  const tmp = 1000000000;
  const r1 = await c.from('product_config_steps').update({ position: tmp }).eq('id', a.id);
  if (r1.error) rpcError(r1.error);
  const r2 = await c.from('product_config_steps').update({ position: a.position }).eq('id', b.id);
  if (r2.error) rpcError(r2.error);
  const r3 = await c.from('product_config_steps').update({ position: b.position }).eq('id', a.id);
  if (r3.error) rpcError(r3.error);
  return true;
}

// ---------- Config completa de um produto (cardápio/PDV) ----------
// Passos ativos + opções ativas com origem (para o motor productConfig).
// Leitura por membro (RLS); público usa o storefront (com config inclusa).
export async function getProductConfig(client, companyId, productId) {
  const c = mustBeConfigured(client);
  const cid = requireCompanyId(companyId);
  if (!productId) throw new Error('Produto não identificado');
  const { data: steps, error: stepErr } = await c.from('product_config_steps')
    .select('*').eq('company_id', cid).eq('product_id', productId).eq('active', true)
    .order('position', { ascending: true });
  if (stepErr) rpcError(stepErr);
  const stepIds = (steps || []).map((s) => s.id);
  let options = [];
  if (stepIds.length > 0) {
    const { data, error: optErr } = await c.from('product_config_options')
      .select('*, ingredients!product_config_options_ingredient_id_fkey(id,name,active), products!product_config_options_product_id_fkey(id,name,active,company_id)')
      .in('step_id', stepIds);
    if (optErr) rpcError(optErr);
    options = data || [];
  }
  return {
    steps: steps || [],
    options: options.filter((o) => o.active !== false).map((o) => ({
      ...o,
      origin: o.ingredient_id
        ? { kind: 'ingredient', refId: o.ingredient_id, active: o.ingredients?.active !== false, companyId: cid }
        : { kind: 'product', refId: o.product_id, active: o.products?.active !== false, companyId: o.products?.company_id || cid },
    })),
  };
}

export async function listOptions(client, stepId) {
  const c = mustBeConfigured(client);
  const { data, error } = await c.from('product_config_options')
    .select('*').eq('step_id', stepId).order('sort_order', { ascending: true });
  if (error) rpcError(error);
  return data || [];
}

// ---------- Dependências entre produtos (Gate 3) ----------
// Pares (produto => exigido); OR entre linhas do mesmo produto. RLS por
// papel (OWNER/ADMIN/MANAGER escrevem); trigger garante mesma empresa.

export async function listDependencies(client, companyId) {
  const c = mustBeConfigured(client);
  const { data, error } = await c.from('product_dependencies')
    .select('*').eq('company_id', requireCompanyId(companyId))
    .order('created_at', { ascending: true });
  if (error) rpcError(error);
  return data || [];
}

// Mesma lista com nomes resolvidos (mensagens e UI). 2 consultas, sem N+1
// por regra: busca os produtos citados de uma vez.
export async function listDependenciesWithNames(client, companyId) {
  const rules = await listDependencies(client, companyId);
  if (rules.length === 0) return [];
  const ids = [...new Set(rules.flatMap((r) => [r.product_id, r.requires_product_id]).filter(Boolean))];
  const { data, error } = await mustBeConfigured(client).from('products')
    .select('id,name').eq('company_id', requireCompanyId(companyId)).in('id', ids);
  if (error) rpcError(error);
  const names = new Map((data || []).map((p) => [p.id, p.name]));
  return rules.map((r) => ({
    ...r,
    product_name: names.get(r.product_id) || '',
    requires_name: names.get(r.requires_product_id) || '',
  }));
}

export async function createDependency(client, companyId, productId, requiresProductId) {
  const c = mustBeConfigured(client);
  const cid = requireCompanyId(companyId);
  if (!productId || !requiresProductId) throw new Error('Escolha os dois produtos');
  if (productId === requiresProductId) throw new Error('Um produto não pode exigir a si mesmo');
  const { data: row, error } = await c.from('product_dependencies').insert({
    company_id: cid, product_id: productId, requires_product_id: requiresProductId, active: true,
  }).select().single();
  if (error) {
    const msg = `${error.message || ''} ${error.code || ''}`;
    if (/duplicate|uq_dependency_pair|23505/i.test(msg)) throw new Error('Regra já existe');
    if (/mesma empresa|company/i.test(msg)) throw new Error('Dependência só entre produtos da mesma empresa');
    rpcError(error);
  }
  return row;
}

export async function setDependencyActive(client, id, active) {
  const c = mustBeConfigured(client);
  if (!id) throw new Error('Regra não identificada');
  const { data: row, error } = await c.from('product_dependencies').update({ active: !!active }).eq('id', id).select().single();
  if (error) rpcError(error);
  return row;
}

export async function deleteDependency(client, id) {
  const c = mustBeConfigured(client);
  if (!id) throw new Error('Regra não identificada');
  const { error } = await c.from('product_dependencies').delete().eq('id', id);
  if (error) rpcError(error);
}

export async function createOption(client, data) {
  const c = mustBeConfigured(client);
  const err = validateConfigOption(data || {});
  if (err) throw new Error(err);
  if (!data.step_id) throw new Error('Grupo não identificado');
  const payload = {
    step_id: data.step_id,
    ingredient_id: data.ingredient_id || null,
    product_id: data.product_id || null,
    name: String(data.name).trim(),
    description: data.description ? String(data.description).trim() : null,
    price: Number(data.price) || 0,
    active: data.active !== false,
    sort_order: data.sort_order === '' || data.sort_order == null ? 0 : Number(data.sort_order),
  };
  const { data: row, error } = await c.from('product_config_options').insert(payload).select().single();
  if (error) {
    const msg = `${error.message || ''}`;
    if (/ingredient belongs|product belongs|not found/i.test(msg)) {
      throw new Error('Origem de outra empresa ou inexistente');
    }
    rpcError(error);
  }
  return row;
}

export async function updateOption(client, id, data) {
  const c = mustBeConfigured(client);
  if (!id) throw new Error('Opção não identificada');
  const current = await getOption(client, id);
  const merged = { ...current, ...(data || {}) };
  const err = validateConfigOption(merged);
  if (err) throw new Error(err);
  const patch = {};
  for (const k of ['name', 'description', 'price', 'active', 'sort_order']) {
    if (data[k] !== undefined) patch[k] = data[k];
  }
  if (patch.name !== undefined) patch.name = String(patch.name).trim();
  if (patch.description !== undefined) patch.description = patch.description ? String(patch.description).trim() : null;
  if (patch.price !== undefined) patch.price = Number(patch.price) || 0;
  const { data: row, error } = await c.from('product_config_options').update(patch).eq('id', id).select().single();
  if (error) rpcError(error);
  return row;
}

export async function getOption(client, id) {
  const c = mustBeConfigured(client);
  const { data, error } = await c.from('product_config_options').select('*').eq('id', id).maybeSingle();
  if (error) rpcError(error);
  if (!data) throw new Error('Opção não encontrada');
  return data;
}

export async function deleteOption(client, id) {
  const c = mustBeConfigured(client);
  if (!id) throw new Error('Opção não identificada');
  const { error } = await c.from('product_config_options').delete().eq('id', id);
  if (error) rpcError(error);
}
