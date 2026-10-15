import { supabase as defaultClient } from './supabaseClient.js';
import { shouldQueueDriverNotify, missingDriverReason } from '../lib/driverNotify.js';

// DELLVERY 3 — Adapter driver_notifications (operação/entrega).
// Registra o encaminhamento do pedido ao entregador com status explícito:
// 'pendente' → 'iniciado' (link wa.me aberto manualmente) → 'confirmado'
// (somente pela integração validada). Abrir o link NUNCA marca "enviado".
// RLS por empresa no banco; company_id sempre do contexto, nunca do payload.

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

export const DRIVER_NOTIF_STATUSES = ['pendente', 'iniciado', 'confirmado'];

export function nextDriverNotifStatus(current) {
  if (current === 'pendente') return 'iniciado';
  if (current === 'iniciado') return 'confirmado';
  return null;
}

// Garante UM registro pendente por pedido+entregador (idempotente):
// re-renderizações, retries e transições repetidas reutilizam a linha
// existente em vez de duplicar. Troca de entregador abre linha nova
// (histórico preservado). 'confirmado' é terminal (não reabre).
// Falha de rede aqui NÃO deve reverter o status do pedido: o chamador
// trata o erro e mantém a operação (reenvio controlado depois).
export async function ensureDriverPending(client, companyId, { orderId, driverId = null, message = '' }) {
  const c = mustBeConfigured(client);
  if (!orderId) throw new Error('Pedido não identificado');
  const company_id = requireCompanyId(companyId);
  const existing = await getDriverNotification(c, company_id, orderId, driverId);
  if (existing
      && (existing.status === 'pendente' || existing.status === 'iniciado')
      && (driverId == null || existing.driver_id === driverId)) {
    return existing;
  }
  if (existing && existing.status === 'confirmado'
      && (driverId == null || existing.driver_id === driverId)) {
    return existing;
  }
  const { data, error } = await c.from('driver_notifications').insert({
    company_id, order_id: orderId, driver_id: driverId, channel: 'whatsapp',
    status: 'pendente', message: message || null,
  }).select().maybeSingle();
  if (error) rpcError(error);
  return data;
}

export async function getDriverNotification(client, companyId, orderId, driverId) {
  const c = mustBeConfigured(client);
  let q = c.from('driver_notifications').select('*')
    .eq('company_id', requireCompanyId(companyId))
    .eq('order_id', orderId);
  if (driverId) q = q.eq('driver_id', driverId);
  const { data, error } = await q.order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) rpcError(error);
  return data || null;
}

export async function markDriverNotified(client, companyId, { orderId, driverId = null, message = '' }) {  const c = mustBeConfigured(client);
  if (!orderId) throw new Error('Pedido não identificado');
  const company_id = requireCompanyId(companyId);
  const existing = await getDriverNotification(c, company_id, orderId, driverId);
  if (existing) {
    // Avança no máximo até 'iniciado' por ação manual; 'confirmado' só via integração.
    const next = nextDriverNotifStatus(existing.status);
    if (!next || next === 'confirmado') return existing;
    const { data, error } = await c.from('driver_notifications')
      .update({ status: next, message: message || existing.message })
      .eq('id', existing.id)
      .select().maybeSingle();
    if (error) rpcError(error);
    return data || existing;
  }
  const { data, error } = await c.from('driver_notifications').insert({
    company_id, order_id: orderId, driver_id: driverId, channel: 'whatsapp',
    status: 'iniciado', message: message || null,
  }).select().maybeSingle();
  if (error) rpcError(error);
  return data;
}

// Enfileira o aviso na transição para saiu_entrega (delivery).
// Com entregador: garante o pendente (idempotente). Sem entregador:
// registra o motivo (auditoria) em vez de enviar. Fora desses casos:
// null, sem tocar no banco. Falha de rede lança (o chamador decide;
// nunca reverter o status por causa do aviso).
export async function queueDriverNotifyForStatus(client, companyId, order, newStatus) {
  const c = mustBeConfigured(client);
  const cid = requireCompanyId(companyId);
  if (!order?.id) throw new Error('Pedido não identificado');
  if (shouldQueueDriverNotify(order, newStatus)) {
    return ensureDriverPending(c, cid, { orderId: order.id, driverId: order.driver_id });
  }
  const reason = missingDriverReason(order, newStatus);
  if (!reason) return null;
  return ensureDriverPending(c, cid, { orderId: order.id, driverId: null, message: reason });
}
