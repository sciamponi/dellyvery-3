import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { orderStatusView, isOpenOrder } from './orderStatusView.js';

describe('orderStatusView — selo operacional', () => {
  it('Pronto é roxo; demais têm cores próprias', () => {
    const pronto = orderStatusView('aguardando_retirada');
    assert.equal(pronto.label, 'Pronto');
    assert.ok(pronto.className.includes('purple'));
    assert.ok(orderStatusView('novo').className.includes('blue'));
    assert.ok(orderStatusView('saiu_entrega').className.includes('indigo'));
  });

  it('desconhecido usa fallback cinza', () => {
    const u = orderStatusView('x');
    assert.equal(u.label, 'x');
    assert.ok(u.className.includes('muted'));
  });

  it('em andamento exclui cancelado e finalizado', () => {
    assert.equal(isOpenOrder({ status: 'em_preparo' }), true);
    assert.equal(isOpenOrder({ status: 'aguardando_retirada' }), true);
    assert.equal(isOpenOrder({ status: 'cancelado' }), false);
    assert.equal(isOpenOrder({ status: 'finalizado' }), false);
    assert.equal(isOpenOrder({}), false);
  });
});
