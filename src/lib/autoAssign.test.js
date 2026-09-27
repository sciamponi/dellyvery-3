import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getAutoAssignDriverId, isDefaultDriver } from './autoAssign.js';

const D = (id, status = 'ativo') => ({ id, status, name: id });
const O = (over = {}) => ({ id: 'o1', order_type: 'delivery', driver_id: null, ...over });
const S = (over = {}) => ({ auto_assign_delivery: true, default_driver_id: 'd1', ...over });

describe('autoAssign — matriz', () => {
  it('sem padrão → manual', () => {
    assert.equal(getAutoAssignDriverId({ order: O(), settings: {}, drivers: [D('d1')] }), null);
  });

  it('auto desligado → manual', () => {
    assert.equal(getAutoAssignDriverId({ order: O(), settings: S({ auto_assign_delivery: false }), drivers: [D('d1')] }), null);
  });

  it('retirada/mesa nunca', () => {
    assert.equal(getAutoAssignDriverId({ order: O({ order_type: 'retirada' }), settings: S(), drivers: [D('d1')] }), null);
    assert.equal(getAutoAssignDriverId({ order: O({ order_type: 'mesa' }), settings: S(), drivers: [D('d1')] }), null);
  });

  it('pedido já atribuído não sobrescreve', () => {
    assert.equal(getAutoAssignDriverId({ order: O({ driver_id: 'd9' }), settings: S(), drivers: [D('d1')] }), null);
  });

  it('padrão inativo/inexistente → null', () => {
    assert.equal(getAutoAssignDriverId({ order: O(), settings: S(), drivers: [D('d1', 'inativo')] }), null);
    assert.equal(getAutoAssignDriverId({ order: O(), settings: S({ default_driver_id: 'dx' }), drivers: [D('d1')] }), null);
  });

  it('delivery + auto + padrão ativo → id (com ou sem outros ativos)', () => {
    assert.equal(getAutoAssignDriverId({ order: O(), settings: S(), drivers: [D('d1')] }), 'd1');
    assert.equal(getAutoAssignDriverId({ order: O(), settings: S(), drivers: [D('d1'), D('d2'), D('d3')] }), 'd1');
  });

  it('isDefaultDriver marca o padrão', () => {
    assert.equal(isDefaultDriver('d1', S()), true);
    assert.equal(isDefaultDriver('d2', S()), false);
    assert.equal(isDefaultDriver('d1', {}), false);
  });
});
