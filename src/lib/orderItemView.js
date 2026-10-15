// DELLVERY 3 — Visão de itens do pedido (puro, só display).
// Convenção servidor + carrinho (v2PreviewLines): porção gratuita vira
// linha com price 0; a mesma opção pode ter linha paga e linha grátis.
// Nada aqui recalcula o pedido: subtotal/total vêm de orders.total.

/** Linha gratuita? Preço zerado (servidor grava exatamente 0). */
export function isFreeComplement(c) {
  return !(Number(c?.price) > 0);
}

/** "2x Nome (Grátis)" | "Nome (R$ 3,50)" — formatação via fmt injetado. */
export function formatComplement(c, fmt) {
  const f = typeof fmt === 'function' ? fmt : (v) => String(v ?? '');
  const qty = Number(c?.quantity) || 0;
  const name = c?.option_name || c?.name || 'Item';
  const prefix = qty > 1 ? `${qty}x ` : '';
  if (isFreeComplement(c)) return `${prefix}${name} (Grátis)`;
  return `${prefix}${name} (${f(c.price)})`;
}

/** Agrupa por group_name preservando a ordem; sem grupo => "Opções". */
export function groupComplements(list) {
  const groups = [];
  const byName = new Map();
  for (const c of list || []) {
    const g = c?.group_name || 'Opções';
    if (!byName.has(g)) {
      byName.set(g, []);
      groups.push(g);
    }
    byName.get(g).push(c);
  }
  return groups.map((g) => ({ group: g, items: byName.get(g) }));
}

/** Soma display-only das linhas (gratuitas somam 0). */
export function complementsTotal(list) {
  return (list || []).reduce(
    (s, c) => s + (Number(c?.price) || 0) * (Number(c?.quantity) || 0),
    0,
  );
}

/** Total display-only dos complementos de todos os itens. */
export function itemsComplementsTotal(items) {
  return (items || []).reduce((s, i) => s + complementsTotal(i?.complements), 0);
}

/**
 * Estado da navegação entre itens (painel de detalhe): anterior/próximo
 * com limites desabilitados. Não muda de pedido, só de item.
 */
export function itemNavState(index, length) {
  const n = Number(length) || 0;
  const i = index;
  const valid = Number.isInteger(i) && i >= 0 && i < n;
  return {
    valid,
    count: n,
    hasPrev: valid && i > 0,
    hasNext: valid && i < n - 1,
    prevIdx: i - 1,
    nextIdx: i + 1,
  };
}
