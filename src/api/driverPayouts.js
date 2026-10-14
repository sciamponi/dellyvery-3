import { supabase as defaultClient } from './supabaseClient.js';
import { isEligibleOrder } from '../lib/driverPayout.js';

// DELLVERY 3 — Fechamento de taxas dos entregadores.
// Leitura por membro (RLS); escrita OWNER/ADMIN/MANAGER (RLS).
// Segurança real no banco: trigger valida elegibilidade (empresa,
// entregador, status finalizado) e UNIQUE(order_id) impede pagar duas
// vezes. Aqui: escopo por empresa + mensagens claras + snapshot dos
// valores (fee sempre do pedido, nunca do cliente).

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

export async function listPayouts(client, companyId, { driverId = null, limit = 50 } = {}) {
  const c = mustBeConfigured(client);
  let q = c.from('driver_payouts')
    .select('*').eq('company_id', requireCompanyId(companyId))
    .order('created_at', { ascending: false }).limit(limit);
  if (driverId) q = q.eq('driver_id', driverId);
  const { data, error } = await q;
  if (error) rpcError(error);
  return data || [];
}

export async function getPayoutItems(client, payoutId) {
  const c = mustBeConfigured(client);
  if (!payoutId) throw new Error('Fechamento não identificado');
  const { data, error } = await c.from('driver_payout_items')
    .select('order_id,fee,created_at').eq('payout_id', payoutId);
  if (error) rpcError(error);
  return data || [];
}

// Fecha um lote: valida elegibilidade no cliente (mensagem) e delega a
// barreira final ao banco (trigger + UNIQUE). Retorna o fechamento.
export async function createPayout(client, companyId, { driverId, periodStart, periodEnd, orders }) {
  const c = mustBeConfigured(client);
  const cid = requireCompanyId(companyId);
  if (!driverId) throw new Error('Escolha o entregador');
  if (!periodStart || !periodEnd) throw new Error('Informe o período');
  const eligible = (Array.isArray(orders) ? orders : []).filter(isEligibleOrder)
    .filter((o) => o.driver_id === driverId);
  if (eligible.length === 0) throw new Error('Nenhuma entrega elegível selecionada');
  const totalFee = eligible.reduce((s, o) => s + (Number(o.delivery_fee) || 0), 0);
  const { data: payout, error: pErr } = await c.from('driver_payouts').insert({
    company_id: cid, driver_id: driverId,
    period_start: periodStart, period_end: periodEnd, status: 'pago',
    total_orders: eligible.length, total_fee: totalFee, paid_amount: totalFee,
  }).select().single();
  if (pErr) rpcError(pErr);
  const { error: iErr } = await c.from('driver_payout_items').insert(
    eligible.map((o) => ({
      payout_id: payout.id, order_id: o.id, fee: Number(o.delivery_fee) || 0,
    })),
  );
  if (iErr) {
    // Lote parcial não pode ficar: remove o cabeçalho (itens caem em cascata
    // se algum passou; se nenhum passou, remove só o cabeçalho vazio).
    await c.from('driver_payouts').delete().eq('id', payout.id);
    const msg = `${iErr.message || ''} ${iErr.code || ''}`;
    if (/uq_payout_item_order|duplicate|23505/i.test(msg)) {
      throw new Error('Uma dessas entregas já foi paga em outro fechamento');
    }
    if (/concluídas|outro entregador|outra empresa/i.test(msg)) {
      throw new Error(iErr.message);
    }
    rpcError(iErr);
  }
  return payout;
}

export async function paidOrderIds(client, companyId, driverId) {
  const c = mustBeConfigured(client);
  const cid = requireCompanyId(companyId);
  // Escopo por empresa via join implícito: busca payouts da empresa/driver
  // e extrai os pedidos (2 consultas, sem N+1 por pedido).
  let pq = c.from('driver_payouts').select('id').eq('company_id', cid);
  if (driverId) pq = pq.eq('driver_id', driverId);
  const { data: payouts, error: pErr } = await pq;
  if (pErr) rpcError(pErr);
  const ids = (payouts || []).map((p) => p.id);
  if (ids.length === 0) return [];
  const { data: items, error: iErr } = await c.from('driver_payout_items')
    .select('order_id').in('payout_id', ids);
  if (iErr) rpcError(iErr);
  return (items || []).map((i) => i.order_id).filter(Boolean);
}
