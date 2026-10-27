import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applicableSteps, buildAssemblyLine, canAdvanceStep, canSkipStep, changeOptionQty,
  mergeDraftLine, selectionQty, stepEffectiveMin, summarizeSelection, toSelectionPayload,
  toggleOptionSelection, wizardIndexAfter, wizardIndexBefore,
} from './pdvAssembly.js';

const C1 = 'c1';
const product = (over = {}) => ({
  id: 'p1', company_id: C1, category_id: 'cat1', name: 'X-Burger',
  price: 20, promotional_price: null, active: true, ...over,
});
const step = (over = {}) => ({
  id: 's1', company_id: C1, product_id: 'p1', category_id: null, title: 'Molhos',
  position: 0, select_mode: 'single', min_select: 1, max_select: 1,
  required: true, allow_repeat: false, active: true, ...over,
});
const opt = (over = {}) => ({
  id: 'o1', step_id: 's1', ingredient_id: 'i1', product_id: null,
  name: 'Cheddar', price: 2, active: true, sort_order: 0,
  origin: { active: true, company_id: C1 }, ...over,
});

describe('pdvAssembly - etapas aplicaveis', () => {
  it('mantem ordem configurada e remove opcional vazia', () => {
    const steps = [
      step({ id: 's2', position: 1, title: 'Extras', required: false, min_select: 0, max_select: 3, select_mode: 'multi' }),
      step({ id: 's1', position: 0 }),
    ];
    const options = [opt({ id: 'o1', step_id: 's1' }), opt({ id: 'o2', step_id: 's2' })];
    const list = applicableSteps({ steps, options });
    assert.deepEqual(list.map((s) => s.id), ['s2', 's1']);
    assert.deepEqual(list[0].options.map((o) => o.id), ['o2']);
  });

  it('inclui obrigatoria sem opcoes para denunciar configuracao incompleta', () => {
    const list = applicableSteps({ steps: [step({ id: 'sx', title: 'Vazio' })], options: [] });
    assert.deepEqual(list.map((s) => s.id), ['sx']);
    assert.equal(stepEffectiveMin(list[0]), 1);
  });

  it('min_select sem required tambem e mantido', () => {
    const list = applicableSteps({
      steps: [step({ id: 'sx', required: false, min_select: 2, max_select: 3, select_mode: 'multi' })],
      options: [],
    });
    assert.equal(list.length, 1);
    assert.equal(stepEffectiveMin(list[0]), 2);
  });
});

describe('pdvAssembly - selecao e avanco', () => {
  it('single escolhe, avanca e permite desfazer', () => {
    const st = step();
    const first = toggleOptionSelection({ step: st, selection: {}, optionId: 'o1' });
    assert.deepEqual(first.selection, { s1: { o1: 1 } });
    assert.equal(first.autoAdvance, true);
    const second = toggleOptionSelection({ step: st, selection: first.selection, optionId: 'o1' });
    assert.deepEqual(second.selection, { s1: {} });
    assert.equal(second.autoAdvance, false);
  });

  it('single troca a opcao sem passar do maximo', () => {
    const st = step();
    const selected = { s1: { o1: 1 } };
    const r = toggleOptionSelection({ step: st, selection: selected, optionId: 'o2' });
    assert.deepEqual(r.selection, { s1: { o2: 1 } });
    assert.equal(r.autoAdvance, true);
  });

  it('multi avanca so ao atingir o maximo', () => {
    const st = step({ select_mode: 'multi', required: false, min_select: 0, max_select: 2 });
    const a = toggleOptionSelection({ step: st, selection: {}, optionId: 'o1' });
    assert.equal(a.autoAdvance, false);
    const b = toggleOptionSelection({ step: st, selection: a.selection, optionId: 'o2' });
    assert.equal(b.autoAdvance, true);
    assert.equal(selectionQty(b.selection, 's1'), 2);
    const c = toggleOptionSelection({ step: st, selection: b.selection, optionId: 'o3' });
    assert.deepEqual(c.selection, b.selection);
    assert.equal(c.autoAdvance, false);
  });

  it('repeat respeita maximo e permite diminuir', () => {
    const st = step({ select_mode: 'multi', required: false, min_select: 0, max_select: 3, allow_repeat: true });
    const r = changeOptionQty({ step: st, selection: { s1: { o1: 2 } }, optionId: 'o1', delta: 1 });
    assert.equal(r.selection.s1.o1, 3);
    assert.equal(changeOptionQty({ step: st, selection: r.selection, optionId: 'o1', delta: 1 }).selection.s1.o1, 3);
    const down = changeOptionQty({ step: st, selection: r.selection, optionId: 'o1', delta: -3 });
    assert.deepEqual(down.selection, { s1: {} });
  });

  it('regras de min/max e pular etapa', () => {
    const required = step();
    assert.equal(canAdvanceStep(required, {}), false);
    assert.equal(canAdvanceStep(required, { s1: { o1: 1 } }), true);
    assert.equal(canSkipStep(required), false);
    const optional = step({ required: false, min_select: 0, max_select: 2, select_mode: 'multi' });
    assert.equal(canSkipStep(optional), true);
    assert.equal(canAdvanceStep(optional, {}), true);
    const min = step({ required: false, min_select: 1, max_select: 2, select_mode: 'multi' });
    assert.equal(canSkipStep(min), false);
    assert.equal(canAdvanceStep(min, {}), false);
  });

  it('payload omite etapa vazia', () => {
    assert.deepEqual(toSelectionPayload({ s1: { o1: 0 }, s2: { o2: 2 } }), {
      steps: [{ step_id: 's2', items: [{ option_id: 'o2', quantity: 2 }] }],
    });
  });

  it('resume selecao por etapa', () => {
    const st = step({ id: 's1', title: 'Molhos', options: [opt({ id: 'o1' }), opt({ id: 'o2', name: 'Bacon' })] });
    const r = summarizeSelection([st], { s1: { o1: 1, o2: 2 } });
    assert.deepEqual(r[0].options.map((o) => [o.name, o.quantity]), [['Cheddar', 1], ['Bacon', 2]]);
  });
});

describe('pdvAssembly - linha e envio', () => {
  it('soma apenas adicionais ao preco-base e gera snapshot', () => {
    const line = buildAssemblyLine({
      product: product(), steps: [step()], options: [opt()],
      selection: { s1: { o1: 1 } }, notes: 'sem cebola',
    });
    assert.equal(line.unit_price, 20);
    assert.equal(line.line_total, 22);
    assert.equal(line.notes, 'sem cebola');
    assert.equal(line.complements[0].group_name, 'Molhos');
    assert.equal(line.complements[0].option_name, 'Cheddar');
    assert.equal(line.complements[0].price, 2);
    assert.deepEqual(line.config, { steps: [{ step_id: 's1', items: [{ option_id: 'o1', quantity: 1 }] }] });
  });

  it('produto-opcao paga adicional, nunca o preco integral', () => {
    const line = buildAssemblyLine({
      product: product(),
      steps: [step()],
      options: [opt({ id: 'oc', ingredient_id: null, product_id: 'bev', name: 'Coca', price: 3, origin: { active: true, company_id: C1, price: 9.99 } })],
      selection: { s1: { oc: 1 } },
    });
    assert.equal(line.unit_price, 20);
    assert.equal(line.options_total, 3);
    assert.equal(line.line_total, 23);
    assert.equal(line.complements[0].price, 3);
  });

  it('aceita etapa herdada da categoria', () => {
    const inheritedStep = step({ id: 'sc', product_id: null, category_id: 'cat1', title: 'Extras' });
    const inheritedOpt = opt({ id: 'ocat', step_id: 'sc', name: 'Bacon', price: 4 });
    const line = buildAssemblyLine({
      product: product(), steps: [inheritedStep], options: [inheritedOpt],
      selection: { sc: { ocat: 1 } },
    });
    assert.equal(line.line_total, 24);
    assert.equal(line.complements[0].group_name, 'Extras');
  });

  it('produto sem configuracao vira linha base valida', () => {
    const line = buildAssemblyLine({ product: product(), steps: [], options: [], selection: {} });
    assert.equal(line.line_total, 20);
    assert.deepEqual(line.complements, []);
    assert.equal(line.config, undefined);
  });

  it('nao aceita selecao incompleta ou de outro produto', () => {
    assert.throws(
      () => buildAssemblyLine({ product: product(), steps: [step()], options: [opt()], selection: {} }),
      /obrigat/,
    );
    assert.throws(
      () => buildAssemblyLine({
        product: product(), steps: [step({ id: 'sx', product_id: 'p2' })],
        options: [opt({ id: 'ox', step_id: 'sx' })], selection: { sx: { ox: 1 } },
      }),
      /outro produto/,
    );
  });

  it('mescla linha identica e preserva linhas diferentes', () => {
    const a = { id: 'a', product_id: 'p1', quantity: 1, complements: [], notes: '', config: undefined };
    const b = { id: 'b', product_id: 'p1', quantity: 1, complements: [], notes: '', config: undefined };
    const merged = mergeDraftLine([a], b);
    assert.deepEqual(merged.map((i) => [i.id, i.quantity]), [['a', 2]]);
    const other = { id: 'c', product_id: 'p1', quantity: 1, complements: [], notes: 'sem cebola', config: undefined };
    assert.equal(mergeDraftLine([a], other).length, 2);
    const configured = { id: 'd', product_id: 'p1', quantity: 1, complements: [{ option_name: 'Bacon' }], notes: '', config: { steps: [] } };
    assert.equal(mergeDraftLine([a], configured).length, 2);
  });

  it('nao mescla novo item em linha ja enviada', () => {
    const sent = {
      id: 'sent', product_id: 'p1', quantity: 2, complements: [], notes: '', config: undefined,
      persisted: true,
    };
    const added = {
      id: 'local', product_id: 'p1', quantity: 1, complements: [], notes: '', config: undefined,
    };
    const merged = mergeDraftLine([sent], added);
    assert.equal(merged.length, 2);
    assert.deepEqual(merged.map((i) => [i.id, i.quantity, !!i.persisted]), [
      ['sent', 2, true],
      ['local', 1, false],
    ]);
  });

  it('indices do wizard fazem clamp e permitem voltar', () => {
    assert.equal(wizardIndexAfter(0, 3), 1);
    assert.equal(wizardIndexAfter(2, 3), 3);
    assert.equal(wizardIndexAfter(3, 3), 3);
    assert.equal(wizardIndexBefore(0), 0);
    assert.equal(wizardIndexBefore(2), 1);
  });
});
