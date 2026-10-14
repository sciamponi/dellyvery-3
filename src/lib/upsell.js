// DELLVERY 3 — Motor de sugestões do checkout (venda adicional).
// Lógica pura: sem rede, sem UI. Usa categorias existentes (match por nome
// normalizado) + categorias dos itens já no carrinho ("combinam").
// Sem tabelas novas: não há associação produto->sugestão no schema; quando
// existir curadoria explícita (ex. company_settings.upsell_category_ids),
// `pinCategoryIds` entra como seção prioritária sem mudar este contrato.

export function normalizeName(value) {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

const DRINK_KEYS = [
  'bebida', 'refrigerante', 'refri', 'suco', 'cerveja', 'chopp', 'drink',
  'agua', 'coca', 'guarana', 'fanta', 'cha', 'mate', 'milkshake', 'vitamina',
  'caipirinha', 'vinho', 'whisky', 'vodka', 'energetico',
];

const DESSERT_KEYS = [
  'sobremesa', 'doce', 'sorvete', 'bolo', 'torta', 'pudim', 'brownie',
  'cookie', 'mousse', 'pave', 'brigadeiro', 'churros', 'petit gateau',
  'milk shake',
];

// Acompanhamentos: porções e extras que acompanham o lanche principal.
// Match por nome de categoria normalizado (nunca por produto).
const SIDE_KEYS = [
  'acompanhamento', 'porcao', 'porcoes', 'fritas', 'batata', 'onion',
  'aneis', 'nuggets', 'polenta', 'mandioca', 'farofa', 'torresmo',
];

function matchesAny(haystack, keys) {
  return keys.some((k) => haystack.includes(k));
}

export function isAvailableProduct(product) {
  if (!product) return false;
  return product.available !== false && !product.out_of_stock;
}

export function hasConfigurableOptions(product) {
  const list = product?.complements || product?.options;
  return Array.isArray(list) && list.length > 0;
}

/**
 * @param {object} args
 * @param {Array} args.products — produtos do storefront (com category_id, available, out_of_stock)
 * @param {Array} args.categories — categorias do storefront (com id, name)
 * @param {Array} args.cartItems — itens do carrinho (com product_id)
 * @param {number} args.limitPerSection — máximo por seção (default 4)
 * @param {Array} args.pinCategoryIds — ids de categorias fixadas (curadoria futura; opcional)
 * @returns {Array} seções [{ id, title, items[] }] só com as não-vazias.
 */
export function suggestUpsell({ products = [], categories = [], cartItems = [], limitPerSection = 4, pinCategoryIds = [] } = {}) {
  const limit = Math.max(1, Number(limitPerSection) || 4);
  const catName = new Map((categories || []).map((c) => [c.id, normalizeName(c?.name)]));
  const inCart = new Set((cartItems || []).map((i) => i?.product_id).filter(Boolean));
  const cartCatIds = new Set();
  const byId = new Map((products || []).map((p) => [p.id, p]));
  for (const id of inCart) {
    const p = byId.get(id);
    if (p?.category_id) cartCatIds.add(p.category_id);
  }

  const pool = (products || []).filter(isAvailableProduct);
  const byCat = new Map();
  for (const p of pool) {
    const name = catName.get(p.category_id) || '';
    const bucket = matchesAny(name, DRINK_KEYS) ? 'drinks'
      : matchesAny(name, DESSERT_KEYS) ? 'desserts'
      : matchesAny(name, SIDE_KEYS) ? 'sides'
      : 'other';
    if (!byCat.has(bucket)) byCat.set(bucket, []);
    byCat.get(bucket).push(p);
  }

  const sections = [];
  const pinned = (pinCategoryIds || [])
    .map((id) => pool.filter((p) => p.category_id === id))
    .flat()
    .slice(0, limit);
  if (pinned.length > 0) {
    sections.push({ id: 'pinned', title: 'Escolhidos para você', items: pinned });
  }
  const drinks = (byCat.get('drinks') || []).slice(0, limit);
  if (drinks.length > 0) sections.push({ id: 'drinks', title: 'Bebidas para acompanhar', items: drinks });
  const desserts = (byCat.get('desserts') || []).slice(0, limit);
  if (desserts.length > 0) sections.push({ id: 'desserts', title: 'Sobremesas', items: desserts });
  const related = (byCat.get('other') || [])
    .filter((p) => cartCatIds.size === 0 || cartCatIds.has(p.category_id))
    .slice(0, limit);
  if (related.length > 0 && sections.length < 4) {
    sections.push({ id: 'related', title: 'Combinam com seu pedido', items: related });
  }
  return sections;
}

// Jornada de compra: etapas opcionais e ordenadas após o lanche principal
// (escolhido no cardápio): acompanhamentos → bebidas → sobremesas.
// Só retorna etapas com itens (vazias são puladas); nunca adiciona sozinho.
export const UPSELL_STEP_ORDER = [
  { id: 'sides', title: 'Acompanhamentos' },
  { id: 'drinks', title: 'Bebidas' },
  { id: 'desserts', title: 'Sobremesas' },
];

export function suggestUpsellSteps({ products = [], categories = [], cartItems = [], limitPerSection = 4 } = {}) {
  const limit = Math.max(1, Number(limitPerSection) || 4);
  const catName = new Map((categories || []).map((c) => [c.id, normalizeName(c?.name)]));
  const pool = (products || []).filter(isAvailableProduct);
  const steps = [];
  for (const step of UPSELL_STEP_ORDER) {
    const keys = step.id === 'sides' ? SIDE_KEYS : step.id === 'drinks' ? DRINK_KEYS : DESSERT_KEYS;
    const items = pool.filter((p) => matchesAny(catName.get(p.category_id) || '', keys)).slice(0, limit);
    if (items.length > 0) steps.push({ ...step, items });
  }
  return steps;
}

// Mensagem conversacional da orientação no checkout (pura, testável).
// Curta, contextual e não invasiva; dispensa não bloqueia o fluxo.
export function guideMessageFor(sectionId, fallbackTitle) {
  if (sectionId === 'drinks') return 'Que tal uma bebida para acompanhar?';
  if (sectionId === 'desserts') return 'Deseja incluir uma sobremesa, como açaí?';
  return fallbackTitle || 'Que tal completar seu pedido?';
}
