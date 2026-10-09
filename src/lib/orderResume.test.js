import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIVE_RESUME_STATUSES,
  resumeKey,
  isActiveOrderStatus,
  saveResume,
  loadResume,
  clearResume,
} from './orderResume.js';

// localStorage fake (node não tem window).
function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

describe('orderResume — retomada de pedido', () => {
  beforeEach(() => {
    globalThis.window = { localStorage: makeStorage() };
  });

  it('status ativos retornam true', () => {
    assert.deepEqual(ACTIVE_RESUME_STATUSES, ['novo', 'confirmado', 'em_preparo', 'aguardando_retirada', 'saiu_entrega']);
    for (const s of ACTIVE_RESUME_STATUSES) assert.equal(isActiveOrderStatus(s), true);
  });

  it('finalizado/cancelado/desconhecido retornam false', () => {
    assert.equal(isActiveOrderStatus('finalizado'), false);
    assert.equal(isActiveOrderStatus('cancelado'), false);
    assert.equal(isActiveOrderStatus('pago'), false);
    assert.equal(isActiveOrderStatus(undefined), false);
    assert.equal(isActiveOrderStatus(null), false);
  });

  it('salvar e recuperar token', () => {
    assert.equal(saveResume('loja-a', 'tok123'), true);
    const loaded = loadResume('loja-a');
    assert.equal(loaded.token, 'tok123');
    assert.ok(typeof loaded.createdAt === 'number');
  });

  it('limpar token', () => {
    saveResume('loja-a', 'tok123');
    clearResume('loja-a');
    assert.equal(loadResume('loja-a'), null);
  });

  it('isolamento por slug', () => {
    saveResume('loja-a', 'tokA');
    saveResume('loja-b', 'tokB');
    assert.equal(loadResume('loja-a').token, 'tokA');
    assert.equal(loadResume('loja-b').token, 'tokB');
    assert.notEqual(resumeKey('loja-a'), resumeKey('loja-b'));
    clearResume('loja-a');
    assert.equal(loadResume('loja-a'), null);
    assert.equal(loadResume('loja-b').token, 'tokB');
  });

  it('JSON corrompido retorna null sem lançar', () => {
    globalThis.window.localStorage.setItem(resumeKey('loja-a'), '{invalido');
    assert.equal(loadResume('loja-a'), null);
  });

  it('token vazio/ausente não salva nem carrega', () => {
    assert.equal(saveResume('loja-a', ''), false);
    assert.equal(saveResume('', 'tok'), false);
    assert.equal(loadResume('loja-a'), null);
    assert.equal(loadResume(''), null);
  });

  it('sem window/storage não lança', () => {
    delete globalThis.window;
    assert.equal(saveResume('loja-a', 'tok'), false);
    assert.equal(loadResume('loja-a'), null);
    clearResume('loja-a');
  });
});
