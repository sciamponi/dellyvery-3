import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isInQueue, isDelayed, getQueueOrders, getDelayedOrders, waitMinutes, isFinalized, getFinalized, getFinalizedByType, getCanceled, filterByDriver } from './orderQueue.js';

const now = Date.now();
const min = (m) => new Date(now - m * 60000).toISOString();
const o = (status, created_date) => ({ id: status, status, created_date });

describe('orderQueue', () => {
  it('fila = 5 status não-terminais', () => {
    assert.equal(isInQueue(o('novo')), true);
    assert.equal(isInQueue(o('saiu_entrega')), true);
    assert.equal(isInQueue(o('finalizado')), false);
    assert.equal(isInQueue(o('cancelado')), false);
  });

  it('atraso > 30 min (igual Pedidos)', () => {
    assert.equal(isDelayed(o('novo', min(31)), now), true);
    assert.equal(isDelayed(o('novo', min(30)), now), false);
    assert.equal(isDelayed(o('finalizado', min(99)), now), false);
    assert.equal(waitMinutes(min(5), now), 5);
  });

  it('listas derivadas', () => {
    const list = [o('novo', min(40)), o('confirmado', min(5)), o('finalizado', min(90))];
    assert.equal(getQueueOrders(list).length, 2);
    assert.equal(getDelayedOrders(list, now).length, 1);
  });

  it('finalizados por tipo + cancelados + filtro entregador', () => {
    const f = (type, status = 'finalizado', driver = null) => ({ id: `${type}-${driver}`, status, order_type: type, driver_id: driver, created_date: min(60) });
    const list = [f('delivery', 'finalizado', 'd1'), f('delivery'), f('retirada'), f('mesa'), f('delivery', 'cancelado')];
    assert.equal(getFinalized(list).length, 4);
    assert.equal(getFinalizedByType(list, 'delivery').length, 2);
    assert.equal(getFinalizedByType(list, 'retirada').length, 1);
    assert.equal(getFinalizedByType(list, 'mesa').length, 1);
    assert.equal(getCanceled(list).length, 1);
    assert.equal(isFinalized(f('delivery', 'novo')), false);
    const ent = getFinalizedByType(list, 'delivery');
    assert.equal(filterByDriver(ent, 'all').length, 2);
    assert.equal(filterByDriver(ent, 'd1').length, 1);
    assert.equal(filterByDriver(ent, 'none').length, 1);
  });
});
