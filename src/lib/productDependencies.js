// DELLVERY 3 — Dependências entre produtos (puro, testável).
// Regra opt-in: produto dependente exige ao menos UM dos exigidos presente
// no pedido (OR entre linhas do mesmo produto). Sem regra ativa, nada muda.
// Espelha check_order_dependencies (servidor é a autoridade; aqui é UX).

// dependencies: [{ product_id, product_name, requires_product_id, requires_name, active }]
// items: [{ product_id, quantity }]
// Retorna [] ou [{ productId, productName, options: [nomes], message }].
export function checkCartDependencies(items, dependencies) {
  const lines = (Array.isArray(items) ? items : []).filter((i) => i && i.product_id && (Number(i.quantity) || 0) > 0);
  if (lines.length === 0) return [];
  const present = new Set(lines.map((i) => i.product_id));
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
    const satisfied = rules.some((r) => present.has(r.requires_product_id));
    if (!satisfied) {
      const options = [...new Set(rules.map((r) => r.requires_name || 'outro item'))];
      const productName = rules[0].product_name || 'Produto';
      errors.push({
        productId: line.product_id,
        productName,
        options,
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
    (Array.isArray(p?.requires) ? p.requires : []).map((r) => ({
      product_id: p.id,
      product_name: p.name,
      requires_product_id: r.id,
      requires_name: r.name,
      active: true,
    })));
}
