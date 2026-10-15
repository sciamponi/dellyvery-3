import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getViewMode, setViewMode } from './viewPrefs.js';

const memStore = () => {
  const data = {};
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
  };
};

describe('viewPrefs — preferência por área', () => {
  it('default cards; persiste por área; sobrevive (storage injetado)', () => {
    const s = memStore();
    assert.equal(getViewMode('produtos', s), 'cards');
    assert.equal(setViewMode('produtos', 'lista', s), true);
    assert.equal(getViewMode('produtos', s), 'lista');
    assert.equal(getViewMode('categorias', s), 'cards');
  });

  it('valor inválido é ignorado; falha de storage nunca quebra', () => {
    const s = memStore();
    assert.equal(setViewMode('x', 'tabela', s), false);
    assert.equal(getViewMode('x', s), 'cards');
    const bad = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
    assert.equal(getViewMode('x', bad), 'cards');
    assert.equal(setViewMode('x', 'lista', bad), false);
  });
});
