import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldConfirmDispatch,
  shouldConferenceConclusion,
  validateDispatchConfirm,
  resolveConclusionDriver,
} from './dispatchConfirm.js';

describe('dispatchConfirm — quando exigir modais', () => {
  it('saída só para delivery rumo a saiu_entrega', () => {
    assert.equal(shouldConfirmDispatch({ order_type: 'delivery', status: 'novo' }, 'saiu_entrega'), true);
    assert.equal(shouldConfirmDispatch({ order_type: 'mesa', status: 'novo' }, 'saiu_entrega'), false);
    assert.equal(shouldConfirmDispatch({ order_type: 'delivery', status: 'novo' }, 'finalizado'), false);
    assert.equal(shouldConfirmDispatch({ order_type: 'delivery', status: 'finalizado' }, 'saiu_entrega'), false);
    assert.equal(shouldConfirmDispatch(null, 'saiu_entrega'), false);
  });

  it('conferência só de saiu_entrega para finalizado', () => {
    assert.equal(shouldConferenceConclusion({ status: 'saiu_entrega' }, 'finalizado'), true);
    assert.equal(shouldConferenceConclusion({ status: 'em_preparo' }, 'finalizado'), false);
    assert.equal(shouldConferenceConclusion({ status: 'saiu_entrega' }, 'cancelado'), false);
  });
});

describe('dispatchConfirm — validações', () => {
  it('saída bloqueada sem entregador', () => {
    assert.deepEqual(validateDispatchConfirm({ driverId: null }), { ok: false, reason: 'Selecione um entregador para confirmar a saída' });
    assert.equal(validateDispatchConfirm({ driverId: '' }).ok, false);
    assert.equal(validateDispatchConfirm({ driverId: 'd1' }).ok, true);
  });

  it('baixa resolve responsável e detecta troca', () => {
    assert.deepEqual(resolveConclusionDriver({ orderDriverId: 'd1', selectedDriverId: '' }), { driverId: 'd1', changed: false, ok: true });
    assert.deepEqual(resolveConclusionDriver({ orderDriverId: 'd1', selectedDriverId: 'd2' }), { driverId: 'd2', changed: true, ok: true });
    assert.deepEqual(resolveConclusionDriver({ orderDriverId: null, selectedDriverId: '' }), { driverId: null, changed: false, ok: false });
  });
});
