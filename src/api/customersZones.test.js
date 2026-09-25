import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  fromSupabaseCustomer,
  toSupabaseCustomer,
  toSupabaseCustomerPatch,
  listCustomers,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  isDuplicateCustomer,
  onlyDigits,
} from './customers.js';
import {
  fromSupabaseZone,
  listZones,
  createZone,
  deleteZone,
} from './deliveryZones.js';

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

describe('customers — mapeamento', () => {
  it('endereço jsonb <-> campos planos', () => {
    const row = {
      id: '1', company_id: 'c', name: 'N', whatsapp: '119', phone: '', email: '',
      address: { street: 'Rua A', number: '10', complement: 's1', neighborhood: 'B', city: 'C', zip_code: '1' },
      notes: '', tags: ['vip'], is_favorite: true, is_blocked: false,
    };
    const c = fromSupabaseCustomer(row);
    assert.equal(c.address, 'Rua A');
    assert.equal(c.number, '10');
    assert.equal(c.city, 'C');
    assert.deepEqual(c.tags, ['vip']);
    const sb = toSupabaseCustomer('c', { name: 'N', address: 'Rua A', number: '10', city: 'C' });
    assert.equal(sb.company_id, 'c');
    assert.deepEqual(sb.address, { street: 'Rua A', number: '10', complement: '', neighborhood: '', city: 'C', zip_code: '' });
  });

  it('update parcial preserva número/complemento via prevAddress', () => {
    const patch = toSupabaseCustomerPatch({ city: 'C2', __prevAddress: { street: 'R', number: '5', complement: 's1', neighborhood: '', city: '', zip_code: '' } });
    assert.ok(!('company_id' in patch));
    assert.equal(patch.address.number, '5');
    assert.equal(patch.address.complement, 's1');
    assert.equal(patch.address.city, 'C2');
    const nameOnly = toSupabaseCustomerPatch({ name: 'N2' });
    assert.ok(!('address' in nameOnly));
  });
});

describe('customers — CRUD', () => {
  it('criar exige nome e força company_id do contexto', async () => {
    const created = { id: '1', company_id: 'co', name: 'A', address: {}, tags: [] };
    const client = createMockClient({ tables: { customers: { single: { data: created, error: null } } } });
    await createCustomer(client, 'co', { name: 'A', company_id: 'OUTRA', whatsapp: '119' });
    assert.equal(client.calls[0].payload.company_id, 'co');
    await assert.rejects(() => createCustomer(client, 'co', { name: ' ' }), /Nome é obrigatório/);
  });

  it('sem empresa falha antes da rede', async () => {
    const client = createMockClient();
    await assert.rejects(() => listCustomers(client, null), /Empresa atual/);
    assert.equal(client.calls.length, 0);
  });

  it('excluir chama delete', async () => {
    const client = createMockClient();
    await deleteCustomer(client, '1');
    assert.deepEqual(client.calls[0], { table: 'customers', op: 'delete' });
  });
});

describe('customers — dedupe importação', () => {
  const existing = [{ whatsapp: '(11) 99999-9999', phone: '', email: '' }];
  it('detecta duplicado por whatsapp/phone/email', () => {
    assert.equal(isDuplicateCustomer(existing, { whatsapp: '11999999999' }), true);
    assert.equal(isDuplicateCustomer(existing, { phone: '11988888888' }), false);
    assert.equal(onlyDigits('(11) 9-9999'), '1199999');
  });
});

describe('zones — CRUD', () => {
  it('mapeia fee numérico', () => {
    assert.equal(fromSupabaseZone({ id: 'z', fee: '7.50', estimated_time: 30 }).fee, 7.5);
  });

  it('criar exige nome e força company_id', async () => {
    const created = { id: 'z', company_id: 'co', name: 'Centro', fee: 5, estimated_time: 30 };
    const client = createMockClient({ tables: { delivery_zones: { single: { data: created, error: null } } } });
    await createZone(client, 'co', { name: 'Centro', fee: '5' });
    assert.equal(client.calls[0].payload.company_id, 'co');
    assert.equal(client.calls[0].payload.fee, 5);
    await assert.rejects(() => createZone(client, 'co', { name: '' }), /Nome é obrigatório/);
  });

  it('sem empresa falha antes da rede', async () => {
    const client = createMockClient();
    await assert.rejects(() => listZones(client, undefined), /Empresa atual/);
    assert.equal(client.calls.length, 0);
  });

  it('excluir chama delete', async () => {
    const client = createMockClient();
    await deleteZone(client, 'z');
    assert.deepEqual(client.calls[0], { table: 'delivery_zones', op: 'delete' });
  });
});
