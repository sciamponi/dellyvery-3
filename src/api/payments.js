// DELLVERY 3 — Recebimento de pagamento (declaração auditável, sem DDL).
//
// DIAGNÓSTICO: não existe RPC nem escrita legítima de `payment_status`
// (o guard `trg_orders_direct_write_guard` bloqueia UPDATE direto de
// colunas financeiras para `authenticated`; `manage_order` não tem ação
// de pagamento). Logo, este adapter NÃO altera `payment_status`, totais
// ou pedidos: registra a DECLARAÇÃO do operador em `audit_logs`
// (insert/select por membro via RLS, mesmo padrão de assignDriver/link),
// com autor e timestamp. O selo oficial continua vindo de
// `orders.payment_status`. Quitação real exige extensão do backend
// (ex.: ação de pagamento em `manage_order` + exceção no guard).
//
// Formas suportadas: as mesmas do PDV/checkout.

import { supabase as defaultClient } from './supabaseClient.js';

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
  const msg = error?.message || 'Erro na operação';
  throw new Error(msg);
}

export const RECEIPT_ACTION = 'order_payment_received';

export const SUPPORTED_PAYMENT_METHODS = ['Dinheiro', 'Pix', 'Cartão (na entrega)', 'Pix (na entrega)'];

export function validateReceipt({ amount, method }) {
  const v = Number(amount);
  if (amount === '' || amount === null || amount === undefined || !Number.isFinite(v) || v <= 0) {
    return 'Informe um valor recebido maior que 0';
  }
  if (!SUPPORTED_PAYMENT_METHODS.includes(method)) {
    return 'Escolha uma forma de pagamento suportada';
  }
  return null;
}

/** Recebimentos declarados do pedido (mais recente primeiro). */
export async function getPaymentReceipts(client, companyId, orderId) {
  const c = mustBeConfigured(client);
  const cid = requireCompanyId(companyId);
  if (!orderId) throw new Error('Pedido não identificado');
  const { data, error } = await c.from('audit_logs')
    .select('id,user_id,metadata,created_at')
    .eq('company_id', cid)
    .eq('entity', 'order')
    .eq('entity_id', orderId)
    .eq('action', RECEIPT_ACTION)
    .order('created_at', { ascending: false });
  if (error) rpcError(error);
  return (data || []).map((r) => ({
    id: r.id,
    userId: r.user_id || null,
    amount: Number(r.metadata?.amount) || 0,
    method: r.metadata?.method || '',
    notes: r.metadata?.notes || '',
    orderTotal: Number(r.metadata?.order_total) || 0,
    createdAt: r.created_at,
  }));
}

/**
 * Registra a declaração de recebimento. Só confirma após o insert no
 * banco (lança em falha de validação ou rede). Idempotência por
 * conferência prévia (getPaymentReceipts): o chamador bloqueia a UI
 * quando já existe registro; sem constraint no banco, corrida residual
 * gera 2 linhas (auditoria preserva ambas — sem perda nem falsificação).
 */
export async function registerOrderPayment(client, companyId, {
  orderId, orderStatus = '', amount, method, notes = '',
}) {
  const c = mustBeConfigured(client);
  const cid = requireCompanyId(companyId);
  if (!orderId) throw new Error('Pedido não identificado');
  const err = validateReceipt({ amount, method });
  if (err) throw new Error(err);
  const { data: sess } = await c.auth.getSession();
  const uid = sess?.session?.user?.id || null;
  const metadata = {
    amount: Number(amount),
    method,
    notes: String(notes || '').trim(),
    order_total: null,
    order_status: orderStatus || null,
  };
  const { data, error } = await c.from('audit_logs').insert({
    company_id: cid, user_id: uid, action: RECEIPT_ACTION,
    entity: 'order', entity_id: orderId, metadata,
  }).select().single();
  if (error) rpcError(error);
  // Linha auxiliar na timeline (mesmo status; recolhida junto às iguais).
  // Nunca bloqueia a confirmação.
  try {
    await c.from('order_status_history').insert({
      order_id: orderId, old_status: orderStatus || null, new_status: orderStatus || null,
      changed_by: uid, notes: `Recebimento declarado: ${method} ${Number(amount)}`,
    });
  } catch { /* auxiliar */ }
  return data;
}
