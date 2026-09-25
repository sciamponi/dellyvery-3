import { supabase as defaultClient } from './supabaseClient.js';

// DELLVERY 3 — Adapter Supabase Delivery Zones (FASE 5.3 ETAPA B)
// Somente CRUD autenticado da aba Delivery (Configurações). Sem acesso anon.
// company_id exclusivamente do contexto. Campos: name/fee/estimated_time +
// minimum_order/active quando presentes (sem UI própria nesta fase).

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

export function fromSupabaseZone(row) {
  if (!row) return row;
  return {
    id: row.id,
    company_id: row.company_id,
    name: row.name,
    fee: row.fee != null ? Number(row.fee) : 0,
    minimum_order: row.minimum_order != null ? Number(row.minimum_order) : 0,
    estimated_time: row.estimated_time ?? 30,
    active: row.active ?? true,
  };
}

export function toSupabaseZonePatch(data) {
  const out = {};
  if (data.name !== undefined) out.name = data.name;
  if (data.fee !== undefined) out.fee = Number(data.fee) || 0;
  if (data.minimum_order !== undefined) out.minimum_order = Number(data.minimum_order) || 0;
  if (data.estimated_time !== undefined) out.estimated_time = Number(data.estimated_time) || 30;
  if (data.active !== undefined) out.active = !!data.active;
  return out;
}

export async function listZones(client, companyId) {
  const c = mustBeConfigured(client);
  const { data, error } = await c
    .from('delivery_zones')
    .select('*')
    .eq('company_id', requireCompanyId(companyId))
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map(fromSupabaseZone);
}

export async function createZone(client, companyId, data) {
  const c = mustBeConfigured(client);
  if (!data?.name?.trim()) throw new Error('Nome é obrigatório');
  const { data: row, error } = await c
    .from('delivery_zones')
    .insert({ ...toSupabaseZonePatch({ fee: 0, estimated_time: 30, ...data }), company_id: requireCompanyId(companyId) })
    .select()
    .single();
  if (error) throw error;
  return fromSupabaseZone(row);
}

export async function deleteZone(client, id) {
  const c = mustBeConfigured(client);
  const { error } = await c.from('delivery_zones').delete().eq('id', id);
  if (error) throw error;
}
