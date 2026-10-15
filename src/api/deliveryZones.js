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
    // Contorno GeoJSON da área de entrega (ou null quando só taxa/nome).
    polygon: row.polygon && row.polygon.type === 'Polygon' ? row.polygon : null,
  };
}

export function toSupabaseZonePatch(data) {
  const out = {};
  if (data.name !== undefined) out.name = data.name;
  if (data.fee !== undefined) out.fee = Number(data.fee) || 0;
  if (data.minimum_order !== undefined) out.minimum_order = Number(data.minimum_order) || 0;
  if (data.estimated_time !== undefined) out.estimated_time = Number(data.estimated_time) || 30;
  if (data.active !== undefined) out.active = !!data.active;
  if (data.polygon !== undefined) {
    out.polygon = data.polygon === null ? null : data.polygon;
    if (out.polygon !== null) {
      const ring = out.polygon.coordinates && out.polygon.coordinates[0];
      if (!out.polygon || out.polygon.type !== 'Polygon' || !Array.isArray(ring) || ring.length < 4) {
        throw new Error('Contorno da região inválido');
      }
    }
  }
  return out;
}

// Validação pura do formulário da zona (criar e editar usam a mesma).
// Retorna null se válido ou a mensagem do primeiro problema.
export function validateZoneForm(data) {
  const d = data || {};
  if (!String(d.name || '').trim()) return 'Nome é obrigatório';
  for (const [key, label, min] of [
    ['fee', 'Taxa', 0],
    ['minimum_order', 'Pedido mínimo', 0],
    ['estimated_time', 'Tempo estimado', 1],
  ]) {
    if (d[key] === undefined || d[key] === null || d[key] === '') continue;
    const n = Number(d[key]);
    if (!Number.isFinite(n) || n < min) return `${label} deve ser maior ou igual a ${min}`;
  }
  return null;
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

export async function deleteZone(client, companyId, id) {
  const c = mustBeConfigured(client);
  const { error } = await c.from('delivery_zones').delete().eq('id', id).eq('company_id', requireCompanyId(companyId));
  if (error) throw error;
}

export async function updateZone(client, companyId, id, data) {
  const c = mustBeConfigured(client);
  if (!id) throw new Error('Região não identificada');
  const { data: row, error } = await c
    .from('delivery_zones')
    .update(toSupabaseZonePatch(data || {}))
    .eq('id', id)
    .eq('company_id', requireCompanyId(companyId))
    .select()
    .single();
  if (error) throw error;
  return fromSupabaseZone(row);
}
