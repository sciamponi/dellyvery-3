import { supabase as defaultClient } from './supabaseClient.js';

// DELLVERY 3 — Adapter Supabase Plans (catálogo + CRUD platform-admin).
// Leitura: pública somente active=true (RLS); escrita: PLATFORM_ADMIN.
// Mapeamento legado Base44 (flat limits_*) <-> Supabase (limits JSONB).

const withClient = (client) => client || defaultClient;

function mustBeConfigured(client) {
  const c = withClient(client);
  if (!c) throw new Error('Supabase não configurado (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)');
  return c;
}

function rpcError(error) {
  throw new Error(error?.message || 'Erro na operação');
}

export function slugifyPlanName(name) {
  const base = (name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return base;
}

export function fromSupabasePlan(row) {
  if (!row) return row;
  const limits = row.limits && typeof row.limits === 'object' ? row.limits : {};
  const num = (v, fallback = -1) => (v === undefined || v === null || v === '' ? fallback : Number(v));
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    price: row.price != null ? Number(row.price) : 0,
    billing_cycle: row.billing_cycle || 'monthly',
    features: Array.isArray(row.features) ? row.features : [],
    limits_users: num(limits.users, 1),
    limits_orders: num(limits.orders, -1),
    limits_products: num(limits.products, -1),
    limits_customers: num(limits.customers, -1),
    limits_whatsapp: num(limits.whatsapp, 0),
    limits_ia: !!limits.ia,
    limits_storage_mb: num(limits.storage_mb, 100),
    // Sem coluna própria: popular vai em limits.popular (sem migration).
    is_popular: !!limits.popular,
    sort_order: row.sort_order ?? 0,
    active: row.active ?? true,
    // FASE A: campos comerciais (migration 20261008000005).
    description: row.description || '',
    annual_price: row.annual_price != null ? Number(row.annual_price) : null,
    setup_fee: row.setup_fee != null ? Number(row.setup_fee) : 0,
    trial_days: row.trial_days != null ? Number(row.trial_days) : 7,
    sales_text: row.sales_text || '',
    benefits: Array.isArray(row.benefits) ? row.benefits : [],
  };
}

export function toSupabasePlan(data) {
  const out = {};
  if (data.name !== undefined) out.name = data.name;
  if (data.slug !== undefined) out.slug = data.slug || null;
  else if (data.name !== undefined) out.slug = slugifyPlanName(data.name) || null;
  if (data.price !== undefined) out.price = Number(data.price) || 0;
  if (data.billing_cycle !== undefined) out.billing_cycle = data.billing_cycle;
  if (data.features !== undefined) out.features = Array.isArray(data.features) ? data.features : [];
  const limits = {};
  let hasLimits = false;
  for (const [from, to] of [['limits_users', 'users'], ['limits_orders', 'orders'], ['limits_products', 'products'], ['limits_customers', 'customers'], ['limits_whatsapp', 'whatsapp'], ['limits_storage_mb', 'storage_mb']]) {
    if (data[from] !== undefined) { limits[to] = Number(data[from]); hasLimits = true; }
  }
  if (data.limits_ia !== undefined) { limits.ia = !!data.limits_ia; hasLimits = true; }
  if (data.is_popular !== undefined) { limits.popular = !!data.is_popular; hasLimits = true; }
  if (hasLimits) out.limits = limits;
  if (data.sort_order !== undefined) out.sort_order = Number(data.sort_order) || 0;
  if (data.active !== undefined) out.active = data.active ?? true;
  // FASE A: campos comerciais.
  if (data.description !== undefined) out.description = data.description || null;
  if (data.annual_price !== undefined) out.annual_price = (data.annual_price === null || data.annual_price === '') ? null : Number(data.annual_price);
  if (data.setup_fee !== undefined) out.setup_fee = Number(data.setup_fee) || 0;
  if (data.trial_days !== undefined) out.trial_days = Math.max(0, Math.floor(Number(data.trial_days) || 0));
  if (data.sales_text !== undefined) out.sales_text = data.sales_text || null;
  if (data.benefits !== undefined) out.benefits = Array.isArray(data.benefits) ? data.benefits : [];
  return out;
}

// FASE A: validação comercial antes da rede. Limites: -1 = ilimitado,
// demais devem ser inteiros >= 0. Retorna mensagem de erro ou null.
// partial=true (update): só valida os campos presentes.
export function validatePlanData(data, { partial = false } = {}) {
  if (!partial && !data?.name?.trim()) return 'Nome é obrigatório';
  for (const [key, label] of [['price', 'Preço mensal'], ['annual_price', 'Preço anual'], ['setup_fee', 'Taxa de implantação']]) {
    const v = data[key];
    if (v !== undefined && v !== null && v !== '' && !(Number(v) >= 0)) {
      return `${label} deve ser maior ou igual a zero`;
    }
  }
  const trial = data.trial_days;
  if (trial !== undefined && trial !== null && trial !== '' && !(Number.isInteger(Number(trial)) && Number(trial) >= 0)) {
    return 'Dias de teste devem ser um número inteiro maior ou igual a zero';
  }
  for (const [key, label] of [['limits_users', 'Usuários'], ['limits_orders', 'Pedidos'], ['limits_products', 'Produtos'], ['limits_customers', 'Clientes'], ['limits_whatsapp', 'WhatsApp'], ['limits_storage_mb', 'Armazenamento (MB)']]) {
    const v = data[key];
    if (v === undefined || v === null || v === '') continue;
    const n = Number(v);
    if (!Number.isInteger(n) || !(n === -1 || n >= 0)) {
      return `${label}: use -1 para ilimitado ou um número inteiro maior ou igual a zero`;
    }
  }
  return null;
}

export async function listPlans(client, { onlyActive = true } = {}) {
  const c = mustBeConfigured(client);
  let q = c.from('plans').select('*').order('sort_order', { ascending: true });
  if (onlyActive) q = q.eq('active', true);
  const { data, error } = await q;
  if (error) rpcError(error);
  return (data || []).map(fromSupabasePlan);
}

export async function createPlan(client, data) {
  const c = mustBeConfigured(client);
  const validationError = validatePlanData(data || {});
  if (validationError) throw new Error(validationError);
  const { data: row, error } = await c.from('plans').insert(toSupabasePlan(data)).select().single();
  if (error) rpcError(error);
  return fromSupabasePlan(row);
}

export async function updatePlan(client, id, data) {
  const c = mustBeConfigured(client);
  if (!id) throw new Error('Plano não identificado');
  const validationError = validatePlanData(data || {}, { partial: true });
  if (validationError) throw new Error(validationError);
  const { data: row, error } = await c.from('plans').update(toSupabasePlan(data)).eq('id', id).select().single();
  if (error) rpcError(error);
  return fromSupabasePlan(row);
}

export async function deletePlan(client, id) {
  const c = mustBeConfigured(client);
  if (!id) throw new Error('Plano não identificado');
  const { error } = await c.from('plans').delete().eq('id', id);
  if (error) rpcError(error);
}

export async function isPlatformAdmin(client, userId) {
  const c = mustBeConfigured(client);
  if (!userId) return false;
  const { data, error } = await c.from('profiles').select('platform_role').eq('id', userId).maybeSingle();
  if (error) return false;
  return data?.platform_role === 'PLATFORM_ADMIN';
}
