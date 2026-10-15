import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateQuickProductEdit, quickProductPatch } from './productQuickEdit.js';

describe('productQuickEdit — validação', () => {
  it('nome obrigatório; preço maior que 0', () => {
    assert.equal(validateQuickProductEdit({ name: '  ', price: 10 }), 'Nome do produto é obrigatório');
    assert.equal(validateQuickProductEdit({ name: 'X', price: 0 }), 'Preço deve ser maior que 0');
    assert.equal(validateQuickProductEdit({ name: 'X', price: -5 }), 'Preço deve ser maior que 0');
    assert.equal(validateQuickProductEdit({ name: 'X', price: 'x' }), 'Preço deve ser maior que 0');
    assert.equal(validateQuickProductEdit({ name: 'X-Burguer', price: 25.9 }), null);
  });

  it('patch parcial sem company_id', () => {
    assert.deepEqual(
      quickProductPatch({ name: ' X ', category_id: 'c1', price: '10' }),
      { name: 'X', category_id: 'c1', price: 10 },
    );
    assert.deepEqual(quickProductPatch({ price: 5 }), { price: 5 });
  });
});
