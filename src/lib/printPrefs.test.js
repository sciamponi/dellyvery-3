import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getSkipPrintPrompt, setSkipPrintPrompt } from './printPrefs.js';

const memStore = () => {
  const data = {};
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
  };
};

describe('printPrefs — opt-out por empresa', () => {
  it('marca/desmarca sem vazar entre empresas', () => {
    const s = memStore();
    assert.equal(getSkipPrintPrompt(s, 'coA'), false);
    assert.equal(setSkipPrintPrompt(s, 'coA', true), true);
    assert.equal(getSkipPrintPrompt(s, 'coA'), true);
    assert.equal(getSkipPrintPrompt(s, 'coB'), false);
    assert.equal(setSkipPrintPrompt(s, 'coA', false), true);
    assert.equal(getSkipPrintPrompt(s, 'coA'), false);
  });

  it('falha de storage nunca quebra', () => {
    const bad = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); }, removeItem: () => { throw new Error('x'); } };
    assert.equal(getSkipPrintPrompt(bad, 'co'), false);
    assert.equal(setSkipPrintPrompt(bad, 'co', true), false);
  });
});
