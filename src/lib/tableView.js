// DELLVERY 3 — Nome da mesa no pedido (puro, testável).
// Usa o vínculo real (order.table_id -> dining_tables.id); nunca deduz
// pelo nome/código. Sem mesa vinculada ou com mesa ausente: neutro.
import { isOpenOrder } from './orderStatusView.js';

/** Resolve { name, missing } para exibição. */
export function resolveTableName(order, tablesById) {
  const tableId = order?.table_id || null;
  if (!tableId) return { name: null, missing: false };
  const found = (tablesById || {})[tableId] || null;
  if (found && (found.name || '').trim() !== '') {
    return { name: String(found.name).trim(), missing: false };
  }
  const fallback = String(order?.table_number || '').trim();
  if (fallback !== '') return { name: fallback, missing: false };
  return { name: null, missing: true };
}

/**
 * Pedidos em aberto de uma mesa, pelo vínculo real table_id.
 * Abertos = qualquer status operacional exceto cancelado/finalizado
 * (status desconhecido NÃO é descartado silenciosamente: continua
 * listado; financeiro — pago ou não — nunca exclui). Sem limite além
 * do lote de origem.
 */
export function filterOpenTableOrders(orders, tableId) {
  if (!tableId) return [];
  return (orders || []).filter((o) => o?.table_id === tableId && isOpenOrder(o));
}
