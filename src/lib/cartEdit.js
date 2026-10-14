// DELLVERY 3 — Reabrir item do carrinho no modal (puro, testável).
// Reconstrói o estado de seleção a partir do snapshot da linha, para
// editar quantidade/complementos sem perder nada. Nada é removido aqui:
// o chamador remove a linha antiga só ao confirmar a nova.

export function v2selFromItemConfig(config) {
  const out = {};
  const steps = Array.isArray(config?.steps) ? config.steps : [];
  for (const s of steps) {
    if (!s || !s.step_id || !Array.isArray(s.items)) continue;
    const opts = {};
    for (const it of s.items) {
      if (!it || !it.option_id) continue;
      opts[it.option_id] = Number(it.quantity) || 1;
    }
    if (Object.keys(opts).length > 0) out[s.step_id] = opts;
  }
  return out;
}

// Snapshot legado [{group_name, option_name, price, quantity}] de volta
// para o mapa { `${gi}_${oi}`: {...} } do modal, casando pelo catálogo.
// Itens sem correspondência são ignorados (cardápio mudou desde então).
export function legacySelFromComplements(product, complements) {
  const out = {};
  const groups = Array.isArray(product?.complements) ? product.complements : [];
  for (const c of Array.isArray(complements) ? complements : []) {
    if (!c) continue;
    const gi = groups.findIndex((g) => g && g.name === c.group_name);
    if (gi < 0) continue;
    const opts = Array.isArray(groups[gi].options) ? groups[gi].options : [];
    const oi = opts.findIndex((o) => o && o.name === c.option_name);
    if (oi < 0) continue;
    out[`${gi}_${oi}`] = {
      group_name: groups[gi].name,
      option_name: opts[oi].name,
      price: Number(c.price) || 0,
      quantity: 1,
    };
  }
  return out;
}
