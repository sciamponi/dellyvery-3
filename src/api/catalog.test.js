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
  DEFAULT_CATEGORIES,
  ensureDefaultCategories,
} from './catalog.js';

// Mock sem rede: terminais single()/maybeSingle() e await direto resolvem
// resultados configurados por tabela.
function createMockClient({ tables = {} } = {}) {
  const calls = [];
  const filters = [];
  const table = (name) => {
    const cfg = tables[name] || {};
    const chain = {
      select: () => chain,
      eq: (col, val) => {
        filters.push({ table: name, col, val });
        return chain;
      },
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
      upsert: (payload, opts) => {
        calls.push({ table: name, op: 'upsert', payload, opts });
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
  return { calls, filters, from: (name) => table(name) };
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
    assert.deepEqual(cats, [{ id: 'c1', company_id: 'co', name: 'A', description: undefined, icon: undefined, image_url: undefined, active: undefined, order: 1, slug: null }]);
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

  it('excluir chama delete com escopo da empresa', async () => {
    const client = createMockClient();
    await deleteCategory(client, 'coA', 'c1');
    assert.deepEqual(client.calls[0], { table: 'categories', op: 'delete' });
    assert.ok(client.filters.some((f) => f.table === 'categories' && f.col === 'company_id' && f.val === 'coA'));
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

  it('update com escopo da empresa e sem company_id no payload', async () => {
    const updated = { id: 'p1', company_id: 'coA', name: 'P2', price: 6, active: true, options: [] };
    const client = createMockClient({
      tables: {
        products: {
          maybeSingle: { data: { company_id: 'coA' }, error: null },
          single: { data: updated, error: null },
        },
      },
    });
    await updateProduct(client, 'coA', 'p1', { name: 'P2', company_id: 'coB' });
    assert.ok(!('company_id' in client.calls[0].payload));
    assert.ok(client.filters.some((f) => f.table === 'products' && f.col === 'company_id' && f.val === 'coA'));
  });

  it('excluir produto com escopo da empresa', async () => {
    const client = createMockClient();
    await deleteProduct(client, 'coA', 'p1');
    assert.deepEqual(client.calls[0], { table: 'products', op: 'delete' });
    assert.ok(client.filters.some((f) => f.col === 'company_id' && f.val === 'coA'));
  });

  it('assertCategoryOfCompany rejeita categoria inexistente', async () => {
    const client = createMockClient({ tables: { categories: { maybeSingle: { data: null, error: null } } } });
    await assert.rejects(() => assertCategoryOfCompany(client, 'coA', 'nope'), /não encontrada/);
  });
});

describe('catalog — categorias padrão por restaurante', () => {
  it('conjunto padrão: 6 categorias com slug estável, emoji e ordem', () => {
    assert.equal(DEFAULT_CATEGORIES.length, 6);
    assert.deepEqual(DEFAULT_CATEGORIES.map((c) => c.slug),
      ['lanches', 'acompanhamentos', 'sobremesas', 'bebidas', 'combos', 'extras']);
    assert.deepEqual(DEFAULT_CATEGORIES.map((c) => c.icon), ['🍔', '🍟', '🍦', '🍷', '📦', '➕']);
    assert.deepEqual(DEFAULT_CATEGORIES.map((c) => c.sort_order), [0, 1, 2, 3, 4, 5]);
  });

  it('slug mapeado na leitura e imutável no patch', () => {
    assert.equal(fromSupabaseCategory({ id: '1', slug: 'lanches' }).slug, 'lanches');
    assert.equal(fromSupabaseCategory({ id: '1' }).slug, null);
    assert.ok(!('slug' in toSupabaseCategory({ name: 'X', slug: 'outro' })));
  });

  it('restauração via upsert idempotente (sem duplicar, sem tocar personalizadas)', async () => {
    const client = createMockClient({
      tables: { categories: { list: { data: [], error: null } } },
    });
    await ensureDefaultCategories(client, 'co');
    const call = client.calls[0];
    assert.equal(call.table, 'categories');
    assert.equal(call.op, 'upsert');
    assert.deepEqual(call.opts, { onConflict: 'company_id,slug' });
    assert.equal(call.payload.length, 6);
    assert.ok(call.payload.every((r) => r.company_id === 'co' && r.active === true));
    await assert.rejects(() => ensureDefaultCategories(client, ''), /Empresa atual/);
  });
});

describe('catalog — herança de categoria e modo de dependência', () => {
  it('defaults: herda grupos da categoria; dependência OR', () => {
    const p = fromSupabaseProduct({ id: 'p', company_id: 'c', name: 'N', price: 1 });
    assert.equal(p.use_category_steps, true);
    assert.equal(p.dependency_mode, 'any');
    assert.equal(fromSupabaseProduct({ id: 'p', use_category_steps: false, dependency_mode: 'all' }).use_category_steps, false);
    assert.equal(fromSupabaseProduct({ id: 'p', dependency_mode: 'all' }).dependency_mode, 'all');
    assert.equal(fromSupabaseProduct({ id: 'p', dependency_mode: 'x' }).dependency_mode, 'any');
  });

  it('patch parcial só envia quando definido', () => {
    assert.deepEqual(toSupabaseProductPatch({ use_category_steps: false }), { use_category_steps: false });
    assert.deepEqual(toSupabaseProductPatch({ dependency_mode: 'all' }), { dependency_mode: 'all' });
    assert.deepEqual(toSupabaseProductPatch({ available: false }), { active: false });
  });
});

describe('catalog — indicador de combo (is_combo)', () => {
  it('mapeia is_combo false por default (produtos antigos preservados)', () => {
    const p = fromSupabaseProduct({ id: 'p', company_id: 'c', name: 'N', price: 1 });
    assert.equal(p.is_combo, false);
    const p2 = fromSupabaseProduct({ id: 'p', company_id: 'c', name: 'N', price: 1, is_combo: null });
    assert.equal(p2.is_combo, false);
  });

  it('mapeia is_combo true quando ativado', () => {
    const p = fromSupabaseProduct({ id: 'p', company_id: 'c', name: 'N', price: 1, is_combo: true });
    assert.equal(p.is_combo, true);
  });

  it('patch envia is_combo booleano quando definido e nao envia quando indefinido', () => {
    assert.deepEqual(toSupabaseProductPatch({ is_combo: true }), { is_combo: true });
    assert.deepEqual(toSupabaseProductPatch({ is_combo: false }), { is_combo: false });
    assert.ok(!('is_combo' in toSupabaseProductPatch({ name: 'X' })));
  });

  it('create força company_id do contexto e aceita is_combo no payload', async () => {
    const created = { id: 'p1', company_id: 'coA', name: 'P', price: 5, active: true, is_combo: true };
    const client = createMockClient({
      tables: {
        categories: { maybeSingle: { data: { id: 'cat1', company_id: 'coA' }, error: null } },
        products: { single: { data: created, error: null } },
      },
    });
    await createProduct(client, 'coA', { name: 'P', price: 5, category_id: 'cat1', is_combo: true });
    assert.equal(client.calls[0].payload.company_id, 'coA');
    assert.equal(client.calls[0].payload.is_combo, true);
  });
});
