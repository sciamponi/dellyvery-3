import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  categorySlugOf, shouldSuggestSideDish, listSideDishes, listOfferItems,
  prioritizeOfferItems, filterOfferByCart, productHasOptions,
} from './sideDish.js';

const categories = [
  { id: 'c1', slug: 'lanches', name: 'Lanches' },
  { id: 'c2', slug: 'acompanhamentos', name: 'Acompanhamentos' },
  { id: 'c3', slug: 'bebidas', name: 'Bebidas' },
  { id: 'c9', name: 'Custom sem slug' },
];
const lanche = { id: 'p1', category_id: 'c1', config: [] };
const batata = { id: 'p2', category_id: 'c2', config: [{ id: 's' }] };
const coca = { id: 'p3', category_id: 'c3' };
const avulso = { id: 'p4', category_id: 'c9' };

describe('sideDish — disparo', () => {
  it('só dispara para lanche (slug lanches)', () => {
    assert.equal(shouldSuggestSideDish(lanche, categories), true);
    assert.equal(shouldSuggestSideDish(batata, categories), false);
    assert.equal(shouldSuggestSideDish(coca, categories), false);
    assert.equal(shouldSuggestSideDish(avulso, categories), false);
    assert.equal(shouldSuggestSideDish(null, categories), false);
    assert.equal(categorySlugOf(lanche, categories), 'lanches');
    assert.equal(categorySlugOf(avulso, categories), null);
  });
});

describe('sideDish — lista', () => {
  it('só acompanhamentos da lista de origem (sem indisponíveis extras)', () => {
    assert.deepEqual(
      listSideDishes([lanche, batata, coca], categories).map((p) => p.id),
      ['p2'],
    );
    assert.deepEqual(listSideDishes([lanche], categories), []);
    assert.deepEqual(listSideDishes([lanche, batata], []), []);
  });
});

describe('sideDish — personalização', () => {
  it('detecta V2 e legado; simples retorna false', () => {
    assert.equal(productHasOptions(batata), true);
    assert.equal(productHasOptions({ complements: [{ name: 'G' }] }), true);
    assert.equal(productHasOptions(lanche), false);
    assert.equal(productHasOptions(null), false);
  });
});

describe('sideDish — oferta com bebidas e priorização', () => {
  const offerCats = [
    { id: 'c1', slug: 'lanches', name: 'Lanches' },
    { id: 'c2', slug: 'acompanhamentos', name: 'Acompanhamentos' },
    { id: 'c4', slug: 'bebidas', name: 'Bebidas' },
    { id: 'cx', slug: 'sobremesas', name: 'Sobremesas' },
  ];
  const guarana = { id: 'g1', category_id: 'c4', name: 'Guaraná' };
  const refri = { id: 'r1', category_id: 'c4', name: 'Refrigerante Lata' };
  const fritas = { id: 'f1', category_id: 'c2', name: 'Batata Frita' };
  const lancheL = { id: 'p1', category_id: 'c1' };
  const batataL = { id: 'p2', category_id: 'c2' };

  it('oferta = acompanhamentos + bebidas (sem lanches/sobremesas)', () => {
    const ids = listOfferItems(
      [lancheL, batataL, guarana, { id: 's1', category_id: 'cx', name: 'Açaí' }],
      offerCats,
    ).map((p) => p.id);
    assert.deepEqual(ids, ['p2', 'g1']);
  });

  it('prioriza batata, depois refrigerante; estável no resto', () => {
    const items = [
      guarana,
      { id: 'c0', name: 'Coca Cola' },
      refri,
      fritas,
      { id: 'm1', name: 'Molho' },
    ];
    assert.deepEqual(prioritizeOfferItems(items).map((p) => p.id), ['f1', 'r1', 'g1', 'c0', 'm1']);
  });

  it('acentos não quebram a priorização', () => {
    assert.equal(prioritizeOfferItems([{ id: 'x', name: 'BATATA RÚSTICA' }])[0].id, 'x');
  });
});

describe('sideDish — filtro por dependências do carrinho', () => {
  const BATATA = 'batata';
  const BURGUER = 'lanche';
  const rules = [
    { product_id: BATATA, product_name: 'Batata', requires_product_id: BURGUER, requires_name: 'Lanche', active: true },
  ];
  const cands = [{ id: BATATA, name: 'Batata' }, { id: BURGUER, name: 'Lanche' }, { id: 'coca', name: 'Coca' }];

  it('oculta batata sem lanche; mostra com lanche', () => {
    assert.deepEqual(filterOfferByCart(cands, [], rules).map((c) => c.id), ['lanche', 'coca']);
    assert.deepEqual(
      filterOfferByCart(cands, [{ product_id: BURGUER, quantity: 1 }], rules).map((c) => c.id),
      ['batata', 'lanche', 'coca'],
    );
  });

  it('lanche que resolve a pendência continua visível (não pune o remédio)', () => {
    const cart = [{ product_id: BATATA, quantity: 1 }];
    assert.ok(filterOfferByCart(cands, cart, rules).some((c) => c.id === BURGUER));
  });

  it('tolerante a entradas vazias', () => {
    assert.deepEqual(filterOfferByCart(null, [], rules), []);
    assert.deepEqual(filterOfferByCart(cands, null, []), cands);
  });
});
