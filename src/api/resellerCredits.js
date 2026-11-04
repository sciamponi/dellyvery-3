import { supabase as defaultClient } from './supabaseClient.js';

const withClient = (client) => client || defaultClient;

function mustBeConfigured(client) {
  const c = withClient(client);
  if (!c) throw new Error('Supabase nao configurado (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)');
  return c;
}

function requestError(error) {
  throw new Error(error?.message || 'Erro na operacao');
}

export const RESELLER_CREDIT_KINDS = [
  { id: 'credito', label: 'Crédito' },
  { id: 'compra', label: 'Compra de créditos' },
  { id: 'ajuste', label: 'Ajuste' },
  { id: 'ativacao', label: 'Ativação' },
  { id: 'estorno', label: 'Estorno' },
];

export const RESELLER_ACTIVATION_STATUSES = [
  { id: 'ativa', label: 'Ativa' },
  { id: 'vencida', label: 'Vencida' },
  { id: 'cancelada', label: 'Cancelada' },
];

export function creditKindLabel(kind) {
  return RESELLER_CREDIT_KINDS.find((item) => item.id === kind)?.label || kind || '-';
}

export function activationStatusLabel(status) {
  return RESELLER_ACTIVATION_STATUSES.find((item) => item.id === status)?.label || status || '-';
}

export function localISODate(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function validateActivationForm(form = {}) {
  const { clientId, planId } = /** @type {{ clientId?: string, planId?: string }} */ (form);
  if (!clientId) return 'Escolha o cliente';
  if (!planId) return 'Escolha o plano';
  return null;
}

export function createActivationIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const rand = Math.floor(Math.random() * 16);
    const value = char === 'x' ? rand : (rand & 0x3) | 0x8;
    return value.toString(16);
  });
}

export function fromSupabaseCreditEntry(row) {
  if (!row) return row;
  return {
    id: row.id,
    reseller_id: row.reseller_id,
    activation_id: row.activation_id || null,
    purchase_order_id: row.purchase_order_id || null,
    kind: row.kind || 'ajuste',
    amount: Number(row.amount) || 0,
    reason: row.reason || '',
    created_by: row.created_by || null,
    created_at: row.created_at || null,
  };
}

export function fromSupabaseActivation(row, today = localISODate()) {
  if (!row) return row;
  let status = row.status || 'ativa';
  const expiresOn = row.new_expires_at || row.expires_on || null;
  if (status === 'ativa' && expiresOn && String(expiresOn).slice(0, 10) < today) status = 'vencida';
  return {
    id: row.id,
    reseller_id: row.reseller_id,
    client_id: row.client_id,
    client_name: row.client_name || '',
    company_id: row.company_id || null,
    plan_id: row.plan_id,
    plan_name: row.plan_name || '',
    credits: Number(row.credits) || 0,
    access_days: row.access_days != null ? Number(row.access_days) : null,
    previous_expires_at: row.previous_expires_at || null,
    new_expires_at: row.new_expires_at || null,
    starts_on: row.starts_on || null,
    expires_on: expiresOn,
    kind: row.kind || 'legacy',
    idempotency_key: row.idempotency_key || null,
    status,
    created_by: row.created_by || null,
    created_at: row.created_at || null,
  };
}

export function summarizeCreditEntries(entries) {
  const list = Array.isArray(entries) ? entries : [];
  return list.reduce((acc, entry) => {
    const amount = Number(entry?.amount) || 0;
    if (amount > 0) acc.credited += amount;
    if (amount < 0) acc.consumed += Math.abs(amount);
    return acc;
  }, { credited: 0, consumed: 0 });
}

export async function listResellerCreditEntries(client, resellerId = null, { limit = 500 } = {}) {
  const c = mustBeConfigured(client);
  let query = c
    .from('reseller_credit_entries')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (resellerId) query = query.eq('reseller_id', resellerId);
  const { data, error } = await query;
  if (error) requestError(error);
  return (data || []).map(fromSupabaseCreditEntry);
}

export async function listResellerActivations(client, resellerId = null, options = {}) {
  const { limit = 500, today } =
    /** @type {{ limit?: number, today?: string }} */ (options);
  const c = mustBeConfigured(client);
  let query = c
    .from('reseller_activations')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (resellerId) query = query.eq('reseller_id', resellerId);
  const { data, error } = await query;
  if (error) requestError(error);
  return (data || []).map((row) => fromSupabaseActivation(row, today));
}

export async function getResellerCreditBalance(client, resellerId = null) {
  const c = mustBeConfigured(client);
  const { data, error } = await c.rpc('reseller_credit_balance', {
    p_reseller_id: resellerId || null,
  });
  if (error) requestError(error);
  return Number(data) || 0;
}

export async function grantResellerCredits(client, resellerId, amount, reason = '') {
  const c = mustBeConfigured(client);
  if (!resellerId) throw new Error('Revendedor nao identificado');
  const value = Number(amount);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('Informe uma quantidade de creditos maior que zero');
  }
  const { data, error } = await c.rpc('grant_reseller_credits', {
    p_reseller_id: resellerId,
    p_amount: value,
    p_reason: String(reason || '').trim() || null,
  });
  if (error) requestError(error);
  return data;
}

export async function activateResellerClient(client, {
  clientId, planId, idempotencyKey,
}) {
  const c = mustBeConfigured(client);
  const validationError = validateActivationForm({ clientId, planId });
  if (validationError) throw new Error(validationError);
  const key = idempotencyKey || createActivationIdempotencyKey();
  const { data, error } = await c.rpc('activate_reseller_client_v2', {
    p_client_id: clientId,
    p_plan_id: planId,
    p_idempotency_key: key,
  });
  if (error) requestError(error);
  return data;
}
