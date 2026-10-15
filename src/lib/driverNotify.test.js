import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shouldQueueDriverNotify, missingDriverReason, DISPATCH_STATUS } from './driverNotify.js';

const delivery = (over = {}) => ({ id: 'o1', order_type: 'delivery', driver_id: 'd1', ...over });

describe('driverNotify — elegibilidade do aviso', () => {
  it('só delivery + saiu_entrega + entregador', () => {
    assert.equal(shouldQueueDriverNotify(delivery(), DISPATCH_STATUS), true);
    assert.equal(shouldQueueDriverNotify(delivery(), 'finalizado'), false);
    assert.equal(shouldQueueDriverNotify(delivery(), 'confirmado'), false);
    assert.equal(shouldQueueDriverNotify({ ...delivery(), order_type: 'retirada' }, DISPATCH_STATUS), false);
    assert.equal(shouldQueueDriverNotify({ ...delivery(), order_type: 'mesa' }, DISPATCH_STATUS), false);
    assert.equal(shouldQueueDriverNotify({ ...delivery(), driver_id: null }, DISPATCH_STATUS), false);
    assert.equal(shouldQueueDriverNotify(null, DISPATCH_STATUS), false);
    assert.equal(shouldQueueDriverNotify(delivery(), null), false);
  });
});

describe('driverNotify — motivo sem destinatário', () => {
  it('descreve falta de entregador; null quando há', () => {
    assert.match(missingDriverReason({ ...delivery(), driver_id: null }, DISPATCH_STATUS), /Sem entregador/);
    assert.equal(missingDriverReason(delivery(), DISPATCH_STATUS), null);
    assert.equal(missingDriverReason(delivery(), 'finalizado'), null);
    assert.equal(missingDriverReason({ ...delivery(), order_type: 'mesa', driver_id: null }, DISPATCH_STATUS), null);
  });
});
