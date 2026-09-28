import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startOfDayLocal, isSameDay, isFutureDay, addDaysLocal, formatDayLabel, filterByDay, calcPdvTotals } from './orderDay.js';

describe('orderDay — navegação por dia', () => {
  it('startOfDayLocal zera horas', () => {
    const d = startOfDayLocal(new Date(2026, 8, 28, 15, 30));
    assert.equal(d.getHours(), 0);
    assert.equal(d.getDate(), 28);
  });

  it('isSameDay / futuro / addDays', () => {
    const now = new Date(2026, 8, 28, 12, 0);
    assert.equal(isSameDay(new Date(2026, 8, 28, 8, 0), now), true);
    assert.equal(isSameDay(new Date(2026, 8, 27), now), false);
    assert.equal(isFutureDay(new Date(2026, 8, 29), now), true);
    assert.equal(isFutureDay(new Date(2026, 8, 28, 23, 59), now), false);
    assert.equal(addDaysLocal(new Date(2026, 8, 28), -1).getDate(), 27);
  });

  it('formatDayLabel pt-BR', () => {
    const now = new Date(2026, 8, 28, 12, 0);
    assert.equal(formatDayLabel(new Date(2026, 8, 28, 9, 0), now), 'Hoje');
    assert.equal(formatDayLabel(new Date(2026, 8, 27), now), 'Ontem — 27 de setembro');
    assert.equal(formatDayLabel(new Date(2026, 8, 20), now), '20 de setembro');
  });

  it('filterByDay filtra pelo dia local', () => {
    const day = new Date(2026, 8, 28);
    const list = [
      { id: 1, created_date: new Date(2026, 8, 28, 10, 0).toISOString() },
      { id: 2, created_date: new Date(2026, 8, 27, 23, 0).toISOString() },
      { id: 3 },
    ];
    assert.deepEqual(filterByDay(list, day).map(o => o.id), [1]);
  });
});

describe('orderDay — totais do PDV', () => {
  it('soma subtotal/taxa/total/quantidade', () => {
    const t = calcPdvTotals([{ unit_price: 10, quantity: 2 }, { unit_price: 5.5, quantity: 1 }], 3);
    assert.equal(t.subtotal, 25.5);
    assert.equal(t.total, 28.5);
    assert.equal(t.count, 3);
  });

  it('lista vazia zera tudo', () => {
    assert.deepEqual(calcPdvTotals([], 0), { subtotal: 0, fee: 0, total: 0, count: 0 });
  });
});
