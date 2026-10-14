// DELLVERY 3 — Apuração de taxas por entregador (puro, testável).
// Elegível: pedido com entregador atribuído E status finalizado
// (concluído). Cancelados e não concluídos nunca entram. Qualquer tipo
// de atendimento conta, desde que concluído com entregador — documentado.
// Valor: SEMPRE delivery_fee registrado no pedido (nunca do cliente).
// Duplicidade: UNIQUE(order_id) no banco; aqui, espelho para mensagens.

export const PAYOUT_DONE_STATUS = 'finalizado';
export const PAYOUT_CANCELED_STATUS = 'cancelado';

export function isEligibleOrder(order) {
  if (!order || !order.driver_id) return false;
  if (order.status === PAYOUT_CANCELED_STATUS) return false;
  return order.status === PAYOUT_DONE_STATUS;
}

export function eligibleOrders(orders, driverId) {
  return (Array.isArray(orders) ? orders : []).filter(
    (o) => (!driverId || o?.driver_id === driverId) && isEligibleOrder(o),
  );
}

// Totais congelados no fechamento (snapshot): soma dos fees registrados.
export function summarizePayout(orders) {
  const list = (Array.isArray(orders) ? orders : []).filter(isEligibleOrder);
  const totalFee = list.reduce((s, o) => s + (Number(o.delivery_fee) || 0), 0);
  return { count: list.length, totalFee };
}

// Linhas já pagas (ids de pedidos em fechamentos) — para excluir da lista
// de elegíveis e detectar tentativa de pagamento duplo antes da rede
// (o banco barra de qualquer forma via UNIQUE).
export function excludePaidOrders(orders, paidOrderIds) {
  const paid = new Set(paidOrderIds || []);
  return (Array.isArray(orders) ? orders : []).filter((o) => o && !paid.has(o.id));
}

export function orderIdsOf(items) {
  return (Array.isArray(items) ? items : []).map((i) => i?.order_id).filter(Boolean);
}

// CSV do relatório (separador ; para Excel pt-BR). Só dados já listados.
export function buildPayoutCsv({ driverName, periodLabel, orders, total }) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const money = (v) => Number(v || 0).toFixed(2).replace('.', ',');
  const lines = [
    'Entregador;' + q(driverName) + ';Período;' + q(periodLabel),
    'Pedido;Data;Status;Taxa (R$)',
  ];
  for (const o of orders || []) {
    lines.push([o.order_number ?? o.id, o.created_date ?? '', o.status ?? '', money(o.delivery_fee)].map(q).join(';'));
  }
  lines.push('TOTAL;;' + (orders || []).length + ' entrega(s);' + money(total));
  return lines.join('\r\n');
}
