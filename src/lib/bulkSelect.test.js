import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  toggleSelected, toggleAllVisible, pruneSelected,
  allVisibleSelected, someVisibleSelected, runBulk,
} from './bulkSelect.js';

describe('bulkSelect — seleção', () => {
  it('alterna um id; todos-visíveis respeita filtro', () => {
    assert.deepEqual(toggleSelected([], 'a'), ['a']);
    assert.deepEqual(toggleSelected(['a'], 'a'), []);
    assert.deepEqual(toggleAllVisible(['x'], ['a', 'b'], true).sort(), ['a', 'b', 'x']);
    assert.deepEqual(toggleAllVisible(['x', 'a'], ['a'], false), ['x']);
    assert.deepEqual(pruneSelected(['a', 'z'], ['a', 'b']), ['a']);
    assert.equal(allVisibleSelected(['a', 'b'], ['a', 'b']), true);
    assert.equal(allVisibleSelected(['a'], ['a', 'b']), false);
    assert.equal(allVisibleSelected([], []), false);
    assert.equal(someVisibleSelected(['z'], ['a']), false);
    assert.equal(someVisibleSelected(['a'], ['a', 'b']), true);
  });

  it('runBulk: falha por registro sem parar os demais', async () => {
    const r = await runBulk([{ id: 'a' }, { id: 'b' }, { id: 'c' }], async (it) => {
      if (it.id === 'b') throw new Error('rede');
    });
    assert.deepEqual(r.ok, ['a', 'c']);
    assert.equal(r.fail.length, 1);
    assert.equal(r.fail[0].id, 'b');
  });
});
