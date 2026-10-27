// DELLVERY 3 — Validação da gestão de complementos V2 (puro, testável).
// Espelha as constraints do banco (migration 20261008000004) + semântica do
// motor productConfig.js, para erro claro ANTES da rede. Nunca altera dados.

export const SELECT_MODES = ['single', 'multi'];
export const CONFIG_MAX_SELECT = 20;

function isBlank(v) {
  return String(v ?? '').trim() === '';
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Ingrediente reutilizável: nome obrigatório; preço padrão >= 0; ordem >= 0;
// seção manual restrita às 4 fixas ou vazio (nunca inferida pelo nome).
export const INGREDIENT_CATEGORIES = ['lanches', 'acompanhamentos', 'bebidas', 'sobremesas'];

export function validateIngredient(data) {
  const d = data || {};
  if (isBlank(d.name)) return 'Nome do ingrediente é obrigatório';
  if (d.price !== undefined && d.price !== null && d.price !== '') {
    const price = toNum(d.price);
    if (price === null || price < 0) return 'Preço deve ser maior ou igual a zero';
  }
  if (d.sort_order !== undefined && d.sort_order !== null && d.sort_order !== '') {
    const n = toNum(d.sort_order);
    if (n === null || !Number.isInteger(n) || n < 0) return 'Ordem deve ser um inteiro maior ou igual a zero';
  }
  if (d.category !== undefined && d.category !== null && d.category !== '') {
    if (!INGREDIENT_CATEGORIES.includes(String(d.category).trim().toLowerCase())) {
      return 'Seção inválida: escolha entre Lanches, Acompanhamentos, Bebidas ou Sobremesas';
    }
  }
  return null;
}

// Grupo (step): título obrigatório; single exige max 1; min<=max;
// required exige min>=1 efetivo; free<=max; max<=20.
export function validateConfigStep(data) {
  const d = data || {};
  if (isBlank(d.title)) return 'Título do grupo é obrigatório';
  const mode = d.select_mode || 'multi';
  if (!SELECT_MODES.includes(mode)) return 'Modo de seleção inválido';
  const min = d.min_select === undefined || d.min_select === null || d.min_select === ''
    ? 0 : toNum(d.min_select);
  const max = d.max_select === undefined || d.max_select === null || d.max_select === ''
    ? 1 : toNum(d.max_select);
  const free = d.free_qty === undefined || d.free_qty === null || d.free_qty === ''
    ? 0 : toNum(d.free_qty);
  if (min === null || !Number.isInteger(min) || min < 0) return 'Mínimo deve ser inteiro maior ou igual a zero';
  if (max === null || !Number.isInteger(max) || max < 1) return 'Máximo deve ser inteiro maior ou igual a 1';
  if (min > max) return 'Mínimo não pode ser maior que o máximo';
  if (max > CONFIG_MAX_SELECT) return `Máximo limitado a ${CONFIG_MAX_SELECT} opções`;
  if (mode === 'single' && max !== 1) return "No modo 'única escolha', o máximo deve ser 1";
  if (free === null || !Number.isInteger(free) || free < 0) return 'Gratuitas deve ser inteiro maior ou igual a zero';
  if (free > max) return 'Gratuitas não pode ser maior que o máximo';
  if (d.required && min < 1) return 'Grupo obrigatório exige mínimo de ao menos 1';
  return null;
}

// Opção associada: exatamente UMA origem (ingrediente XOR produto);
// preço >= 0 (adicional, nunca soma preço do produto); ordem >= 0.
export function validateConfigOption(data) {
  const d = data || {};
  const hasIng = !!d.ingredient_id;
  const hasProd = !!d.product_id;
  if ((hasIng ? 1 : 0) + (hasProd ? 1 : 0) !== 1) {
    return 'Escolha um ingrediente ou um produto como origem (somente um)';
  }
  if (isBlank(d.name)) return 'Nome da opção é obrigatório';
  const price = d.price === undefined || d.price === null || d.price === '' ? 0 : toNum(d.price);
  if (price === null || price < 0) return 'Preço adicional deve ser maior ou igual a zero';
  if (d.sort_order !== undefined && d.sort_order !== null && d.sort_order !== '') {
    const n = toNum(d.sort_order);
    if (n === null || !Number.isInteger(n) || n < 0) return 'Ordem deve ser um inteiro maior ou igual a zero';
  }
  return null;
}

export function normalizeConfigStep(data) {
  const d = data || {};
  return {
    title: String(d.title || '').trim(),
    description: d.description ? String(d.description).trim() : null,
    select_mode: SELECT_MODES.includes(d.select_mode) ? d.select_mode : 'multi',
    min_select: d.min_select === '' || d.min_select == null ? 0 : Number(d.min_select),
    max_select: d.max_select === '' || d.max_select == null ? 1 : Number(d.max_select),
    free_qty: d.free_qty === '' || d.free_qty == null ? 0 : Number(d.free_qty),
    required: !!d.required,
    active: d.active !== false,
  };
}

export function normalizeConfigOption(data) {
  const d = data || {};
  return {
    step_id: d.step_id,
    ingredient_id: d.ingredient_id || null,
    product_id: d.product_id || null,
    name: String(d.name || '').trim(),
    description: d.description ? String(d.description).trim() : null,
    price: d.price === '' || d.price == null ? 0 : Number(d.price),
    active: d.active !== false,
    sort_order: d.sort_order === '' || d.sort_order == null ? 0 : Number(d.sort_order),
  };
}
