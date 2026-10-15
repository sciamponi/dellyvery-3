import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TABLE_TITLE, DEFAULT_INSTRUCTION,
  menuUrlFor, pickProductPhotos, buildFlyerModel,
} from './flyer.js';

const company = { slug: 'loja', name: 'Loja', logo_url: 'L', cover_url: 'C', primary_color: '#000' };
const products = [
  { id: 'p1', name: 'A', image_url: 'http://img/a.jpg' },
  { id: 'p2', name: 'B', image_url: '' },
  { id: 'p3', name: 'C', image_url: 'http://img/c.jpg' },
  { id: 'p4', name: 'D', image_url: 'http://img/d.jpg' },
];

describe('flyer — modelo', () => {
  it('geral sem mesa; mesa com token e nome', () => {
    const g = buildFlyerModel({ company, products, table: null, origin: 'https://x' });
    assert.equal(g.kind, 'general');
    assert.equal(g.qrUrl, 'https://x/cardapio/loja');
    assert.ok(!g.tableName);
    const t = buildFlyerModel({
      company, products, origin: 'https://x/',
      table: { name: 'Janela', public_token: 'abc123def456' },
    });
    assert.equal(t.kind, 'table');
    assert.equal(t.qrUrl, 'https://x/cardapio/loja?mesa=abc123def456');
    assert.equal(t.tableName, 'Janela');
    assert.equal(t.title, DEFAULT_TABLE_TITLE);
  });

  it('textos editáveis + instrução padrão', () => {
    const m = buildFlyerModel({
      company, products: [], table: null, origin: 'https://x',
      opts: { title: 'Promo!', instruction: 'Leia.' },
    });
    assert.equal(m.title, 'Promo!');
    assert.equal(m.instruction, 'Leia.');
    assert.equal(
      buildFlyerModel({ company, products: [], table: null, origin: 'https://x' }).instruction,
      DEFAULT_INSTRUCTION,
    );
  });

  it('fotos reais: manuais primeiro, completa sozinho, sem inventar', () => {
    assert.deepEqual(pickProductPhotos(products, ['p3'], 3).map((p) => p.id), ['p3', 'p1', 'p4']);
    assert.deepEqual(pickProductPhotos(products, [], 2).map((p) => p.id), ['p1', 'p3']);
    assert.deepEqual(pickProductPhotos([], [], 3), []);
    assert.throws(() => buildFlyerModel({ company: {}, products, table: null, origin: 'https://x' }), /Loja/);
    assert.throws(() => menuUrlFor('', 'loja'), /Loja/);
  });

  it('autoFill=false: só manuais, sem surpresa automática', () => {
    assert.deepEqual(pickProductPhotos(products, ['p3'], 3, false).map((p) => p.id), ['p3']);
    assert.deepEqual(pickProductPhotos(products, [], 3, false), []);
    const m = buildFlyerModel({ company, products, table: null, origin: 'https://x', opts: { autoPhotos: false } });
    assert.deepEqual(m.photos, []);
    const m2 = buildFlyerModel({ company, products, table: null, origin: 'https://x' });
    assert.ok(m2.photos.length > 0);
  });
});
