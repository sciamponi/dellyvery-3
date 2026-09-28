// Comandas de mesa derivadas de pedidos ativos.
//
// Não existe entidade Mesa no banco: a mesa é `orders.table_number` (texto)
// e cada comanda é um pedido `order_type='mesa'` com status não-terminal.
// Este módulo só agrupa/deriva — nunca persiste nada.

export const ACTIVE_COMANDA_STATUSES = [
  'novo',
  'confirmado',
  'em_preparo',
  'aguardando_retirada',
  'saiu_entrega',
];

export function isActiveComanda(order) {
  return !!order
    && order.order_type === 'mesa'
    && ACTIVE_COMANDA_STATUSES.includes(order.status);
}

export function normalizeTable(value) {
  return String(value ?? '').trim();
}

// Resumo de uma comanda para listagem (pedido já mapeado pelo adapter).
export function comandaSummary(order) {
  const items = Array.isArray(order.items) ? order.items : [];
  return {
    id: order.id,
    order_number: order.order_number,
    table: normalizeTable(order.table_number),
    customerName: order.customer_name || order.customer_data?.name || '',
    phone: order.customer_phone || order.customer_data?.phone || '',
    total: Number(order.total) || 0,
    itemCount: items.reduce((s, i) => s + (Number(i.quantity) || 0), 0),
    status: order.status,
  };
}

// Agrupa comandas ativas por mesa, ordenadas pelo número da mesa.
export function groupComandasByTable(orders) {
  const byTable = new Map();
  for (const order of orders || []) {
    if (!isActiveComanda(order)) continue;
    const table = normalizeTable(order.table_number);
    if (!table) continue;
    if (!byTable.has(table)) byTable.set(table, []);
    byTable.get(table).push(comandaSummary(order));
  }
  return [...byTable.entries()]
    .map(([table, comandas]) => ({
      table,
      comandas: comandas.sort((a, b) => (a.order_number || 0) - (b.order_number || 0)),
      // 🟢 livre não é derivável (mesa sem pedido não aparece aqui);
      // 🔴 ocupada = 1 comanda ativa, 🟡 múltiplas = 2+.
      status: comandas.length > 1 ? 'multipla' : 'ocupada',
    }))
    .sort((a, b) => a.table.localeCompare(b.table, 'pt-BR', { numeric: true }));
}

export function comandasTotal(comandas) {
  return (comandas || []).reduce((s, c) => s + (Number(c.total) || 0), 0);
}

// Achata itens de várias comandas no formato aceito por editOrder
// (product_id/quantity/complements/notes). Não soma linhas: o backend
// recalcula preços/totais a partir do catálogo.
export function mergeComandaItems(itemLists) {
  const out = [];
  for (const list of itemLists || []) {
    for (const i of list || []) {
      if (!i?.product_id || !(Number(i.quantity) > 0)) continue;
      out.push({
        product_id: i.product_id,
        quantity: Number(i.quantity),
        complements: Array.isArray(i.complements) ? i.complements : [],
        notes: i.notes || '',
      });
    }
  }
  return out;
}

// Converte item do adapter (lista com itens) para rascunho editável do PDV.
export function toPdvDraftItem(item) {
  return {
    product_id: item.product_id,
    name: item.name || item.product_name || '',
    image_url: item.image_url || '',
    unit_price: Number(item.unit_price) || 0,
    quantity: Number(item.quantity) || 1,
    complements: Array.isArray(item.complements) ? item.complements : [],
    notes: item.notes || '',
  };
}
