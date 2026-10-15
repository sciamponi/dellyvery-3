import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { OPS_ROLES, OPERATIONS, PROPOSED_POLICY, CURRENT_POLICY, canDo, impactVsToday } from './orderPermissions.js';

describe('orderPermissions — matriz RBAC proposta (sem enforcement)', () => {
  it('toda operação tem proposta e retrato atual', () => {
    for (const op of OPERATIONS) {
      assert.ok(Array.isArray(PROPOSED_POLICY[op]), op);
      assert.ok(Array.isArray(CURRENT_POLICY[op]), op);
      for (const r of PROPOSED_POLICY[op]) assert.ok(OPS_ROLES.includes(r), `${op}:${r}`);
    }
  });

  it('canDo nega papel desconhecido', () => {
    assert.equal(canDo(PROPOSED_POLICY, 'GHOST', 'order.view'), false);
    assert.equal(canDo(PROPOSED_POLICY, 'ADMIN', 'order.discount'), true);
    assert.equal(canDo(PROPOSED_POLICY, 'OPERATOR', 'order.discount'), false);
  });

  it('impacto demonstra o que cada papel perderia (base da decisão)', () => {
    const impact = impactVsToday();
    assert.deepEqual(impact.OWNER, []);
    assert.deepEqual(impact.ADMIN, []);
    assert.deepEqual(impact.MANAGER, ['order.discount']);
    assert.deepEqual(impact.OPERATOR, ['order.cancel', 'order.edit', 'order.discount', 'catalog.write']);
    assert.deepEqual(impact.CASHIER, [
      'order.status', 'order.assign', 'order.cancel', 'order.edit', 'order.discount', 'catalog.write',
    ]);
    assert.deepEqual(impact.ATTENDANT, impact.CASHIER);
  });

  it('desconto é o mais restrito; view é universal', () => {
    assert.deepEqual(PROPOSED_POLICY['order.discount'], ['OWNER', 'ADMIN']);
    assert.deepEqual(PROPOSED_POLICY['order.view'], OPS_ROLES);
  });
});
