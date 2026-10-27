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

  it('conferência só de saiu_entrega para finalizado (delivery)', () => {
    assert.equal(shouldConferenceConclusion({ status: 'saiu_entrega', order_type: 'delivery' }, 'finalizado'), true);
    assert.equal(shouldConferenceConclusion({ status: 'em_preparo', order_type: 'delivery' }, 'finalizado'), false);
    assert.equal(shouldConferenceConclusion({ status: 'saiu_entrega', order_type: 'delivery' }, 'cancelado'), false);
    assert.equal(shouldConferenceConclusion({ status: 'finalizado', order_type: 'delivery' }, 'finalizado'), false);
    assert.equal(shouldConferenceConclusion({ status: 'cancelado', order_type: 'delivery' }, 'finalizado'), false);
    assert.equal(shouldConferenceConclusion(null, 'finalizado'), false);
  });
});

describe('dispatchConfirm — conclusão por modalidade', () => {
  it('retirada nova conclui sem entregador', () => {
    const order = { order_type: 'retirada', status: 'aguardando_retirada', driver_id: null };
    assert.equal(shouldConferenceConclusion(order, 'finalizado'), false);
  });

  it('retirada antiga já em saiu_entrega também conclui sem entregador', () => {
    const order = { order_type: 'retirada', status: 'saiu_entrega', driver_id: null };
    assert.equal(shouldConferenceConclusion(order, 'finalizado'), false);
  });

  it('delivery sem entregador permanece bloqueada na conferência', () => {
    const order = { order_type: 'delivery', status: 'saiu_entrega', driver_id: null };
    assert.equal(shouldConferenceConclusion(order, 'finalizado'), true);
    assert.equal(resolveConclusionDriver({ orderDriverId: null, selectedDriverId: '' }).ok, false);
    assert.equal(resolveConclusionDriver({ orderDriverId: null, selectedDriverId: null }).ok, false);
  });

  it('delivery com entregador válido segue permitida', () => {
    const order = { order_type: 'delivery', status: 'saiu_entrega', driver_id: 'd1' };
    assert.equal(shouldConferenceConclusion(order, 'finalizado'), true);
    assert.deepEqual(
      resolveConclusionDriver({ orderDriverId: 'd1', selectedDriverId: '' }),
      { driverId: 'd1', changed: false, ok: true },
    );
  });

  it('mesa mantém fluxo próprio sem exigir entregador', () => {
    const order = { order_type: 'mesa', status: 'saiu_entrega', driver_id: null };
    assert.equal(shouldConferenceConclusion(order, 'finalizado'), false);
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
