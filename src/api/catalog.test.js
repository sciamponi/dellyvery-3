import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  fromSupabaseCategory,
  toSupabaseCategory,
  fromSupabaseProduct,
  toSupabaseProduct,
  toSupabaseProductPatch,
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  listProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  assertCategoryOfCompany,
} from './catalog.js';

// Mock sem rede: terminais single()/maybeSingle() e await direto resolvem
// resultados configurados por tabela.
function createMockClient({ tables = {} } = {}) {
  const calls = [];
  const table = (name) => {
    const cfg = tables[name] || {};
    const chain = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      insert: (payload) => {
        calls.push({ table: name, op: 'insert', payload });
        return chain;
      },
      update: (payload) => {
        calls.push({ table: name, op: 'update', payload });
        return chain;
      },
      delete: () => {
        calls.push({ table: name, op: 'delete' });
        return chain;
      },
      single: async () => cfg.single || { data: null, error: null },
      maybeSingle: async () => cfg.maybeSingle || { data: null, error: null },
      then: (resolve, reject) => {
        try {
          resolve(cfg.list || { data: [], error: null });
        } catch (e) {
          reject(e);
        }
      },
    };
    return chain;
  };
  return { calls, from: (name) => table(name) };
}

describe('catalog — mapeamento categorias', () => {
  it('order <-> sort_order', () => {
    assert.equal(fromSupabaseCategory({ id: '1', sort_order: 3 }).order, 3);
    assert.deepEqual(toSupabaseCategory({ name: 'X', order: 3 }).sort_order, 3);
  });
});

describe('catalog — mapeamento produtos', () => {
  it('available <-> active, complements <-> options', () => {
    const row = {
      id: 'p', company_id: 'c', category_id: null, name: 'N', price: '10.50',
      promotional_price: null, active: false, options: [{ name: 'G', max_select: 1, options: [] }],
    };
    const p = fromSupabaseProduct(row);
    assert.equal(p.available, false);
    assert.equal(p.price, 10.5);
    assert.deepEqual(p.complements, row.options);
    const sb = toSupabaseProduct('c', { name: 'N', price: '10.50', available: false, complements: row.options });
    assert.equal(sb.active, false);
    assert.equal(sb.company_id, 'c');
    assert.deepEqual(sb.options, row.options);
  });

  it('update parcial não envia company_id nem defaults', () => {
    const patch = toSupabaseProductPatch({ available: false });
    assert.deepEqual(patch, { active: false });
  });
});

describe('catalog — categorias CRUD', () => {
  it('listar retorna mapeadas', async () => {
    const client = createMockClient({
      tables: { categories: { list: { data: [{ id: 'c1', company_id: 'co', name: 'A', sort_order: 1 }], error: null } } },
    });
    const cats = await listCategories(client, 'co');
    assert.deepEqual(cats, [{ id: 'c1', company_id: 'co', name: 'A', description: undefined, icon: undefined, image_url: undefined, active: undefined, order: 1 }]);
  });

  it('criar exige nome e força company_id do contexto', async () => {
    const created = { id: 'c1', company_id: 'co', name: 'A', sort_order: 0 };
    const client = createMockClient({ tables: { categories: { single: { data: created, error: null } } } });
    await createCategory(client, 'co', { name: 'A', icon: '🍔' });
    assert.equal(client.calls[0].payload.company_id, 'co');
    assert.equal(client.calls[0].payload.icon, '🍔');
    await assert.rejects(() => createCategory(client, 'co', { name: '  ' }), /Nome é obrigatório/);
  });

  it('usuário sem empresa não acessa (falha antes da rede)', async () => {
    const client = createMockClient();
    await assert.rejects(() => listCategories(client, null), /Empresa atual/);
    assert.equal(client.calls.length, 0);
  });

  it('excluir chama delete', async () => {
    const client = createMockClient();
    await deleteCategory(client, 'c1');
    assert.deepEqual(client.calls[0], { table: 'categories', op: 'delete' });
  });
});

describe('catalog — produtos CRUD', () => {
  it('criar valida categoria da mesma empresa', async () => {
    const created = { id: 'p1', company_id: 'coA', name: 'P', price: 5, active: true, options: [] };
    const okClient = createMockClient({
      tables: {
        categories: { maybeSingle: { data: { id: 'cat1', company_id: 'coA' }, error: null } },
        products: { single: { data: created, error: null } },
      },
    });
    await createProduct(okClient, 'coA', { name: 'P', price: 5, category_id: 'cat1' });
    const badClient = createMockClient({
      tables: { categories: { maybeSingle: { data: { id: 'catB', company_id: 'coB' }, error: null } } },
    });
    await assert.rejects(
      () => createProduct(badClient, 'coA', { name: 'P', price: 5, category_id: 'catB' }),
      /outra empresa/,
    );
  });

  it('inserir em outra company usa company_id do contexto (nunca do payload)', async () => {
    const created = { id: 'p1', company_id: 'coA', name: 'P', price: 5, active: true, options: [] };
    const client = createMockClient({
      tables: { products: { single: { data: created, error: null } } },
    });
    await createProduct(client, 'coA', { name: 'P', price: 5, company_id: 'coB' });
    assert.equal(client.calls[0].payload.company_id, 'coA');
  });

  it('update nunca envia company_id', async () => {
    const updated = { id: 'p1', company_id: 'coA', name: 'P2', price: 6, active: true, options: [] };
    const client = createMockClient({
      tables: {
        products: {
          maybeSingle: { data: { company_id: 'coA' }, error: null },
          single: { data: updated, error: null },
        },
      },
    });
    await updateProduct(client, 'p1', { name: 'P2', company_id: 'coB' });
    assert.ok(!('company_id' in client.calls[0].payload));
  });

  it('excluir chama delete', async () => {
    const client = createMockClient();
    await deleteProduct(client, 'p1');
    assert.deepEqual(client.calls[0], { table: 'products', op: 'delete' });
  });

  it('assertCategoryOfCompany rejeita categoria inexistente', async () => {
    const client = createMockClient({ tables: { categories: { maybeSingle: { data: null, error: null } } } });
    await assert.rejects(() => assertCategoryOfCompany(client, 'coA', 'nope'), /não encontrada/);
  });
});
