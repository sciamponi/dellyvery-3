import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SEEN_KEY,
  WHATSNEW_BATCH_V1,
  HIGHLIGHT_IDS,
  getWhatsNewHighlights,
  hasSeenWhatsNew,
  markWhatsNewSeen,
} from './whatsNew.js';

const memStore = () => {
  const data = {};
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    _data: data,
  };
};

describe('whatsNew — modal de novidades', () => {
  it('destaques vêm da fonte única (updates.js), na ordem', () => {
    const list = getWhatsNewHighlights();
    assert.deepEqual(list.map((u) => u.id), HIGHLIGHT_IDS);
    for (const u of list) {
      assert.equal(u.status, 'disponivel');
      assert.ok(u.title && u.desc);
    }
  });

  it('não visto por padrão; marca e persiste por usuário', () => {
    const store = memStore();
    assert.equal(hasSeenWhatsNew('u1', store), false);
    markWhatsNewSeen('u1', store);
    assert.equal(hasSeenWhatsNew('u1', store), true);
    assert.equal(hasSeenWhatsNew('u2', store), false);
    const raw = JSON.parse(store._data[SEEN_KEY]);
    assert.ok(raw.u1.includes(WHATSNEW_BATCH_V1));
  });

  it('marcar duas vezes não duplica', () => {
    const store = memStore();
    markWhatsNewSeen('u1', store);
    markWhatsNewSeen('u1', store);
    const raw = JSON.parse(store._data[SEEN_KEY]);
    assert.equal(raw.u1.filter((v) => v === WHATSNEW_BATCH_V1).length, 1);
  });

  it('lote próprio não conflita com anúncios anteriores (ex. PDV)', () => {
    const store = memStore();
    store.setItem(SEEN_KEY, JSON.stringify({ u1: ['NEW_FEATURE_PDV_V1'] }));
    assert.equal(hasSeenWhatsNew('u1', store), false);
    markWhatsNewSeen('u1', store);
    const raw = JSON.parse(store._data[SEEN_KEY]);
    assert.ok(raw.u1.includes('NEW_FEATURE_PDV_V1'));
    assert.ok(raw.u1.includes(WHATSNEW_BATCH_V1));
  });

  it('falha de storage nunca quebra (assume visto)', () => {
    const bad = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
    assert.equal(hasSeenWhatsNew('u1', bad), true);
    markWhatsNewSeen('u1', bad);
  });
});
