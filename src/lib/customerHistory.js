// DELLVERY 3 — Histórico do cliente para o selo "primeiro pedido" (puro,
// exceto os helpers de rede marcados).
//
// Regra de negócio (documentada):
// - A lista de entrada já vem isolada por empresa (RLS); nunca cruzar empresas.
// - Histórico = outros pedidos com o MESMO customer_id, excluindo o próprio
//   pedido e excluindo CANCELADOS (cancelado nunca concluiu negócio: um
//   cancelado anterior não tira a condição de "primeiro").
// - Pedido SEM customer_id nunca é "primeiro" (dado insuficiente — avulso
//   não se confunde com cliente novo).
// - O próprio pedido cancelado nunca recebe o selo.
// - Vida útil: a classificação é CONGELADA na primeira visão do pedido
//   (freezeFirstFlags) e só sai de cena com a conclusão (a UI oculta o selo
//   em pedidos finalizado/cancelado). Um 2º pedido do cliente NÃO apaga o
//   selo do 1º ainda em ciclo.
// - Sem N+1: lote único (resolveFirstOrderFlags) ou 1 consulta por chegada
//   (attachFirstOrderFlag); nunca uma consulta por card.

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

// Congela a classificação: uma vez primeiro, sempre primeiro (até a
// conclusão, quando a UI oculta o selo). Nunca true→false: o 2º pedido do
// cliente não apaga o selo do 1º ainda em ciclo. Retorna novo Map.
export function freezeFirstFlags(prevMap, flags) {
  const prev = prevMap instanceof Map ? prevMap : new Map();
  if (!(flags instanceof Map) || flags.size === 0) return prev;
  let next = null;
  for (const [id, first] of flags) {
    if (id == null || prev.has(id)) continue;
    if (!next) next = new Map(prev);
    next.set(id, !!first);
  }
  return next || prev;
}

// Lote único: classifica vários pedidos com 1 consulta (persistido).
// countPrior: async (customerIds[]) => Map(customerId => nº de pedidos
// anteriores não-cancelados de OUTROS pedidos). Sem essa injeção, usa
// countPriorOrders do adapter (import dinâmico para não pesar o bundle).
export async function resolveFirstOrderFlags(client, companyId, orders, countPrior) {
  const list = Array.isArray(orders) ? orders : [];
  const out = new Map();
  const withCustomer = list.filter((o) => o?.id && o?.customer_id && o?.status !== 'cancelado');
  if (withCustomer.length === 0 || !companyId) {
    for (const o of list) out.set(o?.id, false);
    return out;
  }
  let counts = null;
  try {
    if (typeof countPrior === 'function') {
      counts = await countPrior(withCustomer.map((o) => o.customer_id)) || new Map();
    } else {
      const { countPriorOrders } = await import('../api/orders.js');
      counts = await countPriorOrders(client, companyId, withCustomer.map((o) => o.customer_id));
    }
  } catch {
    counts = null;
  }
  for (const o of list) {
    if (!o?.id || !o?.customer_id || o?.status === 'cancelado') {
      out.set(o?.id, false);
      continue;
    }
    // Falha na contagem = sem selo (nunca exceção, nunca selo indevido).
    if (!(counts instanceof Map)) {
      out.set(o.id, false);
      continue;
    }
    // A contagem inclui o próprio pedido (não-cancelado): anterior = total - 1.
    const prior = Math.max(0, (Number(counts.get(o.customer_id)) || 0) - 1);
    out.set(o.id, prior <= 0);
  }
  return out;
}

// Uma chegada (alerta/modal): 1 consulta, nunca bloqueia o alerta.
// Falha = sem selo (flag ausente), nunca exceção.
export async function attachFirstOrderFlag(client, companyId, order) {
  if (!order || !order.customer_id || !companyId) return order;
  try {
    const { countCustomerOrders } = await import('../api/orders.js');
    const prior = await countCustomerOrders(client, companyId, order.customer_id, order.id);
    return { ...order, isFirstOrder: prior === 0 };
  } catch {
    return order;
  }
}
