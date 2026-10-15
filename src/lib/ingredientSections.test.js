import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  sectionOf,
  groupRowsBySection,
  validateNewIngredient,
  INGREDIENT_SECTIONS,
} from './ingredientSections.js';

const row = (name, category) => ({ ingredient: { id: name, name, category }, option: null });

describe('ingredientSections — classificação manual', () => {
  it('4 seções fixas; desconhecido/vazio vira Outros', () => {
    assert.equal(INGREDIENT_SECTIONS.length, 4);
    assert.equal(sectionOf({ category: 'bebidas' }), 'bebidas');
    assert.equal(sectionOf({ category: 'BEBIDAS' }), 'bebidas');
    assert.equal(sectionOf({ category: 'doce?' }), '');
    assert.equal(sectionOf({}), '');
    assert.equal(sectionOf(null), '');
  });

  it('agrupa por seção na ordem fixa, omitindo vazias', () => {
    const gs = groupRowsBySection([
      row('Suco', 'bebidas'), row('Pão', 'lanches'), row('X', ''),
      row('Açaí', 'sobremesas'), row('Fritas', 'acompanhamentos'),
    ]);
    assert.deepEqual(gs.map((g) => g.id), ['lanches', 'acompanhamentos', 'bebidas', 'sobremesas', '']);
    assert.equal(gs[0].rows.length, 1);
    assert.equal(gs[4].label, 'Outros');
  });

  it('busca filtra sem quebrar grupos (integração com filter do diálogo)', () => {
    const rows = [row('Coca Cola', 'bebidas'), row('Coca Zero', 'bebidas'), row('Pão', 'lanches')];
    const q = 'coca';
    const found = rows.filter((r) => (r.ingredient.name || '').toLowerCase().includes(q));
    const gs = groupRowsBySection(found);
    assert.equal(gs.length, 1);
    assert.equal(gs[0].rows.length, 2);
  });
});

describe('ingredientSections — validação do cadastro', () => {
  it('nome obrigatório; preço >= 0; duplicata por empresa', () => {
    assert.equal(validateNewIngredient({ name: '  ', price: 0, existingNames: [] }), 'Nome do ingrediente é obrigatório');
    assert.equal(validateNewIngredient({ name: 'A', price: -1, existingNames: [] }), 'Preço adicional deve ser maior ou igual a 0');
    assert.equal(validateNewIngredient({ name: 'A', price: 'x', existingNames: [] }), 'Preço adicional deve ser maior ou igual a 0');
    assert.equal(validateNewIngredient({ name: 'Queijo', price: 2, existingNames: ['queijo'] }), 'Já existe um ingrediente com esse nome');
    assert.equal(validateNewIngredient({ name: 'Queijo', price: 0, existingNames: ['Presunto'] }), null);
  });
});
