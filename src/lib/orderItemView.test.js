import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isFreeComplement,
  formatComplement,
  groupComplements,
  complementsTotal,
  itemsComplementsTotal,
} from './orderItemView.js';

const fmt = (v) => `R$${Number(v).toFixed(2)}`;

describe('orderItemView — gratuitos e formatação', () => {
  it('price 0 é grátis; pago não', () => {
    assert.equal(isFreeComplement({ price: 0 }), true);
    assert.equal(isFreeComplement({ price: '0' }), true);
    assert.equal(isFreeComplement({ price: 3.5 }), false);
    assert.equal(isFreeComplement(null), true);
  });

  it('formata quantidade, nome e gratuidade', () => {
    assert.equal(formatComplement({ option_name: 'Queijo', price: 0, quantity: 1 }, fmt), 'Queijo (Grátis)');
    assert.equal(formatComplement({ option_name: 'Bacon', price: 3.5, quantity: 2 }, fmt), '2x Bacon (R$3.50)');
    assert.equal(formatComplement({ option_name: 'M', price: 2, quantity: 1 }, fmt), 'M (R$2.00)');
  });

  it('agrupa por grupo preservando ordem; sem grupo vira Opções', () => {
    const gs = groupComplements([
      { group_name: 'Tamanho', option_name: 'M' },
      { group_name: 'Adicionais', option_name: 'Bacon' },
      { group_name: 'Adicionais', option_name: 'Queijo' },
      { option_name: 'X' },
    ]);
    assert.deepEqual(gs.map((g) => g.group), ['Tamanho', 'Adicionais', 'Opções']);
    assert.equal(gs[1].items.length, 2);
  });

  it('totais somam pagas e ignoram gratuitas', () => {
    assert.equal(complementsTotal([
      { price: 2, quantity: 1 },
      { price: 0, quantity: 2 },
      { price: 4, quantity: 1 },
    ]), 6);
    assert.equal(complementsTotal([]), 0);
    assert.equal(itemsComplementsTotal([
      { complements: [{ price: 2, quantity: 1 }] },
      { complements: [{ price: 0, quantity: 3 }] },
      {},
    ]), 2);
  });
});
