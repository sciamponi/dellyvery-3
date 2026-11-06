import { supabase as defaultClient } from './supabaseClient.js';
import { toWaNumber, buildWaUrl } from '../lib/whatsapp.js';

// DELLVERY 3 — Pacotes e pedidos de crédito da revenda.
// Preço, quantidade e moeda de um pedido são snapshots definidos pelo banco
// a partir do pacote no momento da solicitação. O frontend envia somente o
// pacote e a chave de idempotência.

const withClient = (client) => client || defaultClient;

function mustBeConfigured(client) {
  const c = withClient(client);
  if (!c) throw new Error('Supabase nao configurado (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)');
  return c;
}

function requestError(error) {
  throw new Error(error?.message || 'Erro na operacao');
}

export const RESELLER_CREDIT_ORDER_STATUSES = [
  { id: 'pendente', label: 'Aguardando pagamento' },
  { id: 'creditado', label: 'Creditado' },
  { id: 'cancelado', label: 'Cancelado' },
  { id: 'rejeitado', label: 'Rejeitado' },
  { id: 'expirado', label: 'Expirado' },
];

export function creditOrderStatusLabel(status) {
  return RESELLER_CREDIT_ORDER_STATUSES.find((item) => item.id === status)?.label || status || '-';
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

export function fromSupabaseCreditPackage(row) {
  if (!row) return row;
  return {
    id: row.id,
    name: row.name || '',
    description: row.description || '',
    credits: Number(row.credits) || 0,
    price: row.price != null ? Number(row.price) : 0,
    currency: row.currency || 'BRL',
    active: row.active ?? true,
    sort_order: Number(row.sort_order) || 0,
    created_by: row.created_by || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

export function toSupabaseCreditPackage(data = {}) {
  const out = {};
  if (data.name !== undefined) out.name = cleanText(data.name);
  if (data.description !== undefined) out.description = cleanText(data.description);
  if (data.credits !== undefined) out.credits = Number(data.credits);
  if (data.price !== undefined) out.price = Number(data.price);
  if (data.currency !== undefined) out.currency = cleanText(data.currency).toUpperCase() || 'BRL';
  if (data.active !== undefined) out.active = !!data.active;
  if (data.sort_order !== undefined) out.sort_order = Number(data.sort_order) || 0;
  return out;
}

export function validateCreditPackageForm(data = {}, { partial = false } = {}) {
  if (!partial || data.name !== undefined) {
    if (!cleanText(data.name)) return 'Informe o nome do pacote';
  }
  if (!partial || data.credits !== undefined) {
    const credits = Number(data.credits);
    if (!Number.isInteger(credits) || credits <= 0) {
      return 'Creditos devem ser um numero inteiro maior que zero';
    }
  }
  if (!partial || data.price !== undefined) {
    if (cleanText(data.price) === '') return 'Informe o preco do pacote';
    const price = Number(data.price);
    if (!Number.isFinite(price) || price < 0) {
      return 'Preco deve ser maior ou igual a zero';
    }
  }
  if (data.currency !== undefined) {
    const currency = cleanText(data.currency).toUpperCase() || 'BRL';
    if (!/^[A-Z]{3}$/.test(currency)) return 'Moeda invalida';
  }
  if (data.sort_order !== undefined && !Number.isInteger(Number(data.sort_order))) {
    return 'Ordem deve ser um numero inteiro';
  }
  return null;
}

export function fromSupabaseCreditOrder(row) {
  if (!row) return row;
  return {
    id: row.id,
    reseller_id: row.reseller_id,
    package_id: row.package_id,
    package_name: row.package_name || '',
    package_snapshot: row.package_snapshot
      && typeof row.package_snapshot === 'object'
      && !Array.isArray(row.package_snapshot)
      ? row.package_snapshot
      : {},
    credits: Number(row.credits) || 0,
    amount: row.amount != null ? Number(row.amount) : 0,
    confirmed_amount: row.confirmed_amount != null ? Number(row.confirmed_amount) : null,
    currency: row.currency || 'BRL',
    status: row.status || 'pendente',
    idempotency_key: row.idempotency_key || null,
    payment_reference: row.payment_reference || '',
    proof_url: row.proof_url || null,
    has_proof: !!(row.proof_url && String(row.proof_url).trim()),
    confirmed_by: row.confirmed_by || null,
    paid_at: row.paid_at || null,
    credited_at: row.credited_at || null,
    pending_expires_at: row.pending_expires_at || null,
    canceled_by: row.canceled_by || null,
    canceled_at: row.canceled_at || null,
    cancel_reason: row.cancel_reason || '',
    rejected_by: row.rejected_by || null,
    rejected_at: row.rejected_at || null,
    rejection_reason: row.rejection_reason || '',
    expired_at: row.expired_at || null,
    created_by: row.created_by || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

export async function listResellerCreditPackages(client, { includeInactive = false, limit = 200 } = {}) {
  const c = mustBeConfigured(client);
  let query = c
    .from('reseller_credit_packages')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(limit);
  if (!includeInactive) query = query.eq('active', true);
  const { data, error } = await query;
  if (error) requestError(error);
  return (data || []).map(fromSupabaseCreditPackage);
}

export async function createResellerCreditPackage(client, data) {
  const c = mustBeConfigured(client);
  const validationError = validateCreditPackageForm(data);
  if (validationError) throw new Error(validationError);
  const { data: row, error } = await c
    .from('reseller_credit_packages')
    .insert(toSupabaseCreditPackage(data))
    .select()
    .single();
  if (error) requestError(error);
  return fromSupabaseCreditPackage(row);
}

export async function updateResellerCreditPackage(client, id, data) {
  const c = mustBeConfigured(client);
  if (!id) throw new Error('Pacote nao identificado');
  const validationError = validateCreditPackageForm(data, { partial: true });
  if (validationError) throw new Error(validationError);
  const { data: row, error } = await c
    .from('reseller_credit_packages')
    .update(toSupabaseCreditPackage(data))
    .eq('id', id)
    .select()
    .single();
  if (error) requestError(error);
  return fromSupabaseCreditPackage(row);
}

export async function listResellerCreditOrders(client, { resellerId = null, status = null, hasProof = null, limit = 300 } = {}) {
  const c = mustBeConfigured(client);
  let query = c
    .from('reseller_credit_orders')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (resellerId) query = query.eq('reseller_id', resellerId);
  if (status) query = query.eq('status', status);
  if (hasProof === true) query = query.not('proof_url', 'is', null).neq('proof_url', '');
  if (hasProof === false) query = query.or('proof_url.is.null,proof_url.eq.');
  const { data, error } = await query;
  if (error) requestError(error);
  return (data || []).map(fromSupabaseCreditOrder);
}

export function creditUnitPrice(packageRow) {
  const credits = Number(packageRow?.credits) || 0;
  const price = Number(packageRow?.price) || 0;
  if (credits <= 0) return 0;
  return Math.round((price / credits) * 10000) / 10000;
}

export function creditChargeTotal(unitPrice, quantity) {
  const credits = Number(quantity);
  if (!Number.isInteger(credits) || credits <= 0) return 0;
  return Math.round((Number(unitPrice) || 0) * credits * 100) / 100;
}

export function buildCreditChargeMessage({
  name, credits, total, currency = 'BRL', pixKey, receiverName, instructions,
}) {
  const first = String(name || '').trim().split(/\s+/)[0] || 'tudo bem?';
  const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(Number(total) || 0);
  const lines = [
    `Olá, ${first}! Tudo bem?`,
    '',
    `Segue a cobrança de ${credits} créditos no valor de ${money}.`,
  ];
  if (pixKey) lines.push('', `Pix: ${pixKey}${receiverName ? ` (${receiverName})` : ''}`);
  if (instructions) lines.push('', instructions);
  lines.push(
    '',
    'Após o pagamento, envie o comprovante na sua área de Créditos para análise.',
  );
  return lines.join('\n');
}

export function buildCreditChargeUrl({
  phone, name, credits, total, currency, pixKey, receiverName, instructions,
}) {
  const to = toWaNumber(phone);
  if (!to) throw new Error('WhatsApp do revendedor inválido');
  return buildWaUrl(to, buildCreditChargeMessage({
    name, credits, total, currency, pixKey, receiverName, instructions,
  }));
}

export async function createResellerCreditCharge(client, { resellerId, credits, idempotencyKey }) {
  const c = mustBeConfigured(client);
  if (!resellerId) throw new Error('Revendedor nao identificado');
  const value = Number(credits);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('Informe uma quantidade inteira de creditos maior que zero');
  }
  if (!isValidIdempotencyKey(idempotencyKey)) throw new Error('Chave de idempotencia invalida');
  const { data, error } = await c.rpc('create_reseller_credit_charge', {
    p_reseller_id: resellerId,
    p_credits: value,
    p_idempotency_key: idempotencyKey,
  });
  if (error) requestError(error);
  return data;
}

export async function submitResellerCreditOrderProof(client, { orderId, paymentReference, proofUrl }) {
  const c = mustBeConfigured(client);
  if (!orderId) throw new Error('Pedido nao identificado');
  const reference = cleanText(paymentReference);
  if (!reference) throw new Error('Informe a referencia do pagamento');
  const proof = cleanText(proofUrl);
  if (!proof) throw new Error('Envie o comprovante');
  const { data, error } = await c.rpc('submit_reseller_credit_order_proof', {
    p_order_id: orderId,
    p_payment_reference: reference,
    p_proof_url: proof,
  });
  if (error) requestError(error);
  return data;
}

export async function createResellerCreditOrder(client, { packageId, idempotencyKey }) {
  const c = mustBeConfigured(client);
  if (!packageId) throw new Error('Pacote nao informado');
  if (!isValidIdempotencyKey(idempotencyKey)) throw new Error('Chave de idempotencia invalida');
  const { data, error } = await c.rpc('create_reseller_credit_order', {
    p_package_id: packageId,
    p_idempotency_key: idempotencyKey,
  });
  if (error) requestError(error);
  return data;
}

export async function cancelResellerCreditOrder(client, orderId, reason = '') {
  const c = mustBeConfigured(client);
  if (!orderId) throw new Error('Pedido nao identificado');
  const { data, error } = await c.rpc('cancel_reseller_credit_order', {
    p_order_id: orderId,
    p_reason: cleanText(reason) || null,
  });
  if (error) requestError(error);
  return data;
}

export async function confirmResellerCreditOrder(
  client,
  orderId,
  paymentReference,
  confirmedAmount,
) {
  const c = mustBeConfigured(client);
  if (!orderId) throw new Error('Pedido nao identificado');
  const reference = cleanText(paymentReference);
  if (!reference) throw new Error('Informe a referencia do pagamento');
  if (confirmedAmount === undefined || confirmedAmount === null || cleanText(confirmedAmount) === '') {
    throw new Error('Informe o valor confirmado');
  }
  const amount = Number(confirmedAmount);
  if (!Number.isFinite(amount) || amount < 0) throw new Error('Valor confirmado invalido');
  const { data, error } = await c.rpc('confirm_reseller_credit_order', {
    p_order_id: orderId,
    p_confirmed_amount: amount,
    p_payment_reference: reference,
  });
  if (error) requestError(error);
  return data;
}

export async function rejectResellerCreditOrder(client, orderId, reason) {
  const c = mustBeConfigured(client);
  if (!orderId) throw new Error('Pedido nao identificado');
  const normalizedReason = cleanText(reason);
  if (!normalizedReason) throw new Error('Informe o motivo da rejeicao');
  const { data, error } = await c.rpc('reject_reseller_credit_order', {
    p_order_id: orderId,
    p_reason: normalizedReason,
  });
  if (error) requestError(error);
  return data;
}

export async function expireResellerCreditOrders(client) {
  const c = mustBeConfigured(client);
  const { data, error } = await c.rpc('expire_reseller_credit_orders');
  if (error) requestError(error);
  return Number(data) || 0;
}

export async function getCreditOrderExpiryDays(client) {
  const c = mustBeConfigured(client);
  const { data, error } = await c
    .from('platform_settings')
    .select('credit_order_expiry_days')
    .eq('id', true)
    .single();
  if (error) requestError(error);
  return data?.credit_order_expiry_days ?? null;
}

export async function setCreditOrderExpiryDays(client, days) {
  const c = mustBeConfigured(client);
  const normalized = days === undefined || days === null || cleanText(days) === ''
    ? null
    : Number(days);
  if (normalized !== null && (!Number.isInteger(normalized) || normalized <= 0)) {
    throw new Error('Dias de validade devem ser um inteiro maior que zero');
  }
  const { data, error } = await c.rpc('set_credit_order_expiry_days', {
    p_days: normalized,
  });
  if (error) requestError(error);
  return data?.credit_order_expiry_days ?? null;
}
