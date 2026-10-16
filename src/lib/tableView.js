// DELLVERY 3 — Nome da mesa no pedido (puro, testável).
// Usa o vínculo real (order.table_id -> dining_tables.id); nunca deduz
// pelo nome/código. Sem mesa vinculada ou com mesa ausente: neutro.

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
