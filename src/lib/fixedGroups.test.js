import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  FIXED_GROUP_DEFINITIONS,
  usesFixedGroups,
  fixedGroupsForCategory,
  findFixedStep,
  findFixedCategory,
  fixedStepPayload,
  planFixedGroupOptions,
} from './fixedGroups.js';

const definition = (slug) => FIXED_GROUP_DEFINITIONS.find((item) => item.slug === slug);

describe('fixedGroups — Lanches', () => {
  it('reconhece as categorias com grupos fixos por slug ou nome', () => {
    for (const slug of ['lanches', 'acompanhamentos', 'sobremesas', 'bebidas', 'combos', 'extras']) {
      assert.equal(usesFixedGroups({ slug }), true);
    }
    assert.equal(usesFixedGroups({ name: '  Acompanhamentos ' }), true);
    assert.equal(usesFixedGroups({ slug: 'outros', name: 'Outros' }), false);
    assert.equal(usesFixedGroups(null), false);
  });

  it('mostra os outros grupos fixos, sem repetir a categoria atual', () => {
    const titles = (slug) => fixedGroupsForCategory({ slug }).map((item) => item.title);
    assert.deepEqual(titles('lanches'), ['Acompanhamentos', 'Bebidas', 'Sobremesas', 'Extras']);
    assert.deepEqual(titles('acompanhamentos'), ['Lanches', 'Bebidas', 'Sobremesas', 'Extras']);
    assert.deepEqual(titles('bebidas'), ['Lanches', 'Acompanhamentos', 'Sobremesas', 'Extras']);
    assert.deepEqual(titles('combos'), ['Lanches', 'Acompanhamentos', 'Bebidas', 'Sobremesas', 'Extras']);
    assert.deepEqual(titles('extras'), ['Lanches', 'Acompanhamentos', 'Bebidas', 'Sobremesas']);
  });

  it('acha o grupo fixo existente pelo título', () => {
    const steps = [{ id: 's1', title: 'Bebidas' }, { id: 's2', title: ' Acompanhamentos ' }];
    assert.equal(findFixedStep(steps, definition('acompanhamentos')).id, 's2');
    assert.equal(findFixedStep(steps, definition('extras')), null);
    assert.equal(findFixedStep(null, definition('bebidas')), null);
  });

  it('acha a categoria de origem por slug e depois por nome', () => {
    const categories = [
      { id: 'c1', slug: 'bebidas', name: 'Bebidas' },
      { id: 'c2', slug: null, name: 'Sobremesas' },
    ];
    assert.equal(findFixedCategory(categories, definition('bebidas')).id, 'c1');
    assert.equal(findFixedCategory(categories, definition('sobremesas')).id, 'c2');
    assert.equal(findFixedCategory(categories, definition('extras')), null);
  });

  it('payload do grupo fixo é único, opcional e com limite 1', () => {
    const p = fixedStepPayload(definition('extras'));
    assert.equal(p.title, 'Extras');
    assert.equal(p.select_mode, 'single');
    assert.equal(p.required, false);
    assert.equal(p.max_select, 1);
    assert.equal(p.active, true);
  });
});

describe('fixedGroups — opções espelhando produtos', () => {
  const categoryId = 'cat-bebidas';
  const products = [
    { id: 'p1', name: 'Coca-Cola', category_id: categoryId, price: 10, promotional_price: 8, available: true, sort_order: 2 },
    { id: 'p2', name: 'Suco', category_id: categoryId, price: 7, available: false },
    { id: 'p3', name: 'Batata', category_id: 'cat-outra', price: 15 },
  ];

  it('cria só produtos da categoria, com preço efetivo e disponibilidade', () => {
    const plan = planFixedGroupOptions({
      stepId: 'step1', categoryId, products, existingOptions: [],
    });
    assert.equal(plan.productCount, 2);
    assert.equal(plan.creates.length, 2);
    assert.equal(plan.creates[0].product_id, 'p1');
    assert.equal(plan.creates[0].price, 8);
    assert.equal(plan.creates[0].active, true);
    assert.equal(plan.creates[1].product_id, 'p2');
    assert.equal(plan.creates[1].active, false);
    assert.equal(plan.updates.length, 0);
  });

  it('não duplica produto já associado; atualiza nome/preço sem mexer no ativo', () => {
    const plan = planFixedGroupOptions({
      stepId: 'step1',
      categoryId,
      products,
      existingOptions: [
        { id: 'o1', product_id: 'p1', name: 'Coca antiga', price: 9, active: false },
        { id: 'o2', ingredient_id: 'i1', name: 'Bacon', price: 2 },
      ],
    });
    assert.equal(plan.creates.length, 1);
    assert.equal(plan.creates[0].product_id, 'p2');
    assert.deepEqual(plan.updates, [{ id: 'o1', patch: { name: 'Coca-Cola', price: 8 } }]);
  });

  it('categoria sem produtos devolve plano vazio', () => {
    const plan = planFixedGroupOptions({ stepId: 's', categoryId: 'vazia', products, existingOptions: [] });
    assert.deepEqual(plan, { creates: [], updates: [], productCount: 0 });
  });
});
