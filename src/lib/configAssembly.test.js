import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildDuplicateOption, neighborSwapTargets } from './configAssembly.js';

describe('configAssembly — duplicar opção', () => {
  it('copia origem e preço, novo nome, inativa, ao final', () => {
    const { data, error } = buildDuplicateOption(
      { step_id: 's', ingredient_id: 'i', product_id: null, name: 'Bacon', description: 'd', price: 3.5, sort_order: 2 },
      [{ sort_order: 0 }, { sort_order: 2 }],
    );
    assert.equal(error, undefined);
    assert.equal(data.name, 'Bacon (cópia)');
    assert.equal(data.ingredient_id, 'i');
    assert.equal(data.product_id, null);
    assert.equal(data.step_id, 's');
    assert.equal(data.price, 3.5);
    assert.equal(data.active, false);
    assert.equal(data.sort_order, 3);
  });

  it('origem ambígua ou ausente não duplica', () => {
    const bad = buildDuplicateOption(
      { step_id: 's', ingredient_id: 'i', product_id: 'p', name: 'X', price: 1 },
      [],
    );
    assert.ok(bad.error);
    assert.equal(bad.data, undefined);
  });
});

describe('configAssembly — reordenar vizinhos', () => {
  const list = [
    { id: 'a', sort_order: 0 },
    { id: 'b', sort_order: 1 },
    { id: 'c', sort_order: 1 },
  ];

  it('troca valores distintos nos limites válidos', () => {
    assert.deepEqual(neighborSwapTargets(list, 0, +1), [
      { id: 'a', sort_order: 1 },
      { id: 'b', sort_order: 0 },
    ]);
  });

  it('iguais separam com dir para manter ordem', () => {
    assert.deepEqual(neighborSwapTargets(list, 1, +1), [
      { id: 'b', sort_order: 2 },
      { id: 'c', sort_order: 1 },
    ]);
  });

  it('bordas retornam null', () => {
    assert.equal(neighborSwapTargets(list, 0, -1), null);
    assert.equal(neighborSwapTargets(list, 2, +1), null);
    assert.equal(neighborSwapTargets([], 0, +1), null);
  });
});
