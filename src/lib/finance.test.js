import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PAID_STATUS, CANCELED_STATUS, getPeriodRange, filterByPeriod, normalizePayment, summarizeOrders } from './finance.js';

const now = new Date().toISOString();
const o = (over = {}) => ({ status: 'finalizado', total: 100, order_type: 'delivery', payment_method: 'Pix', created_date: now, ...over });

describe('finance — regras', () => {
  it('receita SOMENTE de finalizados; ticket = receita/finalizados', () => {
    const s = summarizeOrders([o({ total: 100 }), o({ total: 50 }), o({ status: 'novo', total: 999 }), o({ status: 'cancelado', total: 999 })]);
    assert.equal(s.revenue, 150);
    assert.equal(s.avgTicket, 75);
    assert.equal(s.paidCount, 2);
    assert.equal(s.canceledCount, 1);
    assert.equal(s.totalOrders, 4);
  });

  it('sem finalizados zera receita e ticket', () => {
    const s = summarizeOrders([o({ status: 'novo', total: 10 })]);
    assert.equal(s.revenue, 0);
    assert.equal(s.avgTicket, 0);
    assert.deepEqual(s.byPayment, {});
  });

  it('agrupamentos por status/tipo/pagamento', () => {
    const s = summarizeOrders([
      o({ total: 100, order_type: 'delivery', payment_method: 'Pix' }),
      o({ total: 200, order_type: 'mesa', payment_method: 'Dinheiro' }),
      o({ status: 'novo', total: 50, order_type: 'delivery', payment_method: 'Pix' }),
    ]);
    assert.equal(s.byStatus.finalizado.count, 2);
    assert.equal(s.byStatus.novo.total, 50);
    assert.equal(s.byType.delivery.count, 2);
    assert.equal(s.byType.delivery.total, 100); // só finalizado soma
    assert.equal(s.byPayment.Pix.total, 100);
    assert.equal(s.byPayment.Dinheiro.count, 1);
  });

  it('pagamento vazio vira Não informado', () => {
    assert.equal(normalizePayment(''), 'Não informado');
    assert.equal(normalizePayment(null), 'Não informado');
    const s = summarizeOrders([o({ payment_method: '' })]);
    assert.equal(s.byPayment['Não informado'].count, 1);
  });

  it('períodos filtram por created_date', () => {
    const old = new Date();
    old.setDate(old.getDate() - 40);
    const list = [o({}), o({ created_date: old.toISOString() })];
    const s30 = summarizeOrders(filterByPeriod(list, getPeriodRange('30dias')));
    assert.equal(s30.totalOrders, 1);
    const custom = summarizeOrders(filterByPeriod(list, getPeriodRange('custom', '2000-01-01', '2000-01-31')));
    assert.equal(custom.totalOrders, 0);
    assert.equal(filterByPeriod(list, null).length, 0);
  });

  it('constantes de status', () => {
    assert.equal(PAID_STATUS, 'finalizado');
    assert.equal(CANCELED_STATUS, 'cancelado');
  });
});
