import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getProductImages, normalizeImageList } from './productMedia.js';

describe('productMedia — galeria', () => {
  it('só principal quando não há adicionais', () => {
    assert.deepEqual(getProductImages({ image_url: 'a.jpg' }), ['a.jpg']);
    assert.deepEqual(getProductImages({}), []);
    assert.deepEqual(getProductImages(null), []);
  });

  it('junta principal + adicionais sem repetir nem vazar vazias', () => {
    assert.deepEqual(
      getProductImages({ image_url: 'a.jpg', images: ['b.jpg', '', 'a.jpg', null, 'c.jpg'] }),
      ['a.jpg', 'b.jpg', 'c.jpg'],
    );
  });

  it('normaliza entrada do admin', () => {
    assert.deepEqual(normalizeImageList(['a.jpg', ' ', 'a.jpg']), ['a.jpg']);
    assert.deepEqual(normalizeImageList('x.jpg'), ['x.jpg']);
    assert.deepEqual(normalizeImageList(null), []);
  });
});
