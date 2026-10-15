// DELLVERY 3 — Seções da biblioteca de ingredientes (puro, testável).
// Classificação MANUAL por empresa (coluna ingredients.category; '' =
// "Outros"). Nunca inferida pelo nome. Preço continua por associação
// (product_config_options.price); a seção não altera preços nem vínculos.

export const INGREDIENT_SECTIONS = [
  { id: 'lanches', label: 'Lanches' },
  { id: 'acompanhamentos', label: 'Acompanhamentos' },
  { id: 'bebidas', label: 'Bebidas' },
  { id: 'sobremesas', label: 'Sobremesas' },
];

export const OTHER_SECTION = { id: '', label: 'Outros' };

export function isKnownSection(v) {
  return INGREDIENT_SECTIONS.some((s) => s.id === v);
}

/** Seção do ingrediente (valor bruto ou 'Outros'). */
export function sectionOf(ingredient) {
  const raw = String(ingredient?.category || '').trim().toLowerCase();
  return isKnownSection(raw) ? raw : '';
}

/** Agrupa linhas {ingredient, option} por seção, na ordem fixa; vazias fora. */
export function groupRowsBySection(rows) {
  const order = [...INGREDIENT_SECTIONS.map((s) => s.id), ''];
  const buckets = new Map(order.map((id) => [id, []]));
  for (const r of rows || []) {
    const id = sectionOf(r?.ingredient);
    if (buckets.has(id)) buckets.get(id).push(r);
  }
  const labels = new Map([...INGREDIENT_SECTIONS, OTHER_SECTION].map((s) => [s.id, s.label]));
  return order
    .filter((id) => buckets.get(id).length > 0)
    .map((id) => ({ id, label: labels.get(id), rows: buckets.get(id) }));
}

/** Monta os dados da cópia de um ingrediente: novo id no banco, mesma
 *  seção, sem levar associações a produtos; nasce inativa para revisão. */
export function buildIngredientDuplicate(ing) {
  const src = ing || {};
  return {
    name: `${String(src.name || 'Ingrediente').trim()} (cópia)`,
    description: src.description || '',
    category: String(src.category || '').trim().toLowerCase(),
    active: false,
    sort_order: Number(src.sort_order) || 0,
  };
}

/** Validação do formulário compacto (nome, preço, duplicata por empresa). */
export function validateNewIngredient({ name, price, existingNames = [] }) {
  if (String(name || '').trim() === '') return 'Nome do ingrediente é obrigatório';
  const p = Number(price);
  if (price === '' || price === null || price === undefined || !Number.isFinite(p) || p < 0) {
    return 'Preço adicional deve ser maior ou igual a 0';
  }
  const norm = String(name).trim().toLowerCase();
  if ((existingNames || []).some((n) => String(n || '').trim().toLowerCase() === norm)) {
    return 'Já existe um ingrediente com esse nome';
  }
  return null;
}
