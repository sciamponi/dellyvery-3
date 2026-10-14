import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeName, isAvailableProduct, hasConfigurableOptions, suggestUpsell,
  UPSELL_STEP_ORDER, suggestUpsellSteps, guideMessageFor,
} from './upsell.js';

const cats = [
  { id: 'c1', name: 'Lanches' },
  { id: 'c2', name: 'Bebidas' },
  { id: 'c3', name: 'Sobremesas' },
  { id: 'c4', name: 'Porções' },
];
const prod = (over = {}) => ({
  id: 'p', category_id: 'c1', name: 'X', price: 10, available: true, ...over,
});

describe('upsell — normalização e disponibilidade', () => {
  it('normalize ignora acento e caixa', () => {
    assert.equal(normalizeName('Bebidás GELADAS'), 'bebidas geladas');
    assert.equal(normalizeName(null), '');
  });

  it('disponível exclui indisponível/sem estoque', () => {
    assert.equal(isAvailableProduct(prod()), true);
    assert.equal(isAvailableProduct(prod({ available: false })), false);
    assert.equal(isAvailableProduct(prod({ out_of_stock: true })), false);
    assert.equal(isAvailableProduct(null), false);
  });

  it('detecta produto configurável', () => {
    assert.equal(hasConfigurableOptions(prod()), false);
    assert.equal(hasConfigurableOptions(prod({ complements: [{ name: 'G' }] })), true);
    assert.equal(hasConfigurableOptions(prod({ options: [{ name: 'G' }] })), true);
  });
});

describe('upsell — seções de sugestão', () => {
  const menu = [
    prod({ id: 'lanche', category_id: 'c1', name: 'X-Bacon' }),
    prod({ id: 'salada', category_id: 'c1', name: 'X-Salada' }),
    prod({ id: 'coca', category_id: 'c2', name: 'Coca' }),
    prod({ id: 'suco', category_id: 'c2', name: 'Suco', available: false }),
    prod({ id: 'pudim', category_id: 'c3', name: 'Pudim' }),
    prod({ id: 'fritas', category_id: 'c4', name: 'Fritas' }),
  ];

  it('monta bebidas/sobremesas/relacionados, fora indisponíveis (sugestão mantém adicionados p/ stepper)', () => {
    const sections = suggestUpsell({
      products: menu, categories: cats, cartItems: [{ product_id: 'lanche' }],
    });
    const byId = Object.fromEntries(sections.map((s) => [s.id, s.items.map((i) => i.id)]));
    assert.deepEqual(byId.drinks, ['coca']);
    assert.deepEqual(byId.desserts, ['pudim']);
    assert.deepEqual(byId.related, ['lanche', 'salada']);
  });

  it('sem itens no carrinho ainda sugere; sem seção vazia', () => {
    const sections = suggestUpsell({ products: menu, categories: cats, cartItems: [] });
    assert.ok(sections.length >= 2);
    assert.ok(sections.every((s) => s.items.length > 0 && s.title));
  });

  it('respeita limite por seção e prioriza fixadas', () => {
    const many = Array.from({ length: 6 }, (_, i) => prod({ id: `d${i}`, category_id: 'c2', name: `B${i}` }));
    const sections = suggestUpsell({ products: many, categories: cats, cartItems: [], limitPerSection: 2 });
    assert.equal(sections.find((s) => s.id === 'drinks').items.length, 2);
    const pinned = suggestUpsell({
      products: many, categories: cats, cartItems: [], pinCategoryIds: ['c2'],
    });
    assert.equal(pinned[0].id, 'pinned');
  });

  it('categorias sem match não viram bebida/sobremesa', () => {
    const sections = suggestUpsell({
      products: [prod({ id: 'x', category_id: 'c1' })],
      categories: cats, cartItems: [{ product_id: 'outro' }],
    });
    assert.ok(!sections.some((s) => s.id === 'drinks' || s.id === 'desserts'));
  });
});

describe('upsell — jornada por etapas (Fase B)', () => {
  const cats2 = [
    { id: 'c1', name: 'Lanches' },
    { id: 'c2', name: 'Bebidas' },
    { id: 'c3', name: 'Sobremesas' },
    { id: 'c5', name: 'Porções' },
  ];
  const menu2 = [
    prod({ id: 'lanche', category_id: 'c1', name: 'X-Bacon' }),
    prod({ id: 'coca', category_id: 'c2', name: 'Coca' }),
    prod({ id: 'suco', category_id: 'c2', name: 'Suco', available: false }),
    prod({ id: 'pudim', category_id: 'c3', name: 'Pudim' }),
    prod({ id: 'fritas', category_id: 'c5', name: 'Fritas' }),
    prod({ id: 'nuggets', category_id: 'c5', name: 'Nuggets' }),
  ];

  it('ordem fixa acompanhamentos → bebidas → sobremesas', () => {
    assert.deepEqual(UPSELL_STEP_ORDER.map((s) => s.id), ['sides', 'drinks', 'desserts']);
    const steps = suggestUpsellSteps({ products: menu2, categories: cats2, cartItems: [] });
    assert.deepEqual(steps.map((s) => s.id), ['sides', 'drinks', 'desserts']);
    assert.deepEqual(steps[0].items.map((i) => i.id), ['fritas', 'nuggets']);
    assert.deepEqual(steps[1].items.map((i) => i.id), ['coca']);
    assert.deepEqual(steps[2].items.map((i) => i.id), ['pudim']);
  });

  it('etapas vazias são puladas; indisponíveis excluídos', () => {
    const noDessert = suggestUpsellSteps({
      products: menu2.filter((p) => p.category_id !== 'c3'),
      categories: cats2, cartItems: [],
    });
    assert.deepEqual(noDessert.map((s) => s.id), ['sides', 'drinks']);
    const empty = suggestUpsellSteps({
      products: [prod({ id: 'x', category_id: 'c1' })],
      categories: cats2, cartItems: [],
    });
    assert.deepEqual(empty, []);
  });

  it('dois produtos da mesma categoria cabem na etapa; limite respeitado', () => {
    const steps = suggestUpsellSteps({ products: menu2, categories: cats2, cartItems: [], limitPerSection: 1 });
    assert.equal(steps[0].items.length, 1);
    const full = suggestUpsellSteps({ products: menu2, categories: cats2, cartItems: [] });
    assert.equal(full.find((s) => s.id === 'sides').items.length, 2);
  });

  it('acentuação/capitalização normalizadas no match', () => {
    const steps = suggestUpsellSteps({
      products: [prod({ id: 'b', category_id: 'c9', name: 'X' })],
      categories: [{ id: 'c9', name: 'BEBIDÁS Geladas' }],
      cartItems: [],
    });
    assert.deepEqual(steps.map((s) => s.id), ['drinks']);
  });
});

describe('upsell — guideMessageFor', () => {
  it('mensagens curtas por secao', () => {
    assert.equal(guideMessageFor('drinks'), 'Que tal uma bebida para acompanhar?');
    assert.equal(guideMessageFor('desserts'), 'Deseja incluir uma sobremesa, como açaí?');
    assert.equal(guideMessageFor('related', 'Combinam'), 'Combinam');
    assert.equal(guideMessageFor('unknown'), 'Que tal completar seu pedido?');
  });
});
