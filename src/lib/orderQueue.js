// DELLVERY 3 — Regras de fila/atraso (fonte única, extraída de Pedidos.jsx).
// "Na fila": status não-terminal de atendimento.
// "Em atraso": na fila há mais de 30 min (created_date/created_at).
export const QUEUE_STATUSES = ['novo', 'confirmado', 'em_preparo', 'aguardando_retirada', 'saiu_entrega'];

export const DELAY_MINUTES = 30;

export function isInQueue(order) {
  return !!order && QUEUE_STATUSES.includes(order.status);
}

export function waitMinutes(dateStr, now = Date.now()) {
  if (!dateStr) return 0;
  return Math.floor((now - new Date(dateStr).getTime()) / 60000);
}

export function isDelayed(order, now = Date.now()) {
  if (!isInQueue(order)) return false;
  return waitMinutes(order.created_date || order.created_at, now) > DELAY_MINUTES;
}

export function getQueueOrders(orders) {
  return (orders || []).filter(isInQueue);
}

export function getDelayedOrders(orders, now = Date.now()) {
  return getQueueOrders(orders).filter((o) => isDelayed(o, now));
}

export function isFinalized(order) {
  return !!order && order.status === 'finalizado';
}

export function getFinalized(orders) {
  return (orders || []).filter(isFinalized);
}

export function getFinalizedByType(orders, orderType) {
  return getFinalized(orders).filter((o) => o.order_type === orderType);
}

export function getCanceled(orders) {
  return (orders || []).filter((o) => o && o.status === 'cancelado');
}

export function filterByDriver(orders, driverId) {
  if (!driverId || driverId === 'all') return orders || [];
  if (driverId === 'none') return (orders || []).filter((o) => !o.driver_id);
  return (orders || []).filter((o) => o.driver_id === driverId);
}
