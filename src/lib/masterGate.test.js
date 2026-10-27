import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyMasterAccessError,
  createMasterGateState,
  masterGateReducer,
} from './masterGate.js';

describe('masterGate — classificação e retry', () => {
  it('classifica falha de rede sem confundir com acesso negado', () => {
    assert.equal(classifyMasterAccessError(new TypeError('Failed to fetch')), 'network');
    assert.equal(classifyMasterAccessError({ code: 'ECONNREFUSED', message: 'connect' }), 'network');
    assert.equal(classifyMasterAccessError({ message: 'fetch failed' }), 'network');
    assert.equal(classifyMasterAccessError({ code: 'PGRST301', message: 'JWT expired' }), 'error');
    assert.equal(classifyMasterAccessError(null), 'error');
  });

  it('nega somente quando a consulta informa falta de permissão', () => {
    const state = masterGateReducer(createMasterGateState(), {
      type: 'check:result',
      status: 'denied',
    });
    assert.equal(state.status, 'denied');
    assert.equal(state.attempt, 0);
  });

  it('retry refaz a consulta e limpa o erro anterior', () => {
    let state = masterGateReducer(createMasterGateState(), {
      type: 'check:result',
      status: 'network',
      error: 'Failed to fetch',
    });
    assert.equal(state.status, 'network');

    state = masterGateReducer(state, { type: 'check:retry' });
    assert.equal(state.status, 'checking');
    assert.equal(state.error, '');
    assert.equal(state.attempt, 1);

    state = masterGateReducer(state, {
      type: 'check:result',
      status: 'allowed',
    });
    assert.equal(state.status, 'allowed');
    assert.equal(state.attempt, 1);
  });

  it('mantém erro inesperado separado de acesso negado', () => {
    const state = masterGateReducer(createMasterGateState(), {
      type: 'check:result',
      status: 'error',
      error: 'permission denied for table profiles',
    });
    assert.equal(state.status, 'error');
    assert.match(state.error, /permission denied/);
  });
});
