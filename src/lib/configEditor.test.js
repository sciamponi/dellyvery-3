import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SELECT_MODES, CONFIG_MAX_SELECT,
  validateIngredient, validateConfigStep, validateConfigOption,
  normalizeConfigStep, normalizeConfigOption,
} from './configEditor.js';

describe('configEditor — ingrediente', () => {
  it('nome obrigatório; ordem válida', () => {
    assert.match(validateIngredient({ name: '' }), /obrigatório/);
    assert.match(validateIngredient({}), /obrigatório/);
    assert.equal(validateIngredient({ name: 'Bacon extra' }), null);
    assert.match(validateIngredient({ name: 'X', sort_order: -1 }), /Ordem/);
    assert.equal(validateIngredient({ name: 'X', sort_order: 2 }), null);
  });
});

describe('configEditor — grupo (step)', () => {
  it('título e modos', () => {
    assert.match(validateConfigStep({}), /Título/);
    assert.match(validateConfigStep({ title: 'G', select_mode: 'x' }), /Modo/);
    assert.deepEqual(SELECT_MODES, ['single', 'multi']);
  });

  it('min/max/free consistentes (espelho do banco)', () => {
    assert.equal(validateConfigStep({ title: 'G' }), null);
    assert.match(validateConfigStep({ title: 'G', min_select: 3, max_select: 2 }), /maior/);
    assert.match(validateConfigStep({ title: 'G', max_select: 0 }), /maior ou igual a 1/);
    assert.match(validateConfigStep({ title: 'G', max_select: CONFIG_MAX_SELECT + 1 }), /limitado/);
    assert.match(validateConfigStep({ title: 'G', select_mode: 'single', max_select: 2 }), /única escolha/);
    assert.equal(validateConfigStep({ title: 'G', select_mode: 'single', max_select: 1 }), null);
    assert.match(validateConfigStep({ title: 'G', free_qty: 5, max_select: 2 }), /Gratuitas/);
    assert.match(validateConfigStep({ title: 'G', required: true, min_select: 0 }), /obrigatório/i);
    assert.equal(validateConfigStep({ title: 'G', required: true, min_select: 1, max_select: 2 }), null);
  });

  it('normalização com defaults do banco', () => {
    assert.deepEqual(normalizeConfigStep({ title: ' G ' }), {
      title: 'G', description: null, select_mode: 'multi',
      min_select: 0, max_select: 1, free_qty: 0, required: false, active: true,
    });
  });
});

describe('configEditor — opção associada', () => {
  it('origem XOR + nome + preço', () => {
    assert.match(validateConfigOption({ name: 'X', price: 1 }), /somente um/);
    assert.match(validateConfigOption({ ingredient_id: 'a', product_id: 'b', name: 'X' }), /somente um/);
    assert.match(validateConfigOption({ ingredient_id: 'a', name: '' }), /obrigatório/);
    assert.match(validateConfigOption({ ingredient_id: 'a', name: 'X', price: -1 }), /zero/);
    assert.equal(validateConfigOption({ ingredient_id: 'a', name: 'X', price: 2.5 }), null);
    assert.equal(validateConfigOption({ product_id: 'p', name: 'Refri' }), null);
  });

  it('normalização: preço vazio vira 0 (grátis explícito no form)', () => {
    const n = normalizeConfigOption({ step_id: 's', ingredient_id: 'a', name: ' X ', price: '' });
    assert.equal(n.name, 'X');
    assert.equal(n.price, 0);
    assert.equal(n.active, true);
    assert.equal(n.product_id, null);
  });
});
