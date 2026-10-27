// DELLVERY 3 — Montagem guiada do PDV (puro).
// A ordem das etapas vem SEMPRE de product_config_steps (herdadas da
// categoria + próprias, already ordered by position). Nada aqui substitui
// regras do banco: a validação final usa validateProductConfig e o servidor
// revalida preços/opções em create_order/manage_order.

import { validateProductConfig } from './productConfig.js';

export function stepEffectiveMin(step) {
  const min = Number(step?.min_select) || 0;
  return step?.required ? Math.max(min, 1) : min;
}

export function stepMax(step) {
  const max = Number(step?.max_select);
  return Number.isFinite(max) && max >= 1 ? max : 1;
}

export function selectionForStep(selection, stepId) {
  const value = selection?.[stepId];
  return value && typeof value === 'object' ? value : {};
}

export function selectionQty(selection, stepId) {
  return Object.values(selectionForStep(selection, stepId))
    .reduce((sum, qty) => sum + (Number(qty) || 0), 0);
}

export function toSelectionPayload(selection) {
  const steps = Object.entries(selection || {})
    .map(([step_id, options]) => ({
      step_id,
      items: Object.entries(options || {})
        .filter(([, quantity]) => (Number(quantity) || 0) > 0)
        .map(([option_id, quantity]) => ({ option_id, quantity: Number(quantity) || 1 })),
    }))
    .filter((step) => step.items.length > 0);
  return { steps };
}

export function canAdvanceStep(step, selection) {
  if (!step?.id) return false;
  const total = selectionQty(selection, step.id);
  return total >= stepEffectiveMin(step) && total <= stepMax(step);
}

export function canSkipStep(step) {
  return !!step && !step.required && stepEffectiveMin(step) === 0;
}

/**
 * Etapas realmente aplicáveis ao produto:
 * - ativas e com opções ativas; ou
 * - obrigatórias/mínimas sem opção (para denunciar configuração incompleta
 *   em vez de esconder a regra e deixar o servidor rejeitar no envio).
 */
export function applicableSteps(config) {
  const options = Array.isArray(config?.options) ? config.options : [];
  return (config?.steps || [])
    .filter((step) => step && step.active !== false)
    .map((step) => ({
      ...step,
      options: options.filter((opt) => opt && opt.step_id === step.id && opt.active !== false),
    }))
    .filter((step) => step.options.length > 0 || stepEffectiveMin(step) > 0);
}

// Alterna uma opção. Retorna a nova seleção e se o wizard pode avançar
// sozinho (single escolhido; multi atingiu o máximo).
export function toggleOptionSelection({ step, selection = {}, optionId }) {
  if (!step?.id || !optionId) return { selection, autoAdvance: false };
  const current = { ...selectionForStep(selection, step.id) };
  const has = (Number(current[optionId]) || 0) > 0;

  if (step.select_mode === 'single') {
    if (has) delete current[optionId];
    else {
      for (const key of Object.keys(current)) delete current[key];
      current[optionId] = 1;
    }
    return {
      selection: { ...selection, [step.id]: current },
      autoAdvance: !has,
    };
  }

  if (has) {
    delete current[optionId];
    return { selection: { ...selection, [step.id]: current }, autoAdvance: false };
  }

  const total = Object.values(current).reduce((sum, qty) => sum + (Number(qty) || 0), 0);
  if (total >= stepMax(step)) {
    return { selection: { ...selection, [step.id]: current }, autoAdvance: false };
  }
  current[optionId] = 1;
  const nextTotal = total + 1;
  return {
    selection: { ...selection, [step.id]: current },
    autoAdvance: nextTotal >= stepMax(step),
  };
}

export function changeOptionQty({ step, selection = {}, optionId, delta }) {
  if (!step?.id || !optionId) return { selection, autoAdvance: false };
  const current = { ...selectionForStep(selection, step.id) };
  const currentQty = Number(current[optionId]) || 0;
  if (currentQty <= 0) return { selection, autoAdvance: false };

  const otherTotal = Object.entries(current)
    .filter(([id]) => id !== optionId)
    .reduce((sum, [, qty]) => sum + (Number(qty) || 0), 0);
  const maxForOption = Math.max(0, stepMax(step) - otherTotal);
  const next = Math.min(maxForOption, Math.max(0, currentQty + (Number(delta) || 0)));

  if (next <= 0) delete current[optionId];
  else current[optionId] = next;

  const total = Object.values(current).reduce((sum, qty) => sum + (Number(qty) || 0), 0);
  return {
    selection: { ...selection, [step.id]: current },
    autoAdvance: total >= stepMax(step) && total >= stepEffectiveMin(step),
  };
}

export function summarizeSelection(steps = [], selection = {}) {
  return (steps || [])
    .map((step) => ({
      step_id: step.id,
      title: step.title || '',
      options: (step.options || [])
        .filter((opt) => (Number(selectionForStep(selection, step.id)[opt.id]) || 0) > 0)
        .map((opt) => ({
          ...opt,
          quantity: Number(selectionForStep(selection, step.id)[opt.id]) || 1,
        })),
    }))
    .filter((step) => step.options.length > 0);
}

export function snapshotToComplements(snapshot) {
  const out = [];
  for (const step of snapshot?.steps || []) {
    for (const item of step.items || []) {
      out.push({
        group_name: step.title || '',
        option_name: item.name || '',
        price: item.free ? 0 : (Number(item.price) || 0),
        quantity: Number(item.quantity) || 1,
        step_id: item.step_id || step.step_id,
        option_id: item.option_id,
      });
    }
  }
  return out;
}

/**
 * Constrói a linha configurada usando o motor único (preços oficiais das
 * opções e snapshot). O produto principal mantém seu preço-base; opções
 * pagam apenas o adicional cadastrado, como no ProductModal e no servidor.
 */
export function buildAssemblyLine({
  product, steps = [], options = [], selection = {}, notes = '', quantity = 1,
}) {
  if (!product?.id) throw new Error('Produto principal não identificado');
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty < 1 || qty > 99) throw new Error('Quantidade inválida');

  const config = toSelectionPayload(selection);
  const result = validateProductConfig({
    product,
    steps,
    options,
    selection: config,
    quantity: qty,
    flags: { requireActiveProduct: false },
  });

  const line = {
    product,
    product_id: product.id,
    name: product.name || '',
    image_url: product.image_url || '',
    unit_price: result.baseUnitPrice,
    quantity: qty,
    complements: snapshotToComplements(result.snapshot),
    notes: notes || '',
    line_total: result.baseUnitPrice * qty + result.optionsTotal,
    base_unit_price: result.baseUnitPrice,
    options_total: result.optionsTotal,
  };
  if (config.steps.length > 0) line.config = config;
  return line;
}

// Mescla uma linha configurada idêntica (produto + opções + obs + config),
// sem criar linhas duplicadas. Recebe `id` pronto para a linha nova.
export function mergeDraftLine(items = [], line) {
  if (!line?.product_id) return items || [];
  const key = (value) => JSON.stringify(value || null);
  const index = (items || []).findIndex((item) => !item.persisted
    && item.product_id === line.product_id
    && key(item.complements) === key(line.complements)
    && (item.notes || '') === (line.notes || '')
    && key(item.config) === key(line.config));
  if (index < 0) return [...(items || []), line];
  return (items || []).map((item, i) => (i === index
    ? { ...item, quantity: (Number(item.quantity) || 0) + (Number(line.quantity) || 0) }
    : item));
}

// Índices do wizard: 0..steps.length (último = revisão).
export function wizardIndexAfter(index, stepCount) {
  return Math.min(Math.max(0, index) + 1, Math.max(0, stepCount));
}

export function wizardIndexBefore(index) {
  return Math.max(0, index - 1);
}
