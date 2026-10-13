import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALERT_FRESH_WINDOW_MS,
  parseCreatedMs,
  isFreshForAlert,
  createSoundBlockGate,
  isAutoplayRejection,
} from './alertPolicy.js';

const NOW = 1_700_000_000_000;

describe('alertPolicy — frescor do alerta', () => {
  it('janela de 120s preservada para o passado', () => {
    assert.equal(ALERT_FRESH_WINDOW_MS, 120000);
    assert.equal(isFreshForAlert(new Date(NOW - 30_000).toISOString(), NOW), true);
    assert.equal(isFreshForAlert(new Date(NOW - 119_000).toISOString(), NOW), true);
    assert.equal(isFreshForAlert(new Date(NOW - 300_000).toISOString(), NOW), false);
  });

  it('timestamp futuro (relógio adiantado) confia na chegada', () => {
    assert.equal(isFreshForAlert(new Date(NOW + 60_000).toISOString(), NOW), true);
    assert.equal(isFreshForAlert(new Date(NOW + 3_600_000).toISOString(), NOW), true);
  });

  it('ausente ou inválido nunca é fresco', () => {
    assert.equal(isFreshForAlert(null, NOW), false);
    assert.equal(isFreshForAlert('', NOW), false);
    assert.equal(isFreshForAlert('não-data', NOW), false);
    assert.equal(parseCreatedMs('não-data'), 0);
  });
});

describe('alertPolicy — portão de som bloqueado (único por sessão)', () => {
  it('avisa uma vez após bloqueio, depois silencia', () => {
    const gate = createSoundBlockGate();
    assert.equal(gate.consumeNotice(), false);
    gate.markBlocked();
    assert.equal(gate.consumeNotice(), true);
    assert.equal(gate.consumeNotice(), false);
    gate.reset();
    assert.equal(gate.consumeNotice(), false);
  });

  it('só rejeição de autoplay marca (interrupção por novo play não)', () => {
    assert.equal(isAutoplayRejection({ name: 'NotAllowedError', message: 'play() failed' }), true);
    assert.equal(isAutoplayRejection({ name: 'NotAllowedError' }), true);
    assert.equal(
      isAutoplayRejection({ name: 'AbortError', message: "play() request was interrupted by a call to pause" }),
      false,
    );
    assert.equal(isAutoplayRejection({ name: 'NotSupportedError', message: 'format error' }), false);
    assert.equal(isAutoplayRejection(null), false);
  });
});
