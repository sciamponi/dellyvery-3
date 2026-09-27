import { supabase as defaultClient } from './supabaseClient.js';

// DELLVERY 3 — Adapter Supabase Company/Settings/Theme (FASE 5.4-C C3)
// company_id exclusivamente do contexto. Escrita segue RLS existente
// (companies UPDATE OWNER/ADMIN; settings/themes INSERT/UPDATE OWNER/ADMIN).
// Preserva nomes Base44 esperados pelo frontend.

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

// Campos Base44 <-> Supabase companies (colunas C1; resto direto).
const COMPANY_WRITE_FIELDS = [
  'name', 'slug', 'slogan', 'description', 'logo_url',
  'primary_color', 'accent_color', 'secondary_color',
  'phone', 'whatsapp', 'email', 'address', 'city', 'state', 'zip_code',
  'instagram', 'facebook', 'website',
  'is_open', 'opening_hours', 'minimum_order', 'delivery_fee',
  'estimated_delivery_time', 'delivery_radius',
];

export function toSupabaseCompanyPatch(data) {
  const out = {};
  for (const key of COMPANY_WRITE_FIELDS) {
    if (data[key] !== undefined) out[key] = data[key];
  }
  return out;
}

export async function getCurrentCompany(client, companyId) {
  const c = mustBeConfigured(client);
  const { data, error } = await c
    .from('companies')
    .select('*')
    .eq('id', requireCompanyId(companyId))
    .maybeSingle();
  if (error) rpcError(error);
  return data || null;
}

export async function updateCompany(client, companyId, data) {
  const c = mustBeConfigured(client);
  requireCompanyId(companyId);
  const { data: row, error } = await c
    .from('companies')
    .update(toSupabaseCompanyPatch(data))
    .eq('id', companyId)
    .select()
    .single();
  if (error) rpcError(error);
  return row;
}

export async function getCompanySettings(client, companyId) {
  const c = mustBeConfigured(client);
  const { data, error } = await c
    .from('company_settings')
    .select('*')
    .eq('company_id', requireCompanyId(companyId))
    .maybeSingle();
  if (error) rpcError(error);
  return data || null;
}

export async function updateCompanySettings(client, companyId, settings) {
  const c = mustBeConfigured(client);
  const { data, error } = await c
    .from('company_settings')
    .upsert({ company_id: requireCompanyId(companyId), settings: settings || {} }, { onConflict: 'company_id' })
    .select()
    .single();
  if (error) rpcError(error);
  return data;
}

export async function getStoreTheme(client, companyId) {
  const c = mustBeConfigured(client);
  const { data, error } = await c
    .from('store_themes')
    .select('*')
    .eq('company_id', requireCompanyId(companyId))
    .maybeSingle();
  if (error) rpcError(error);
  return data || null;
}

export async function updateStoreTheme(client, companyId, theme) {
  const c = mustBeConfigured(client);
  const payload = { company_id: requireCompanyId(companyId), ...(theme || {}) };
  delete payload.created_at;
  delete payload.updated_at;
  const { data, error } = await c
    .from('store_themes')
    .upsert(payload, { onConflict: 'company_id' })
    .select()
    .single();
  if (error) rpcError(error);
  return data;
}
