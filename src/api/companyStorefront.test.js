import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  toSupabaseCompanyPatch,
  updateCompany,
  updateCompanySettings,
  updateStoreTheme,
} from './company.js';
import { getStorefrontBySlug } from './storefront.js';

function createMockClient({ tables = {}, rpcs = {} } = {}) {
  const calls = [];
  const table = (name) => {
    const cfg = tables[name] || {};
    const chain = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: () => chain,
      insert: (p) => chain,
      update: (payload) => {
        calls.push({ table: name, op: 'update', payload });
        return chain;
      },
      upsert: (payload) => {
        calls.push({ table: name, op: 'upsert', payload });
        return chain;
      },
      delete: () => chain,
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
  return {
    calls,
    from: (name) => table(name),
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      return rpcs[fn] || { data: null, error: null };
    },
  };
}

describe('company — patch parcial (sem company_id; slug editável)', () => {
  it('mapeia só chaves presentes', () => {
    const patch = toSupabaseCompanyPatch({ name: 'N', is_open: false, company_id: 'x', slug: 'y' });
    assert.deepEqual(patch, { name: 'N', is_open: false, slug: 'y' });
  });

  it('updateCompany nunca envia company_id', async () => {
    const client = createMockClient({ tables: { companies: { single: { data: { id: 'c' }, error: null } } } });
    await updateCompany(client, 'c', { name: 'N', company_id: 'OUTRA' });
    assert.ok(!('company_id' in client.calls[0].payload));
  });

  it('settings/themes via upsert por company_id', async () => {
    const client = createMockClient({
      tables: {
        company_settings: { single: { data: {}, error: null } },
        store_themes: { single: { data: {}, error: null } },
      },
    });
    await updateCompanySettings(client, 'c', { x: 1 });
    await updateStoreTheme(client, 'c', { colors: {} });
    assert.deepEqual(client.calls[0], { table: 'company_settings', op: 'upsert', payload: { company_id: 'c', settings: { x: 1 } } });
    assert.equal(client.calls[1].payload.company_id, 'c');
  });

  it('sem empresa falha antes da rede', async () => {
    const client = createMockClient();
    await assert.rejects(() => updateCompany(client, null, { name: 'N' }), /Empresa atual/);
    assert.equal(client.calls.length, 0);
  });
});

describe('storefront — adapter', () => {
  it('chama somente a RPC', async () => {
    const payload = { company: { slug: 'l' }, categories: [], products: [], delivery_zones: [], theme: {} };
    const client = createMockClient({ rpcs: { get_storefront_by_slug: { data: payload, error: null } } });
    const out = await getStorefrontBySlug(client, 'l');
    assert.deepEqual(out, payload);
    assert.equal(client.calls.length, 1);
    assert.equal(client.calls[0].fn, 'get_storefront_by_slug');
  });

  it('slug inexistente vira NOT_FOUND', async () => {
    const client = createMockClient({
      rpcs: { get_storefront_by_slug: { data: null, error: new Error('Loja não encontrada') } },
    });
    await assert.rejects(() => getStorefrontBySlug(client, 'nope'), /Loja não encontrada/);
  });

  it('sem slug falha antes da rede', async () => {
    const client = createMockClient();
    await assert.rejects(() => getStorefrontBySlug(client, ''), /Loja não encontrada/);
    assert.equal(client.calls.length, 0);
  });
});
