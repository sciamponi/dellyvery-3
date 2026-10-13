import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  listIngredients, createIngredient, updateIngredient, deleteIngredient,
  listSteps, createStep, updateStep, deleteStep, moveStep,
  listOptions, createOption, updateOption, deleteOption,
  listDependencies, listDependenciesWithNames, createDependency,
  setDependencyActive, deleteDependency,
} from './configurator.js';

function createMockClient({ rows = {}, errors = {} } = {}) {
  const calls = [];
  const table = (name) => {
    const cfg = rows[name] || {};
    const chain = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      order: () => chain,
      limit: () => chain,
      insert: (p) => { calls.push({ table: name, op: 'insert', payload: p }); return chain; },
      update: (p) => { calls.push({ table: name, op: 'update', payload: p }); return chain; },
      delete: () => { calls.push({ table: name, op: 'delete' }); return chain; },
      single: async () => cfg.single || { data: null, error: errors[name] || null },
      maybeSingle: async () => cfg.maybeSingle || { data: null, error: errors[name] || null },
      then: (resolve) => { resolve(cfg.list || { data: [], error: errors[name] || null }); },
    };
    return chain;
  };
  return { calls, from: (name) => table(name) };
}

describe('configurator — ingredientes', () => {
  it('cria com empresa + valida antes da rede', async () => {
    const client = createMockClient({ rows: { ingredients: { single: { data: { id: 'i1' }, error: null } } } });
    await assert.rejects(createIngredient(client, 'c1', { name: '' }), /obrigatório/);
    assert.equal(client.calls.length, 0);
    await createIngredient(client, 'c1', { name: ' Bacon ', description: 'Extra', active: true });
    const ins = client.calls[0];
    assert.equal(ins.table, 'ingredients');
    assert.equal(ins.payload.company_id, 'c1');
    assert.equal(ins.payload.name, 'Bacon');
    await assert.rejects(createIngredient(client, '', { name: 'X' }), /Empresa/);
  });

  it('update parcial; delete traduz FK em uso', async () => {
    const client = createMockClient({ rows: { ingredients: { single: { data: { id: 'i1' }, error: null } } } });
    await updateIngredient(client, 'i1', { active: false });
    assert.equal(client.calls[0].payload.active, false);
    await assert.rejects(updateIngredient(client, '', { active: true }), /identificado/);
    const used = createMockClient({
      rows: { ingredients: { list: { data: null, error: { code: '23503', message: 'update violates foreign key' } } } },
    });
    await assert.rejects(deleteIngredient(used, 'i1'), /desative/);
  });
});

describe('configurator — passos (grupos)', () => {
  it('cria no fim da ordem + valida regras', async () => {
    const client = createMockClient({
      rows: {
        product_config_steps: {
          list: { data: [{ position: 2 }], error: null },
          single: { data: { id: 's1' }, error: null },
        },
      },
    });
    await assert.rejects(createStep(client, 'c1', 'p1', { title: '' }), /obrigatório/);
    await createStep(client, 'c1', 'p1', { title: 'Molhos', select_mode: 'single', max_select: 1 });
    const ins = client.calls.find((c) => c.op === 'insert');
    assert.equal(ins.payload.position, 3);
    assert.equal(ins.payload.company_id, 'c1');
    await assert.rejects(createStep(client, 'c1', '', { title: 'G' }), /Produto/);
  });

  it('update valida mesclado; move troca vizinhos', async () => {
    const steps = [
      { id: 's1', position: 0, company_id: 'c1', product_id: 'p1', title: 'A', min_select: 0, max_select: 2 },
      { id: 's2', position: 1, company_id: 'c1', product_id: 'p1', title: 'B', min_select: 0, max_select: 2 },
    ];
    const client = createMockClient({
      rows: {
        product_config_steps: {
          list: { data: steps, error: null },
          single: { data: steps[0], error: null },
          maybeSingle: { data: steps[0], error: null },
        },
      },
    });
    await assert.rejects(updateStep(client, 's1', { min_select: 5, max_select: 2 }), /maior/);
    assert.equal(await moveStep(client, 's1', +1), true);
    const ups = client.calls.filter((c) => c.op === 'update').map((c) => c.payload.position);
    assert.ok(ups.includes(1000000000));
    assert.equal(await moveStep(client, 's2', +1), false);
  });
});

describe('configurator — opções associadas', () => {
  it('origem XOR + preço do banco (payload sem somar produto)', async () => {
    const client = createMockClient({ rows: { product_config_options: { single: { data: { id: 'o1' }, error: null } } } });
    await assert.rejects(createOption(client, { step_id: 's', name: 'X', price: 1 }), /somente um/);
    await createOption(client, { step_id: 's', ingredient_id: 'i1', name: 'Bacon', price: 3.5 });
    const ins = client.calls[0];
    assert.equal(ins.payload.product_id, null);
    assert.equal(ins.payload.price, 3.5);
    await assert.rejects(createOption(client, { step_id: '', ingredient_id: 'i', name: 'X' }), /Grupo/);
  });

  it('update/delete/ler', async () => {
    const client = createMockClient({
      rows: { product_config_options: { single: { data: { id: 'o1' }, error: null }, maybeSingle: { data: { id: 'o1', name: 'X', ingredient_id: 'i', price: 1 }, error: null }, list: { data: [{ id: 'o1' }], error: null } } },
    });
    assert.equal((await listOptions(client, 's')).length, 1);
    await updateOption(client, 'o1', { price: 4 });
    await deleteOption(client, 'o1');
    await assert.rejects(deleteOption(client, ''), /identificada/);
  });
});

describe('configurator — dependências entre produtos', () => {
  it('cria com validações locais (ids, self, duplicada)', async () => {
    const client = createMockClient({
      rows: { product_dependencies: { single: { data: { id: 'd1' }, error: null } } },
    });
    await assert.rejects(createDependency(client, 'c1', '', 'p2'), /dois produtos/);
    await assert.rejects(createDependency(client, 'c1', 'p1', 'p1'), /si mesmo/);
    await assert.rejects(createDependency(client, '', 'p1', 'p2'), /Empresa/);
    const row = await createDependency(client, 'c1', 'batata', 'lanche');
    assert.equal(row.id, 'd1');
    const ins = client.calls[0];
    assert.equal(ins.table, 'product_dependencies');
    assert.equal(ins.payload.company_id, 'c1');
    assert.equal(ins.payload.active, true);
    const dup = createMockClient({
      rows: { product_dependencies: { single: { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "uq_dependency_pair"' } } } },
    });
    await assert.rejects(createDependency(dup, 'c1', 'batata', 'lanche'), /já existe/);
  });

  it('lista com nomes resolvidos em 2 consultas; toggle/delete', async () => {
    const client = createMockClient({
      rows: {
        product_dependencies: { list: { data: [{ id: 'd1', product_id: 'batata', requires_product_id: 'lanche', active: true }], error: null } },
        products: { list: { data: [{ id: 'batata', name: 'Batata' }, { id: 'lanche', name: 'Lanche' }], error: null } },
      },
    });
    const rules = await listDependenciesWithNames(client, 'c1');
    assert.equal(rules.length, 1);
    assert.equal(rules[0].product_name, 'Batata');
    assert.equal(rules[0].requires_name, 'Lanche');
    assert.deepEqual(await listDependencies(client, 'c1'), [{ id: 'd1', product_id: 'batata', requires_product_id: 'lanche', active: true }]);
    await setDependencyActive(client, 'd1', false);
    await deleteDependency(client, 'd1');
    await assert.rejects(setDependencyActive(client, '', true), /identificada/);
    await assert.rejects(deleteDependency(client, ''), /identificada/);
  });
});
