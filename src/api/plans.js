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
  return out;
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
  if (!data?.name?.trim()) throw new Error('Nome é obrigatório');
  const { data: row, error } = await c.from('plans').insert(toSupabasePlan(data)).select().single();
  if (error) rpcError(error);
  return fromSupabasePlan(row);
}

export async function updatePlan(client, id, data) {
  const c = mustBeConfigured(client);
  if (!id) throw new Error('Plano não identificado');
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
