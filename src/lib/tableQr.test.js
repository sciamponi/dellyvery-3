import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isValidTableToken, buildTableQrUrl, resolvePublicBaseUrl } from './tableQr.js';

describe('tableQr — token e URL', () => {
  it('formato: 12 hex exatos', () => {
    assert.equal(isValidTableToken('abc123def456'), true);
    assert.equal(isValidTableToken('ABC123DEF456'), false);
    assert.equal(isValidTableToken('abc123'), false);
    assert.equal(isValidTableToken(''), false);
    assert.equal(isValidTableToken(null), false);
    assert.equal(isValidTableToken('abc123def4567'), false);
  });

  it('URL do cardápio com token', () => {
    assert.equal(
      buildTableQrUrl('https://x/', 'minha-loja', 'abc123def456'),
      'https://x/cardapio/minha-loja?mesa=abc123def456',
    );
    assert.throws(() => buildTableQrUrl('', 'l', 'abc123def456'), /Origem/);
    assert.throws(() => buildTableQrUrl('https://x', '', 'abc123def456'), /Loja/);
    assert.throws(() => buildTableQrUrl('https://x', 'l', 'curto'), /Token/);
  });

  it('base pública: env primeiro, origem depois', () => {
    assert.equal(resolvePublicBaseUrl('https://local/'), 'https://local');
    assert.equal(resolvePublicBaseUrl(''), '');
  });
});
