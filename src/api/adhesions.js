import { supabase as defaultClient } from './supabaseClient.js';
import { validateAdhesion } from '../lib/contract.js';

// DELLVERY 3 — Adesões comerciais (contratos). PLATFORM_ADMIN via RLS
// (commercial_adhesions_admin). Sem RPC: CRUD direto + eventos append-only.

const withClient = (client) => client || defaultClient;

function mustBeConfigured(client) {
  const c = withClient(client);
  if (!c) throw new Error('Supabase não configurado (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)');
  return c;
}

function rpcError(error) {
  throw new Error(error?.message || 'Erro na operação');
}

export function fromSupabaseAdhesion(row) {
  if (!row) return row;
  return {
    id: row.id,
    lead_id: row.lead_id || null,
    full_name: row.full_name || '',
    trade_name: row.trade_name || '',
    person_type: row.person_type || 'pf',
    document: row.document || '',
    phone: row.phone || '',
    email: row.email || '',
    address: row.address && typeof row.address === 'object' ? row.address : {},
    plan_id: row.plan_id || null,
    plan_name: row.plan_name || '',
    adhesion_fee: row.adhesion_fee != null ? Number(row.adhesion_fee) : 0,
    monthly_fee: row.monthly_fee != null ? Number(row.monthly_fee) : 0,
    discount_text: row.discount_text || '',
    start_date: row.start_date || null,
    due_day: row.due_day ?? null,
    payment_method: row.payment_method || '',
    status: row.status || 'rascunho',
    provider: row.provider && typeof row.provider === 'object' ? row.provider : {},
    contract_snapshot: row.contract_snapshot || null,
    contract_issued_at: row.contract_issued_at || null,
    events: Array.isArray(row.events) ? row.events : [],
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function toSupabaseAdhesion(data) {
  const out = {};
  const copy = (k, fn) => { if (data[k] !== undefined) out[k] = fn ? fn(data[k]) : data[k]; };
  copy('lead_id', (v) => v || null);
  copy('full_name', (v) => String(v || '').trim());
  copy('trade_name', (v) => String(v || '').trim());
  copy('person_type', (v) => (v === 'pj' ? 'pj' : 'pf'));
  copy('document', (v) => String(v || '').trim());
  copy('phone', (v) => String(v || '').trim());
  copy('email', (v) => String(v || '').trim());
  copy('address', (v) => (v && typeof v === 'object' ? v : {}));
  copy('plan_id', (v) => v || null);
  copy('plan_name', (v) => String(v || '').trim());
  copy('adhesion_fee', (v) => (v === '' || v == null ? 0 : Number(v)));
  copy('monthly_fee', (v) => (v === '' || v == null ? 0 : Number(v)));
  copy('discount_text', (v) => String(v || '').trim());
  copy('start_date', (v) => v || null);
  copy('due_day', (v) => (v === '' || v == null ? null : Number(v)));
  copy('payment_method', (v) => String(v || '').trim());
  copy('status', (v) => String(v || 'rascunho').trim());
  copy('provider', (v) => (v && typeof v === 'object' ? v : {}));
  copy('contract_snapshot', (v) => v ?? null);
  copy('contract_issued_at', (v) => v || null);
  copy('events', (v) => (Array.isArray(v) ? v : []));
  return out;
}

// Evento de histórico (append-only): nunca edita/apaga anteriores.
export function appendAdhesionEvent(prevEvents, action, detail, userId) {
  const list = Array.isArray(prevEvents) ? [...prevEvents] : [];
  list.push({
    at: new Date().toISOString(),
    by: userId || null,
    action: String(action || ''),
    detail: detail === undefined ? null : detail,
  });
  return list;
}

export async function listAdhesions(client, { status = null, limit = 100 } = {}) {
  const c = mustBeConfigured(client);
  let q = c.from('commercial_adhesions').select('*').order('created_at', { ascending: false }).limit(limit);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) rpcError(error);
  return (data || []).map(fromSupabaseAdhesion);
}

export async function getAdhesion(client, id) {
  const c = mustBeConfigured(client);
  if (!id) throw new Error('Adesão não identificada');
  const { data, error } = await c.from('commercial_adhesions').select('*').eq('id', id).maybeSingle();
  if (error) rpcError(error);
  return fromSupabaseAdhesion(data);
}

export async function createAdhesion(client, data, userId) {
  const c = mustBeConfigured(client);
  const validationError = validateAdhesion(data || {});
  if (validationError) throw new Error(validationError);
  const payload = {
    ...toSupabaseAdhesion(data || {}),
    events: appendAdhesionEvent([], 'criada', { status: data?.status || 'rascunho' }, userId),
  };
  const { data: row, error } = await c.from('commercial_adhesions').insert(payload).select().single();
  if (error) rpcError(error);
  return fromSupabaseAdhesion(row);
}

export async function updateAdhesion(client, id, data, event, userId) {
  const c = mustBeConfigured(client);
  if (!id) throw new Error('Adesão não identificada');
  const validationError = validateAdhesion(data || {});
  if (validationError) throw new Error(validationError);
  const current = await getAdhesion(client, id);
  const payload = {
    ...toSupabaseAdhesion(data || {}),
    events: event
      ? appendAdhesionEvent(current?.events, event.action, event.detail, userId)
      : (current?.events || []),
  };
  const { data: row, error } = await c.from('commercial_adhesions').update(payload).eq('id', id).select().single();
  if (error) rpcError(error);
  return fromSupabaseAdhesion(row);
}
