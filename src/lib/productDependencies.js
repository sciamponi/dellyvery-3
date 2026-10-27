// DELLVERY 3 — Dependências entre produtos (puro, testável).
// Regra opt-in por produto, dois modos (espelha o servidor, autoridade):
// - 'any' (padrão, Gate 3): basta UM dos exigidos presente no pedido.
// - 'all' (combos): TODOS os exigidos precisam estar presentes.
// Sem regra ativa, nada muda.

// dependencies: [{ product_id, product_name, requires_product_id, requires_name, active }]
// items: [{ product_id, quantity }]
// modes: { [product_id]: 'any' | 'all' } (ausente = 'any').
// Retorna [] ou [{ productId, productName, options: [nomes], message, mode }].
export function checkCartDependencies(items, dependencies, modes) {
  const lines = (Array.isArray(items) ? items : []).filter((i) => i && i.product_id && (Number(i.quantity) || 0) > 0);
  if (lines.length === 0) return [];
  const present = new Set(lines.map((i) => i.product_id));
  const modeOf = (pid) => ((modes || {})[pid] === 'all' ? 'all' : 'any');
  const rulesByProduct = new Map();
  for (const d of dependencies || []) {
    if (!d || d.active === false || !d.product_id || !d.requires_product_id) continue;
    if (!rulesByProduct.has(d.product_id)) rulesByProduct.set(d.product_id, []);
    const arr = rulesByProduct.get(d.product_id);
    if (!arr.some((r) => r.requires_product_id === d.requires_product_id)) {
      arr.push(d);
    }
  }
  const errors = [];
  const seen = new Set();
  for (const line of lines) {
    const rules = rulesByProduct.get(line.product_id);
    if (!rules || rules.length === 0 || seen.has(line.product_id)) continue;
    seen.add(line.product_id);
    const mode = modeOf(line.product_id);
    const options = [...new Set(rules.map((r) => r.requires_name || 'outro item'))];
    const productName = rules[0].product_name || 'Produto';
    if (mode === 'all') {
      const missingRules = rules.filter((r) => !present.has(r.requires_product_id));
      if (missingRules.length > 0) {
        const missing = [...new Set(missingRules.map((r) => r.requires_name || 'outro item'))];
        errors.push({
          productId: line.product_id,
          productName,
          options,
          mode,
          message: `${productName} exige ${missing.join(', ')} no pedido`,
        });
      }
    } else if (!rules.some((r) => present.has(r.requires_product_id))) {
      errors.push({
        productId: line.product_id,
        productName,
        options,
        mode,
        message: `${productName} exige ${options.join(' ou ')} no pedido`,
      });
    }
  }
  return errors;
}

// Regras aplicáveis a um conjunto de produtos (para buscar mensagens).
export function rulesForProducts(dependencies, productIds) {
  const set = new Set(productIds || []);
  return (dependencies || []).filter((d) => d && d.active !== false && set.has(d.product_id));
}

// Converte o campo `requires` do storefront ([{id, name}] por produto)
// para o formato de regras aceito por checkCartDependencies. Produtos sem
// `requires` não geram regra e continuam vendendo sozinhos.
export function buildDepRulesFromProducts(products) {
  return (Array.isArray(products) ? products : []).flatMap((p) =>
    (Array.isArray(p?.requires) ? p.requires : []).filter(Boolean).map((r) => ({
      product_id: p.id,
      product_name: p.name,
      requires_product_id: r.id,
      requires_name: r.name,
      active: true,
    })));
}

// Mapa produto -> modo ('any' | 'all') a partir de produtos com
// dependency_mode (storefront ou catálogo). Ausente = 'any'.
export function buildDepModesFromProducts(products) {
  const modes = {};
  for (const p of Array.isArray(products) ? products : []) {
    if (p && p.id && p.dependency_mode === 'all') modes[p.id] = 'all';
  }
  return modes;
}
