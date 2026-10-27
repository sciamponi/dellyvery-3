import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isV2Options,
  isLegacyOptions,
  summarizeLegacyOptions,
  validateProductConfig,
  calcConfiguredLineTotal,
} from './productConfig.js';

const C1 = 'c1';
const prod = (over = {}) => ({
  id: 'p1', company_id: C1, price: 18, promotional_price: null, active: true, ...over,
});
const step = (over = {}) => ({
  id: 's1', company_id: C1, product_id: 'p1', position: 0, title: 'Etapa',
  select_mode: 'multi', min_select: 0, max_select: 3, free_qty: 0,
  required: false, allow_repeat: false, active: true, ...over,
});
const opt = (over = {}) => ({
  id: 'o1', step_id: 's1', ingredient_id: 'i1', product_id: null,
  name: 'Banana', price: 0, active: true, sort_order: 0,
  origin: { active: true, company_id: C1 }, ...over,
});
const sel = (stepId, ...items) => ({ steps: [{ step_id: stepId, items }] });
const item = (option_id, quantity = 1) => ({ option_id, quantity });

describe('productConfig — base e opcionais', () => {
  it('A. produto sem configuração: só base × qty', () => {
    const r = validateProductConfig({ product: prod(), steps: [], options: [], selection: {}, quantity: 2 });
    assert.equal(r.baseUnitPrice, 18);
    assert.equal(r.lineTotal, 36);
    assert.deepEqual(r.snapshot, { v: 2, steps: [] });
  });

  it('B. step opcional vazio é válido', () => {
    const r = validateProductConfig({
      product: prod(), steps: [step()], options: [opt()], selection: {}, quantity: 1,
    });
    assert.equal(r.lineTotal, 18);
  });

  it('C. required sem seleção → erro', () => {
    assert.throws(
      () => validateProductConfig({
        product: prod(), steps: [step({ required: true, min_select: 1, max_select: 1, select_mode: 'single' })],
        options: [opt()], selection: {}, quantity: 1,
      }),
      /obrigatória/,
    );
  });

  it('D. min_select não atingido → erro', () => {
    assert.throws(
      () => validateProductConfig({
        product: prod(), steps: [step({ min_select: 2, max_select: 3 })],
        options: [opt()], selection: sel('s1', item('o1')), quantity: 1,
      }),
      /mínimo 2/,
    );
  });

  it('E. max_select excedido → erro', () => {
    const opts = [opt({ id: 'o1' }), opt({ id: 'o2', name: 'M' }), opt({ id: 'o3', name: 'N' }), opt({ id: 'o4', name: 'O' })];
    assert.throws(
      () => validateProductConfig({
        product: prod(), steps: [step({ max_select: 3 })], options: opts,
        selection: sel('s1', item('o1'), item('o2'), item('o3'), item('o4')), quantity: 1,
      }),
      /máximo 3/,
    );
  });

  it('F. single com duas opções → erro', () => {
    const st = step({ select_mode: 'single', required: true, min_select: 1, max_select: 1 });
    assert.throws(
      () => validateProductConfig({
        product: prod(), steps: [st], options: [opt({ id: 'o1' }), opt({ id: 'o2', name: 'B' })],
        selection: sel('s1', item('o1'), item('o2')), quantity: 1,
      }),
      /apenas 1/,
    );
  });

  it('G. multi válido soma adicionais', () => {
    const r = validateProductConfig({
      product: prod(), steps: [step({ max_select: 3 })],
      options: [opt({ id: 'o1' }), opt({ id: 'o9', name: 'Nutella', price: 3, sort_order: 1 })],
      selection: sel('s1', item('o1'), item('o9')), quantity: 1,
    });
    assert.equal(r.optionsTotal, 3);
    assert.equal(r.unitTotal, 21);
    assert.equal(r.lineTotal, 21);
  });
});

describe('productConfig — repeat e free_qty', () => {
  it('H. allow_repeat=false + qty 2 → erro', () => {
    assert.throws(
      () => validateProductConfig({
        product: prod(), steps: [step()], options: [opt()],
        selection: sel('s1', item('o1', 2)), quantity: 1,
      }),
      /maior que 1/,
    );
  });

  it('I. allow_repeat=true + qty 2 → válido', () => {
    const r = validateProductConfig({
      product: prod(), steps: [step({ allow_repeat: true, max_select: 3 })],
      options: [opt({ id: 'o9', name: 'Nutella', price: 3 })],
      selection: sel('s1', item('o9', 2)), quantity: 1,
    });
    assert.equal(r.optionsTotal, 6);
    assert.equal(r.lineTotal, 24);
  });

  const trio = () => ([
    opt({ id: 'o1', name: 'Banana', price: 0, sort_order: 0 }),
    opt({ id: 'o2', name: 'Morango', price: 0, sort_order: 1 }),
    opt({ id: 'o9', name: 'Nutella', price: 3, sort_order: 2 }),
  ]);

  it('J. free_qty: menores preços grátis (Banana+Morango grátis, Nutella paga)', () => {
    const r = validateProductConfig({
      product: prod(), steps: [step({ max_select: 3, free_qty: 2 })], options: trio(),
      selection: sel('s1', item('o1'), item('o2'), item('o9')), quantity: 1,
    });
    assert.equal(r.optionsTotal, 3);
    assert.equal(r.lineTotal, 21);
    assert.deepEqual(r.freeItems.map((i) => i.name).sort(), ['Banana', 'Morango']);
    assert.deepEqual(r.paidItems.map((i) => i.name), ['Nutella']);
    const snap = r.snapshot.steps[0].items;
    assert.equal(snap.find((i) => i.name === 'Banana').free, true);
    assert.equal(snap.find((i) => i.name === 'Nutella').free, false);
  });

  it('K. free_qty com empate: desempate por sort_order', () => {
    const r = validateProductConfig({
      product: prod(),
      steps: [step({ max_select: 2, free_qty: 1 })],
      options: [
        opt({ id: 'oa', name: 'A', price: 5, sort_order: 1 }),
        opt({ id: 'ob', name: 'B', price: 5, sort_order: 0 }),
      ],
      selection: sel('s1', item('oa'), item('ob')), quantity: 1,
    });
    assert.equal(r.optionsTotal, 5);
    assert.deepEqual(r.freeItems.map((i) => i.name), ['B']);
  });

  it('L. free_qty com repetição: Banana + Nutella×2, free=2 → paga 1 Nutella', () => {
    const r = validateProductConfig({
      product: prod(),
      steps: [step({ max_select: 3, free_qty: 2, allow_repeat: true })],
      options: [
        opt({ id: 'o1', name: 'Banana', price: 0, sort_order: 0 }),
        opt({ id: 'o9', name: 'Nutella', price: 3, sort_order: 1 }),
      ],
      selection: sel('s1', item('o1'), item('o9', 2)), quantity: 1,
    });
    assert.equal(r.optionsTotal, 3);
    assert.equal(r.lineTotal, 21);
    const nut = r.snapshot.steps[0].items.filter((i) => i.name === 'Nutella');
    assert.equal(nut.length, 2);
    assert.deepEqual(nut.map((i) => [i.quantity, i.free]).sort(), [[1, false], [1, true]]);
  });
});

describe('productConfig — integridade e tenant', () => {
  it('M. option inexistente → erro', () => {
    assert.throws(
      () => validateProductConfig({
        product: prod(), steps: [step()], options: [opt()],
        selection: sel('s1', item('nope')), quantity: 1,
      }),
      /inexistente/,
    );
  });

  it('N. option de outro step → erro', () => {
    const other = opt({ id: 'ox', step_id: 's2', name: 'X' });
    assert.throws(
      () => validateProductConfig({
        product: prod(), steps: [step(), step({ id: 's2', title: 'Outro' })], options: [opt(), other],
        selection: sel('s1', item('ox')), quantity: 1,
      }),
      /outra etapa/,
    );
  });

  it('O. step de outro produto → erro (inclui duplicado)', () => {
    const foreign = step({ id: 'sf', product_id: 'pX', title: 'Alheio' });
    assert.throws(
      () => validateProductConfig({
        product: prod(), steps: [step(), foreign], options: [opt()],
        selection: sel('sf', item('o1')), quantity: 1,
      }),
      /outro produto/,
    );
    assert.throws(
      () => validateProductConfig({
        product: prod(), steps: [step()], options: [opt()],
        selection: { steps: [{ step_id: 's1', items: [] }, { step_id: 's1', items: [] }] }, quantity: 1,
      }),
      /mais de uma vez/,
    );
  });

  it('P. origem de outra empresa → erro', () => {
    assert.throws(
      () => validateProductConfig({
        product: prod(), steps: [step()], options: [opt({ origin: { active: true, company_id: 'OUTRA' } })],
        selection: sel('s1', item('o1')), quantity: 1,
      }),
      /outra empresa/,
    );
  });

  it('Q. opção inativa → erro', () => {
    assert.throws(
      () => validateProductConfig({
        product: prod(), steps: [step()], options: [opt({ active: false })],
        selection: sel('s1', item('o1')), quantity: 1,
      }),
      /indisponível/,
    );
  });

  it('R. origem inativa/inexistente → erro', () => {
    assert.throws(
      () => validateProductConfig({
        product: prod(), steps: [step()], options: [opt({ origin: { active: false, company_id: C1 } })],
        selection: sel('s1', item('o1')), quantity: 1,
      }),
      /indisponível/,
    );
    assert.throws(
      () => validateProductConfig({
        product: prod(), steps: [step()],
        options: [{ id: 'ob', step_id: 's1', ingredient_id: null, product_id: null, name: 'X', price: 1, active: true, sort_order: 0 }],
        selection: sel('s1', item('ob')), quantity: 1,
      }),
      /origem válida/,
    );
  });
});

describe('productConfig — preço, snapshot e legado', () => {
  it('S. preço/nome do payload são ignorados (só ids entram)', () => {
    const r = validateProductConfig({
      product: prod(), steps: [step({ max_select: 2 })],
      options: [opt({ id: 'o9', name: 'Nutella Verdadeira', price: 3 })],
      selection: { steps: [{ step_id: 's1', items: [{ option_id: 'o9', quantity: 1, price: 0.01, name: 'Falsa', free: true }] }] },
      quantity: 1,
    });
    assert.equal(r.optionsTotal, 3);
    assert.equal(r.snapshot.steps[0].items[0].name, 'Nutella Verdadeira');
    assert.equal(r.snapshot.steps[0].items[0].free, false);
  });

  it('T. option product_id NÃO soma products.price (só o adicional)', () => {
    const r = validateProductConfig({
      product: prod({ price: 32 }),
      steps: [step({ select_mode: 'single', required: true, min_select: 1, max_select: 1 })],
      options: [{
        id: 'oc', step_id: 's1', ingredient_id: null, product_id: 'pref',
        name: 'Coca 600ml', price: 3, active: true, sort_order: 0,
        origin: { active: true, company_id: C1, price: 9.99 },
      }],
      selection: sel('s1', item('oc')), quantity: 1,
    });
    assert.equal(r.optionsTotal, 3);
    assert.equal(r.unitTotal, 35);
    assert.equal(r.snapshot.steps[0].items[0].kind, 'product');
    assert.equal(r.snapshot.steps[0].items[0].ref_id, 'pref');
  });

  it('U. promotional_price tem prioridade na base', () => {
    const r = validateProductConfig({
      product: prod({ price: 18, promotional_price: 15 }),
      steps: [], options: [], selection: {}, quantity: 1,
    });
    assert.equal(r.baseUnitPrice, 15);
    assert.equal(r.lineTotal, 15);
  });

  it('V. line total multiplica pela quantidade do produto', () => {
    const r = validateProductConfig({
      product: prod(), steps: [step({ max_select: 1 })],
      options: [opt({ id: 'o9', name: 'Nutella', price: 3 })],
      selection: sel('s1', item('o9')), quantity: 3,
    });
    assert.equal(r.unitTotal, 21);
    assert.equal(r.lineTotal, 63);
  });

  it('W. snapshot v2 completo', () => {
    const r = validateProductConfig({
      product: prod(), steps: [step({ title: 'Bebida', select_mode: 'single', required: true, min_select: 1, max_select: 1 })],
      options: [{
        id: 'oc', step_id: 's1', ingredient_id: null, product_id: 'pref',
        name: 'Coca-Cola', price: 0, active: true, sort_order: 0,
        origin: { active: true, company_id: C1 },
      }],
      selection: sel('s1', item('oc')), quantity: 1,
    });
    assert.equal(isV2Options(r.snapshot), true);
    assert.deepEqual(r.snapshot.steps[0], {
      step_id: 's1',
      title: 'Bebida',
      items: [{
        option_id: 'oc', kind: 'product', ref_id: 'pref', name: 'Coca-Cola',
        price: 0, quantity: 1, free: false,
      }],
    });
  });

  it('X. pedido legado continua legível', () => {
    const legacy = [
      { group_name: 'G', option_name: 'Bacon', price: 4.5, quantity: 1 },
      { name: 'Queijo', quantity: 2 },
    ];
    assert.equal(isLegacyOptions(legacy), true);
    assert.equal(isV2Options(legacy), false);
    assert.equal(isV2Options({ v: 2, steps: [] }), true);
    assert.deepEqual(summarizeLegacyOptions(legacy), [
      { name: 'Bacon', quantity: 1, price: 4.5 },
      { name: 'Queijo', quantity: 2, price: 0 },
    ]);
    assert.deepEqual(summarizeLegacyOptions(null), []);
    assert.equal(calcConfiguredLineTotal({ product: prod(), steps: [], options: [], selection: {} }).lineTotal, 18);
  });
});

describe('productConfig — combo (4 grupos)', () => {
  const C1 = 'c1';
  const comboProd = () => ({ id: 'pc', company_id: C1, name: 'Combo X', price: 30, active: true });
  const comboStep = (over = {}) => ({
    id: 'cs', company_id: C1, product_id: 'pc', title: 'Grupo', position: 0,
    select_mode: 'multi', min_select: 0, max_select: 1, free_qty: 0,
    required: false, allow_repeat: false, active: true, ...over,
  });
  const comboOpt = (over = {}) => ({
    id: 'co', step_id: 'cs', ingredient_id: null, product_id: 'prod-outro',
    name: 'Refri', price: 4, active: true, sort_order: 0,
    origin: { active: true, company_id: C1 }, ...over,
  });

  it('grupos obrigatorios ausentes geram erro; opcionais vao em branco', () => {
    const steps = [
      comboStep({ id: 's-acc', title: 'Acompanhamento', required: true, min_select: 1, max_select: 1, select_mode: 'single' }),
      comboStep({ id: 's-beb', title: 'Bebida', required: true, min_select: 1, max_select: 1, select_mode: 'single' }),
      comboStep({ id: 's-sob', title: 'Sobremesa', required: false, min_select: 0, max_select: 1, select_mode: 'single' }),
      comboStep({ id: 's-ext', title: 'Extra', required: false, min_select: 0, max_select: 20, select_mode: 'multi', allow_repeat: true }),
    ];
    const options = [comboOpt({ id: 'o1', step_id: 's-acc' }), comboOpt({ id: 'o2', step_id: 's-beb' })];
    assert.throws(
      () => validateProductConfig({ product: comboProd(), steps, options, selection: {}, quantity: 1 }),
      /obrigatória/,
    );
    const r = validateProductConfig({
      product: comboProd(), steps, options,
      selection: { steps: [
        { step_id: 's-acc', items: [{ option_id: 'o1', quantity: 1 }] },
        { step_id: 's-beb', items: [{ option_id: 'o2', quantity: 1 }] },
      ] }, quantity: 1,
    });
    assert.equal(r.optionsTotal, 8);
    assert.equal(r.lineTotal, 38);
  });

  it('grupo single com duas escolhas rejeita', () => {
    const st = comboStep({ id: 's1', select_mode: 'single', required: true, min_select: 1, max_select: 1 });
    assert.throws(
      () => validateProductConfig({
        product: comboProd(), steps: [st],
        options: [comboOpt({ id: 'oa', step_id: 's1' }), comboOpt({ id: 'ob', step_id: 's1', name: 'B' })],
        selection: { steps: [{ step_id: 's1', items: [{ option_id: 'oa' }, { option_id: 'ob' }] }] }, quantity: 1,
      }),
      /apenas 1/,
    );
  });

  it('grupo extra multi permite repeticao e soma', () => {
    const st = comboStep({ id: 'sx', title: 'Extra', select_mode: 'multi', min_select: 0, max_select: 20, allow_repeat: true });
    const r = validateProductConfig({
      product: comboProd(), steps: [st],
      options: [comboOpt({ id: 'ox', step_id: 'sx', price: 3 })],
      selection: { steps: [{ step_id: 'sx', items: [{ option_id: 'ox', quantity: 2 }] }] }, quantity: 1,
    });
    assert.equal(r.optionsTotal, 6);
    assert.equal(r.lineTotal, 36);
  });

  it('origem de produto nao soma o preco do produto, somente o adicional', () => {
    const st = comboStep({ id: 's1', select_mode: 'single', required: true, min_select: 1, max_select: 1 });
    const r = validateProductConfig({
      product: comboProd(), steps: [st],
      options: [{ id: 'oc', step_id: 's1', ingredient_id: null, product_id: 'pr-beb', name: 'Coca 600ml', price: 3, active: true, sort_order: 0, origin: { active: true, company_id: C1, price: 9.99 } }],
      selection: { steps: [{ step_id: 's1', items: [{ option_id: 'oc', quantity: 1 }] }] }, quantity: 1,
    });
    assert.equal(r.optionsTotal, 3);
    assert.equal(r.unitTotal, 33);
    assert.equal(r.snapshot.steps[0].items[0].kind, 'product');
  });
});

describe('productConfig - etapas herdadas da categoria', () => {
  const catProd = (over = {}) => prod({ category_id: 'cat1', ...over });
  const catStep = (over = {}) => step({
    id: 's-cat', product_id: null, category_id: 'cat1', title: 'Molhos',
    select_mode: 'single', required: true, min_select: 1, max_select: 1, ...over,
  });
  const catOpt = (over = {}) => opt({
    id: 'o-cat', step_id: 's-cat', name: 'Cheddar', price: 2, ...over,
  });

  it('aceita etapa herdada e cobra o adicional', () => {
    const r = validateProductConfig({
      product: catProd(), steps: [catStep()], options: [catOpt()],
      selection: sel('s-cat', item('o-cat')), quantity: 1,
    });
    assert.equal(r.optionsTotal, 2);
    assert.equal(r.lineTotal, 20);
    assert.equal(r.snapshot.steps[0].title, 'Molhos');
  });

  it('exige etapa herdada obrigatoria quando vazia', () => {
    assert.throws(
      () => validateProductConfig({
        product: catProd(), steps: [catStep()], options: [catOpt()], selection: {}, quantity: 1,
      }),
      /obrigat/,
    );
  });

  it('produto com use_category_steps=false ignora e rejeita a etapa herdada', () => {
    assert.throws(
      () => validateProductConfig({
        product: catProd({ use_category_steps: false }), steps: [catStep()], options: [catOpt()],
        selection: sel('s-cat', item('o-cat')), quantity: 1,
      }),
      /outro produto/,
    );
  });

  it('nao aceita etapa de outra categoria', () => {
    assert.throws(
      () => validateProductConfig({
        product: catProd({ category_id: 'cat2' }), steps: [catStep()], options: [catOpt()],
        selection: sel('s-cat', item('o-cat')), quantity: 1,
      }),
      /outro produto/,
    );
  });
});
