import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateQuickProductEdit, quickProductPatch, buildProductDuplicate } from './productQuickEdit.js';

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

  it('duplicata: novo registro, sem id/vínculos, inativa e sem selos', () => {
    const d = buildProductDuplicate({
      id: 'p1', name: 'X-Burguer', description: 'd', price: 25, promotional_price: 22,
      category_id: 'c1', image_url: 'u', available: true, is_featured: true,
      is_bestseller: true, is_made_to_order: true, company_id: 'co',
    });
    assert.equal(d.name, 'X-Burguer (cópia)');
    assert.equal(d.available, false);
    assert.equal(d.is_featured, false);
    assert.equal(d.is_bestseller, false);
    assert.equal(d.price, 25);
    assert.equal(d.category_id, 'c1');
    assert.ok(!('id' in d) && !('company_id' in d));
  });
});
