export const FIXED_GROUP_DEFINITIONS = [
  { slug: 'lanches', title: 'Lanches' },
  { slug: 'acompanhamentos', title: 'Acompanhamentos' },
  { slug: 'bebidas', title: 'Bebidas' },
  { slug: 'sobremesas', title: 'Sobremesas' },
  { slug: 'extras', title: 'Extras' },
];

export function normalizeGroupTitle(value) {
  return String(value ?? '').trim().toLowerCase();
}

export const FIXED_GROUP_CATEGORY_SLUGS = [
  'lanches',
  'acompanhamentos',
  'sobremesas',
  'bebidas',
  'combos',
  'extras',
];

export function usesFixedGroups(category) {
  const slug = normalizeGroupTitle(category?.slug);
  const name = normalizeGroupTitle(category?.name);
  return FIXED_GROUP_CATEGORY_SLUGS.includes(slug) || FIXED_GROUP_CATEGORY_SLUGS.includes(name);
}

export function fixedGroupsForCategory(category) {
  const slug = normalizeGroupTitle(category?.slug);
  const name = normalizeGroupTitle(category?.name);
  return FIXED_GROUP_DEFINITIONS.filter(
    (definition) => definition.slug !== slug && normalizeGroupTitle(definition.title) !== name,
  );
}

export function findFixedStep(steps, definition) {
  const title = normalizeGroupTitle(definition?.title);
  return (Array.isArray(steps) ? steps : []).find(
    (step) => step && normalizeGroupTitle(step.title) === title,
  ) || null;
}

export function findFixedCategory(categories, definition) {
  const slug = normalizeGroupTitle(definition?.slug);
  const title = normalizeGroupTitle(definition?.title);
  const list = Array.isArray(categories) ? categories : [];
  return list.find((category) => normalizeGroupTitle(category?.slug) === slug)
    || list.find((category) => normalizeGroupTitle(category?.name) === title)
    || null;
}

export function fixedStepPayload(definition) {
  return {
    title: definition.title,
    description: `Grupo fixo — produtos da categoria ${definition.title}`,
    select_mode: 'single',
    min_select: 0,
    max_select: 1,
    free_qty: 0,
    required: false,
    active: true,
  };
}

export function planFixedGroupOptions({ stepId, categoryId, products, existingOptions }) {
  const existingByProduct = new Map();
  for (const option of Array.isArray(existingOptions) ? existingOptions : []) {
    if (option?.product_id && !existingByProduct.has(option.product_id)) {
      existingByProduct.set(option.product_id, option);
    }
  }

  const creates = [];
  const updates = [];
  const inCategory = (Array.isArray(products) ? products : [])
    .filter((product) => product && product.category_id === categoryId);

  inCategory.forEach((product, index) => {
    const name = String(product.name || '').trim();
    if (!name) return;
    const price = Number(product.promotional_price != null ? product.promotional_price : product.price) || 0;
    const active = product.available !== false && product.out_of_stock !== true;
    const existing = existingByProduct.get(product.id);

    if (!existing) {
      creates.push({
        step_id: stepId,
        ingredient_id: null,
        product_id: product.id,
        name,
        description: '',
        price,
        active,
        sort_order: Number(product.sort_order) || index,
      });
      return;
    }

    const patch = {};
    if (String(existing.name || '').trim() !== name) patch.name = name;
    if (Number(existing.price) !== price) patch.price = price;
    if (Object.keys(patch).length > 0) updates.push({ id: existing.id, patch });
  });

  return { creates, updates, productCount: inCategory.length };
}
