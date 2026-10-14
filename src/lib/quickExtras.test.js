import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { QUICK_GROUP_TITLE, findQuickStep, buildQuickRows } from './quickExtras.js';

describe('quickExtras — grupo rápido', () => {
  it('acha o grupo Extras ignorando caixa/espaço; null sem ele', () => {
    const steps = [{ id: 'a', title: 'Molhos' }, { id: 'b', title: '  EXTRAS ' }];
    assert.equal(findQuickStep(steps).id, 'b');
    assert.equal(findQuickStep([{ title: 'Molhos' }]), null);
    assert.equal(findQuickStep(null), null);
    assert.equal(QUICK_GROUP_TITLE, 'Extras');
  });
});

describe('quickExtras — linhas de seleção', () => {
  const ings = [
    { id: 'i1', name: 'Alface', active: true },
    { id: 'i2', name: 'Tomate', active: true },
    { id: 'i3', name: 'Velho', active: false },
  ];
  const opts = [{ id: 'o1', ingredient_id: 'i1', price: 0, active: true }];

  it('só ingredientes ativos; associação quando existe', () => {
    const rows = buildQuickRows(ings, opts);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].option.id, 'o1');
    assert.equal(rows[1].option, null);
  });

  it('independente por produto: outro conjunto de opções, outro resultado', () => {
    assert.equal(buildQuickRows(ings, [])[0].option, null);
    assert.deepEqual(buildQuickRows(null, opts), []);
  });
});
