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

export const PLAN_PURCHASE_STATUSES = [
  { id: 'pendente', label: 'Aguardando pagamento' },
  { id: 'confirmada', label: 'Confirmada' },
  { id: 'rejeitada', label: 'Rejeitada' },
  { id: 'cancelada', label: 'Cancelada' },
  { id: 'expirada', label: 'Expirada' },
];

export function planPurchaseStatusLabel(status) {
  return PLAN_PURCHASE_STATUSES.find((item) => item.id === status)?.label || status || '-';
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidIdempotencyKey(value) {
  return UUID_RE.test(String(value || ''));
}

export function newIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function cleanText(value) {
  return String(value ?? '').trim();
}

function nullableText(value, max, label) {
  const normalized = cleanText(value);
  if (!normalized) return null;
  if (normalized.length > max) throw new Error(`${label} muito longo`);
  return normalized;
}

export function fromSupabasePlanPurchase(row) {
  if (!row) return row;
  return {
    id: row.id,
    company_id: row.company_id,
    requested_by: row.requested_by || null,
    plan_id: row.plan_id,
    plan_name: row.plan_name_snapshot || '',
    plan_slug: row.plan_slug_snapshot || '',
    price: row.price_snapshot != null ? Number(row.price_snapshot) : 0,
    currency: row.currency_snapshot || 'BRL',
    billing_cycle: row.billing_cycle_snapshot || '',
    access_days: Number(row.access_days_snapshot) || 0,
    status: row.status || 'pendente',
    payment_method: row.payment_method || 'pix',
    payment_reference: row.payment_reference || '',
    has_proof: !!row.has_proof || !!row.proof_url,
    proof_url: row.proof_url || null,
    payer_name: row.payer_name || '',
    confirmed_amount: row.confirmed_amount != null ? Number(row.confirmed_amount) : null,
    confirmed_currency: row.confirmed_currency || null,
    confirmed_at: row.confirmed_at || null,
    rejected_at: row.rejected_at || null,
    canceled_at: row.canceled_at || null,
    expired_at: row.expired_at || null,
    reason: row.reason || '',
    pending_expires_at: row.pending_expires_at || null,
    pix_settings_version: row.pix_settings_version ?? null,
    activated_at: row.activated_at || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

export function fromSupabasePixInstructions(row) {
  if (!row) return row;
  return {
    request_id: row.request_id,
    status: row.status || 'pendente',
    plan_name: row.plan_name || '',
    price: row.price != null ? Number(row.price) : 0,
    currency: row.currency || 'BRL',
    pending_expires_at: row.pending_expires_at || null,
    configured: !!row.configured,
    active: !!row.active,
    available: !!row.available,
    pix_key_type: row.pix_key_type || null,
    pix_key: row.pix_key || null,
    receiver_name: row.receiver_name || null,
    qr_image_url: row.qr_image_url || null,
    qr_image_path: row.qr_image_path || null,
    qr_payload: row.qr_payload || null,
    instructions: row.instructions || null,
    version: row.version ?? null,
    request_version: row.request_version ?? null,
    version_changed: !!row.version_changed,
  };
}

/**
 * @param {*} client
 * @param {object} [params]
 * @param {string} [params.companyId]
 * @param {string} [params.planId]
 * @param {string} [params.idempotencyKey]
 */
export async function createPlanPurchaseRequest(client, { companyId, planId, idempotencyKey } = {}) {
  const c = mustBeConfigured(client);
  if (!companyId) throw new Error('Empresa nao informada');
  if (!planId) throw new Error('Plano nao informado');
  if (!isValidIdempotencyKey(idempotencyKey)) throw new Error('Chave de idempotencia invalida');
  const { data, error } = await c.rpc('create_plan_purchase_request', {
    p_company_id: companyId,
    p_plan_id: planId,
    p_idempotency_key: idempotencyKey,
  });
  if (error) requestError(error);
  return data;
}

/**
 * @param {*} client
 * @param {string} requestId
 * @param {object} [params]
 * @param {string} [params.paymentReference]
 * @param {string|null} [params.proofUrl]
 * @param {string|null} [params.payerName]
 */
export async function submitPlanPurchasePayment(
  client,
  requestId,
  { paymentReference, proofUrl = null, payerName = null } = {},
) {
  const c = mustBeConfigured(client);
  if (!requestId) throw new Error('Solicitacao nao identificada');
  const reference = cleanText(paymentReference);
  if (!reference) throw new Error('Informe a referencia do pagamento');
  if (reference.length > 200) throw new Error('Referencia de pagamento muito longa');
  const { data, error } = await c.rpc('submit_plan_purchase_payment', {
    p_request_id: requestId,
    p_payment_reference: reference,
    p_proof_url: nullableText(proofUrl, 1000, 'URL do comprovante'),
    p_payer_name: nullableText(payerName, 200, 'Nome do pagador'),
  });
  if (error) requestError(error);
  return data;
}

export async function cancelPlanPurchaseRequest(client, requestId, reason = '') {
  const c = mustBeConfigured(client);
  if (!requestId) throw new Error('Solicitacao nao identificada');
  const { data, error } = await c.rpc('cancel_plan_purchase_request', {
    p_request_id: requestId,
    p_reason: nullableText(reason, 1000, 'Motivo'),
  });
  if (error) requestError(error);
  return data;
}

export async function getMyPlanPurchaseRequests(client, companyId) {
  const c = mustBeConfigured(client);
  if (!companyId) throw new Error('Empresa nao informada');
  const { data, error } = await c.rpc('get_my_plan_purchase_requests', {
    p_company_id: companyId,
  });
  if (error) requestError(error);
  return (data || []).map(fromSupabasePlanPurchase);
}

export async function getPlanPurchasePixInstructions(client, requestId) {
  const c = mustBeConfigured(client);
  if (!requestId) throw new Error('Solicitacao nao identificada');
  const { data, error } = await c.rpc('get_plan_purchase_pix_instructions', {
    p_request_id: requestId,
  });
  if (error) requestError(error);
  return fromSupabasePixInstructions(data);
}

export async function expirePlanPurchaseRequests(client) {
  const c = mustBeConfigured(client);
  const { data, error } = await c.rpc('expire_plan_purchase_requests');
  if (error) requestError(error);
  return Number(data) || 0;
}
