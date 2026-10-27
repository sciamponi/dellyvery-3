import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  RESELLER_GATE_INITIAL,
  createResellerGateState,
  classifyResellerAccessError,
  resellerGateReducer,
} from './resellerGate.js';

describe('resellerGate — estados do gate /revenda', () => {
  it('estado inicial isolado', () => {
    const a = createResellerGateState();
    const b = createResellerGateState();
    assert.deepEqual(a, RESELLER_GATE_INITIAL);
    assert.notEqual(a, b);
  });

  it('classifica falha de rede sem mascarar erro de permissão', () => {
    assert.equal(classifyResellerAccessError({ message: 'Failed to fetch' }), 'network');
    assert.equal(classifyResellerAccessError({ message: 'fetch failed' }), 'network');
    assert.equal(classifyResellerAccessError({ code: 'ETIMEDOUT' }), 'network');
    assert.equal(classifyResellerAccessError({ message: 'network error' }), 'network');
    assert.equal(classifyResellerAccessError({ message: 'JWT expired' }), 'error');
    assert.equal(classifyResellerAccessError({ code: '42501', message: 'permission denied' }), 'error');
  });

  it('reducer percorre checagem, suspensão, erro e retry', () => {
    let state = resellerGateReducer(createResellerGateState(), { type: 'check:start' });
    assert.equal(state.status, 'checking');

    state = resellerGateReducer(state, {
      type: 'check:result',
      status: 'suspended',
      reseller: { id: 'r1' },
    });
    assert.equal(state.status, 'suspended');
    assert.equal(state.reseller.id, 'r1');

    state = resellerGateReducer(state, { type: 'check:retry' });
    assert.equal(state.status, 'checking');
    assert.equal(state.attempt, 1);
    assert.equal(state.reseller, null);

    state = resellerGateReducer(state, {
      type: 'check:result',
      status: 'network',
      error: 'sem conexao',
    });
    assert.equal(state.status, 'network');
    assert.equal(state.error, 'sem conexao');

    state = resellerGateReducer(state, { type: 'check:reset' });
    assert.deepEqual(state, RESELLER_GATE_INITIAL);
  });
});
