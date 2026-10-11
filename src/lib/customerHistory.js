// DELLVERY 3 — Histórico do cliente para o selo "primeiro pedido" (puro).
//
// Regra de negócio (documentada):
// - A lista de entrada já vem isolada por empresa (RLS); nunca cruzar empresas.
// - Histórico = outros pedidos com o MESMO customer_id, excluindo o próprio
//   pedido e excluindo CANCELADOS (cancelado nunca concluiu negócio: um
//   cancelado anterior não tira a condição de "primeiro").
// - Pedido SEM customer_id nunca é "primeiro" (dado insuficiente — avulso
//   não se confunde com cliente novo).
// - O próprio pedido cancelado nunca recebe o selo.
// - Sem N+1: opera sobre a lista já carregada (Kanban) ou o histórico já
//   buscado (modal); nenhuma consulta nova por card.

export function getCustomerHistory(order, orders) {
  if (!order?.customer_id) return [];
  return (orders || []).filter((o) =>
    o && o.id !== order.id
    && o.customer_id && o.customer_id === order.customer_id
    && o.status !== 'cancelado',
  );
}

export function isFirstOrder(order, orders) {
  if (!order || !order.customer_id) return false;
  if (order.status === 'cancelado') return false;
  return getCustomerHistory(order, orders).length === 0;
}
