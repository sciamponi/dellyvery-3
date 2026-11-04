import { supabase as defaultClient } from './supabaseClient.js';
import {
  PLAN_PURCHASE_STATUSES,
  fromSupabasePlanPurchase,
} from './planPurchases.js';

const withClient = (client) => client || defaultClient;

function mustBeConfigured(client) {
  const c = withClient(client);
  if (!c) throw new Error('Supabase nao configurado (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)');
  return c;
}

function requestError(error) {
  throw new Error(error?.message || 'Erro na operacao');
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

const MASTER_STATUSES = [...PLAN_PURCHASE_STATUSES.map((item) => item.id), 'todas'];
export const PIX_KEY_TYPES = [
  { id: 'cpf', label: 'CPF' },
  { id: 'cnpj', label: 'CNPJ' },
  { id: 'email', label: 'E-mail' },
  { id: 'phone', label: 'Telefone' },
  { id: 'random', label: 'Chave aleatoria' },
];

export function fromMasterPlanPurchase(row) {
  if (!row) return row;
  return {
    ...fromSupabasePlanPurchase(row),
    company_name: row.company_name || '',
    company_slug: row.company_slug || '',
    requested_by_name: row.requested_by_name || '',
    requested_by_email: row.requested_by_email || '',
    reseller_client_id: row.reseller_client_id || null,
    reseller_client_status: row.reseller_client_status || '',
    reseller_id: row.reseller_id || null,
    reseller_name: row.reseller_name || '',
    reseller_email: row.reseller_email || '',
    queue_order: Number(row.queue_order) || 0,
  };
}

export function fromPlatformPixSettings(row) {
  if (!row) return null;
  return {
    active: !!row.active,
    pix_key_type: row.pix_key_type || '',
    pix_key: row.pix_key || '',
    receiver_name: row.receiver_name || '',
    qr_image_url: row.qr_image_url || '',
    qr_image_path: row.qr_image_path || '',
    qr_payload: row.qr_payload || '',
    instructions: row.instructions || '',
    version: row.version ?? null,
    updated_at: row.updated_at || null,
    updated_by: row.updated_by || null,
    previous_qr_image_path: row.previous_qr_image_path || '',
  };
}

export function validatePixSettings(data = {}) {
  const active = !!data.active;
  const keyType = cleanText(data.pix_key_type);
  const key = cleanText(data.pix_key);
  if (keyType && !PIX_KEY_TYPES.some((item) => item.id === keyType)) return 'Tipo de chave Pix invalido';
  if (active && !key) return 'Informe a chave Pix para ativar as instrucoes';
  if (key.length > 500) return 'Chave Pix muito longa';
  if (cleanText(data.receiver_name).length > 200) return 'Nome do recebedor muito longo';
  if (cleanText(data.qr_image_url).length > 1000) return 'URL do QR Code muito longa';
  if (cleanText(data.qr_payload).length > 4000) return 'Payload do QR Code muito longo';
  if (cleanText(data.instructions).length > 2000) return 'Instrucoes muito longas';
  return null;
}

export async function listPlanPurchaseRequests(client, { status = 'pendente' } = {}) {
  const c = mustBeConfigured(client);
  const normalized = status === null ? null : cleanText(status) || 'pendente';
  if (normalized !== null && !MASTER_STATUSES.includes(normalized)) throw new Error('Status invalido');
  const { data, error } = await c.rpc('list_plan_purchase_requests', { p_status: normalized });
  if (error) requestError(error);
  return (data || []).map(fromMasterPlanPurchase);
}

/**
 * @param {any} client
 * @param {string} requestId
 * @param {{ confirmedAmount?: any, paymentReference?: any, reason?: any }} [data]
 */
export async function confirmPlanPurchaseRequest(
  client,
  requestId,
  { confirmedAmount, paymentReference, reason = null } = {},
) {
  const c = mustBeConfigured(client);
  if (!requestId) throw new Error('Solicitacao nao identificada');
  if (confirmedAmount === undefined || confirmedAmount === null || cleanText(confirmedAmount) === '') {
    throw new Error('Informe o valor confirmado');
  }
  const amount = Number(confirmedAmount);
  if (!Number.isFinite(amount) || amount < 0) throw new Error('Valor confirmado invalido');
  const reference = cleanText(paymentReference);
  if (!reference) throw new Error('Informe a referencia do pagamento');
  if (reference.length > 200) throw new Error('Referencia de pagamento muito longa');
  const { data, error } = await c.rpc('confirm_plan_purchase_request', {
    p_request_id: requestId,
    p_confirmed_amount: amount,
    p_payment_reference: reference,
    p_reason: nullableText(reason, 1000, 'Motivo'),
  });
  if (error) requestError(error);
  return data;
}

export async function rejectPlanPurchaseRequest(client, requestId, reason) {
  const c = mustBeConfigured(client);
  if (!requestId) throw new Error('Solicitacao nao identificada');
  const normalizedReason = cleanText(reason);
  if (!normalizedReason) throw new Error('Informe o motivo da rejeicao');
  if (normalizedReason.length > 1000) throw new Error('Motivo muito longo');
  const { data, error } = await c.rpc('reject_plan_purchase_request', {
    p_request_id: requestId,
    p_reason: normalizedReason,
  });
  if (error) requestError(error);
  return data;
}

export async function getPlatformPixSettings(client) {
  const c = mustBeConfigured(client);
  const { data, error } = await c.rpc('get_platform_pix_settings');
  if (error) requestError(error);
  return fromPlatformPixSettings(data);
}

export async function setPlatformPixSettings(client, data = {}) {
  const c = mustBeConfigured(client);
  const validationError = validatePixSettings(data);
  if (validationError) throw new Error(validationError);
  const { data: row, error } = await c.rpc('set_platform_pix_settings', {
    p_active: !!data.active,
    p_pix_key_type: nullableText(data.pix_key_type, 20, 'Tipo de chave Pix'),
    p_pix_key: nullableText(data.pix_key, 500, 'Chave Pix'),
    p_receiver_name: nullableText(data.receiver_name, 200, 'Nome do recebedor'),
    p_qr_image_url: nullableText(data.qr_image_url, 1000, 'URL do QR Code'),
    p_qr_payload: nullableText(data.qr_payload, 4000, 'Payload do QR Code'),
    p_instructions: nullableText(data.instructions, 2000, 'Instrucoes'),
  });
  if (error) requestError(error);
  return fromPlatformPixSettings(row);
}

export async function getPlanPurchaseExpiryDays(client) {
  const c = mustBeConfigured(client);
  const { data, error } = await c
    .from('platform_settings')
    .select('plan_purchase_expiry_days')
    .eq('id', true)
    .single();
  if (error) requestError(error);
  return data?.plan_purchase_expiry_days ?? null;
}

export async function setPlanPurchaseExpiryDays(client, days) {
  const c = mustBeConfigured(client);
  const normalized = days === undefined || days === null || cleanText(days) === ''
    ? null
    : Number(days);
  if (normalized !== null && (!Number.isInteger(normalized) || normalized <= 0)) {
    throw new Error('Dias de validade devem ser um inteiro maior que zero');
  }
  const { data, error } = await c.rpc('set_plan_purchase_expiry_days', { p_days: normalized });
  if (error) requestError(error);
  return data?.plan_purchase_expiry_days ?? null;
}
