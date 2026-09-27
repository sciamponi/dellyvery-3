import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSlug, isValidSlug, buildMenuUrl, buildShareMessage, buildWhatsAppUrl } from './menuShare.js';

describe('menuShare', () => {
  it('normalizeSlug padroniza', () => {
    assert.equal(normalizeSlug('Seu Dellyvery!'), 'seu-dellyvery');
    assert.equal(normalizeSlug('  açaí_legal  '), 'acai-legal');
    assert.equal(normalizeSlug('---'), '');
  });

  it('isValidSlug valida formato', () => {
    assert.equal(isValidSlug('samuel'), true);
    assert.equal(isValidSlug('minha-loja-2'), true);
    assert.equal(isValidSlug(''), false);
    assert.equal(isValidSlug('Com Espaço'), false);
    assert.equal(isValidSlug('-x'), false);
  });

  it('buildMenuUrl monta URL pública', () => {
    assert.equal(buildMenuUrl('https://x.com/', 'samuel'), 'https://x.com/cardapio/samuel');
    assert.equal(buildMenuUrl('http://localhost:5173', 'a'), 'http://localhost:5173/cardapio/a');
  });

  it('mensagem e link WhatsApp contêm nome e URL', () => {
    const url = 'https://dellyvery.localapp.online/cardapio/samuel';
    const msg = buildShareMessage('SEU DELLYVERY', url);
    assert.ok(msg.includes('SEU DELLYVERY'));
    assert.ok(msg.includes(url));
    const wa = buildWhatsAppUrl(msg);
    assert.ok(wa.startsWith('https://wa.me/?text='));
    assert.ok(decodeURIComponent(wa).includes(url));
  });
});
