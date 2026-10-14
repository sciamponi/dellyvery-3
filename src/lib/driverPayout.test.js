import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isEligibleOrder, eligibleOrders, summarizePayout,
  excludePaidOrders, orderIdsOf, buildPayoutCsv,
} from './driverPayout.js';

const o = (over = {}) => ({
  id: 'o1', order_number: 7, driver_id: 'd1', status: 'finalizado',
  delivery_fee: 5, created_date: '2026-10-01', ...over,
});

describe('driverPayout — elegibilidade', () => {
  it('só finalizado com entregador; cancelado/não concluído/sem driver fora', () => {
    assert.equal(isEligibleOrder(o()), true);
    assert.equal(isEligibleOrder(o({ status: 'cancelado' })), false);
    assert.equal(isEligibleOrder(o({ status: 'saiu_entrega' })), false);
    assert.equal(isEligibleOrder(o({ status: 'novo' })), false);
    assert.equal(isEligibleOrder(o({ driver_id: null })), false);
    assert.equal(isEligibleOrder(null), false);
  });

  it('filtra por entregador quando informado', () => {
    const list = [o({ id: 'a' }), o({ id: 'b', driver_id: 'd2' }), o({ id: 'c', status: 'novo' })];
    assert.deepEqual(eligibleOrders(list, 'd1').map((x) => x.id), ['a']);
    assert.equal(eligibleOrders(list, null).length, 2);
  });
});

describe('driverPayout — totais e duplicidade', () => {
  it('soma fees registrados (snapshot), ignora inelegíveis', () => {
    assert.deepEqual(summarizePayout([o({ delivery_fee: 5 }), o({ delivery_fee: '7.5' }), o({ status: 'novo', delivery_fee: 99 })]), { count: 2, totalFee: 12.5 });
    assert.deepEqual(summarizePayout([]), { count: 0, totalFee: 0 });
  });

  it('exclui já pagas; ids extraídos para o fechamento', () => {
    assert.deepEqual(excludePaidOrders([o({ id: 'a' }), o({ id: 'b' })], ['a']).map((x) => x.id), ['b']);
    assert.deepEqual(orderIdsOf([{ order_id: 'a' }, {}]), ['a']);
  });
});

describe('driverPayout — CSV', () => {
  it('cabeçalho, linhas e total conferem com a lista', () => {
    const csv = buildPayoutCsv({ driverName: 'Zé', periodLabel: 'out/26', orders: [o()], total: 5 });
    assert.ok(csv.includes('Zé') && csv.includes('out/26'));
    assert.ok(csv.includes('7') && csv.includes('5,00'));
    assert.ok(csv.includes('TOTAL'));
  });
});
