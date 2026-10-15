import { supabase as defaultClient } from './supabaseClient.js';

// DELLVERY 3 — Adapter Supabase Customers (FASE 5.3 ETAPA B)
// company_id vem EXCLUSIVAMENTE do argumento (empresa atual do contexto).
// Transformação de endereço:
//   Base44 {address,number,complement,neighborhood,city,zip_code} (strings planas)
//   <-> Supabase address {street,number,complement,neighborhood,city,zip_code} (jsonb)
// orders_count/total_spent NÃO estão no schema (agregados de Pedidos);
// filtros "Recorrentes"/CSV que os usam operam sobre dados já carregados.

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

export function fromSupabaseCustomer(row) {
  if (!row) return row;
  const addr = row.address && typeof row.address === 'object' ? row.address : {};
  return {
    id: row.id,
    company_id: row.company_id,
    name: row.name,
    whatsapp: row.whatsapp || '',
    phone: row.phone || '',
    email: row.email || '',
    document: row.document,
    address: addr.street || '',
    number: addr.number || '',
    complement: addr.complement || '',
    neighborhood: addr.neighborhood || '',
    city: addr.city || '',
    zip_code: addr.zip_code || '',
    notes: row.notes || '',
    tags: Array.isArray(row.tags) ? row.tags : [],
    is_favorite: !!row.is_favorite,
    is_blocked: !!row.is_blocked,
  };
}

export function toSupabaseCustomer(companyId, data) {
  return {
    ...toSupabaseCustomerPatch({ name: '', ...data }),
    company_id: requireCompanyId(companyId),
  };
}

// Patch parcial: somente chaves presentes.
export function toSupabaseCustomerPatch(data) {
  const out = {};
  if (data.name !== undefined) out.name = data.name;
  if (data.whatsapp !== undefined) out.whatsapp = data.whatsapp || null;
  if (data.phone !== undefined) out.phone = data.phone || null;
  if (data.email !== undefined) out.email = data.email || null;
  if (data.document !== undefined) out.document = data.document || null;
  if (data.notes !== undefined) out.notes = data.notes || null;
  if (data.tags !== undefined) out.tags = Array.isArray(data.tags) ? data.tags : [];
  if (data.is_favorite !== undefined) out.is_favorite = !!data.is_favorite;
  if (data.is_blocked !== undefined) out.is_blocked = !!data.is_blocked;
  const addrKeys = ['address', 'number', 'complement', 'neighborhood', 'city', 'zip_code'];
  if (addrKeys.some((k) => data[k] !== undefined)) {
    const prev = data.__prevAddress && typeof data.__prevAddress === 'object' ? data.__prevAddress : {};
    out.address = {
      street: data.address !== undefined ? data.address || '' : prev.street || '',
      number: data.number !== undefined ? data.number || '' : prev.number || '',
      complement: data.complement !== undefined ? data.complement || '' : prev.complement || '',
      neighborhood: data.neighborhood !== undefined ? data.neighborhood || '' : prev.neighborhood || '',
      city: data.city !== undefined ? data.city || '' : prev.city || '',
      zip_code: data.zip_code !== undefined ? data.zip_code || '' : prev.zip_code || '',
    };
  } else if (data.addressJson !== undefined) {
    out.address = data.addressJson || {};
  }
  return out;
}

export async function listCustomers(client, companyId) {
  const c = mustBeConfigured(client);
  const { data, error } = await c
    .from('customers')
    .select('*')
    .eq('company_id', requireCompanyId(companyId))
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(fromSupabaseCustomer);
}

export async function createCustomer(client, companyId, data) {
  const c = mustBeConfigured(client);
  if (!data?.name?.trim()) throw new Error('Nome é obrigatório');
  const { data: row, error } = await c
    .from('customers')
    .insert(toSupabaseCustomer(companyId, data))
    .select()
    .single();
  if (error) throw error;
  return fromSupabaseCustomer(row);
}

export async function updateCustomer(client, companyId, id, data, prevAddress) {
  const c = mustBeConfigured(client);
  const { data: row, error } = await c
    .from('customers')
    .update(toSupabaseCustomerPatch({ ...data, __prevAddress: prevAddress }))
    .eq('id', id)
    .eq('company_id', requireCompanyId(companyId))
    .select()
    .single();
  if (error) throw error;
  return fromSupabaseCustomer(row);
}

export async function deleteCustomer(client, companyId, id) {
  const c = mustBeConfigured(client);
  const { error } = await c.from('customers').delete().eq('id', id).eq('company_id', requireCompanyId(companyId));
  if (error) throw error;
}

// Deduplicação (mesma regra do importador Base44): whatsapp/phone/email.
export function onlyDigits(v) {
  return (v || '').replace(/\D/g, '');
}

export function isDuplicateCustomer(existingCustomers, candidate) {
  const w = onlyDigits(candidate.whatsapp);
  const p = onlyDigits(candidate.phone);
  const em = (candidate.email || '').trim().toLowerCase();
  return (existingCustomers || []).some((c) => {
    const cw = onlyDigits(c.whatsapp);
    const cp = onlyDigits(c.phone);
    const ce = (c.email || '').trim().toLowerCase();
    return (w && cw === w) || (p && cp === p) || (em && ce === em);
  });
}
