import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getCustomerHistory, isFirstOrder } from './customerHistory.js';

const o = (over = {}) => ({ id: 'x', customer_id: 'c1', status: 'novo', ...over });

describe('customerHistory — primeiro pedido', () => {
  it('cliente sem pedidos anteriores recebe o selo', () => {
    assert.equal(isFirstOrder(o({ id: 'a' }), [o({ id: 'a' }), o({ id: 'b', customer_id: 'c2' })]), true);
    assert.deepEqual(getCustomerHistory(o({ id: 'a' }), [o({ id: 'a' })]), []);
  });

  it('cliente com histórico não recebe', () => {
    const orders = [o({ id: 'a' }), o({ id: 'b' }), o({ id: 'c', status: 'finalizado' })];
    assert.equal(isFirstOrder(o({ id: 'a' }), orders), false);
    assert.equal(getCustomerHistory(o({ id: 'a' }), orders).length, 2);
  });

  it('pedido sem vínculo nunca é primeiro (avulso ≠ novo)', () => {
    assert.equal(isFirstOrder(o({ id: 'a', customer_id: null }), [o({ id: 'a', customer_id: null })]), false);
    assert.equal(isFirstOrder(o({ id: 'a', customer_id: '' }), []), false);
    assert.equal(isFirstOrder(null, []), false);
  });

  it('cancelados não contam: nem como histórico, nem o próprio', () => {
    const orders = [o({ id: 'a' }), o({ id: 'b', status: 'cancelado' })];
    assert.equal(isFirstOrder(o({ id: 'a' }), orders), true);
    assert.equal(isFirstOrder(o({ id: 'b', status: 'cancelado' }), orders), false);
  });

  it('isolamento por empresa vem da lista (só compara o recebido)', () => {
    // Listas de empresas distintas nunca se misturam: cada chamada avalia
    // apenas o array informado (já escopado por company_id/RLS).
    assert.equal(isFirstOrder(o({ id: 'a' }), [o({ id: 'a' })]), true);
  });
});
