import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  listMembers,
  updateMemberRole,
  deactivateMember,
  toSupabaseDriverPatch,
  listDrivers,
  createDriver,
  updateDriver,
  deactivateDriver,
  TEAM_ROLE_LABELS,
} from './team.js';

function createMockClient({ tables = {}, rpcs = {} } = {}) {
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
      return rpcs[fn] || { data: [], error: null };
    },
  };
}

describe('team — funcionários', () => {
  it('listMembers usa RPC com company_id do contexto', async () => {
    const rows = [{ id: 'm1', role: 'OWNER', active: true, name: 'A' }];
    const client = createMockClient({ rpcs: { list_team: { data: rows, error: null } } });
    assert.deepEqual(await listMembers(client, 'c1'), rows);
    assert.deepEqual(client.calls[0], { fn: 'list_team', args: { p_company_id: 'c1' } });
  });

  it('updateMemberRole valida role e nunca envia company_id', async () => {
    const client = createMockClient({ tables: { company_members: { single: { data: { id: 'm1', role: 'ADMIN' }, error: null } } } });
    await updateMemberRole(client, 'm1', 'ADMIN');
    assert.deepEqual(client.calls[0].payload, { role: 'ADMIN' });
    await assert.rejects(() => updateMemberRole(client, 'm1', 'SUPER'), /Função inválida/);
  });

  it('deactivateMember alterna active', async () => {
    const client = createMockClient({ tables: { company_members: { single: { data: {}, error: null } } } });
    await deactivateMember(client, 'm1', false);
    assert.deepEqual(client.calls[0].payload, { active: false });
  });

  it('labels amigáveis sem ROLE_LABELS legado', () => {
    assert.equal(TEAM_ROLE_LABELS.OWNER, 'Proprietário');
    assert.equal(TEAM_ROLE_LABELS.ATTENDANT, 'Atendente');
  });

  it('sem empresa falha antes da rede', async () => {
    const client = createMockClient();
    await assert.rejects(() => listMembers(client, null), /Empresa atual/);
    assert.equal(client.calls.length, 0);
  });
});

describe('team — entregadores', () => {
  it('patch parcial só chaves presentes', () => {
    assert.deepEqual(toSupabaseDriverPatch({ status: 'inativo' }), { status: 'inativo' });
  });

  it('criar exige nome e força company_id', async () => {
    const client = createMockClient({ tables: { delivery_drivers: { single: { data: { id: 'd1' }, error: null } } } });
    await createDriver(client, 'c1', { name: 'João', company_id: 'OUTRA' });
    assert.equal(client.calls[0].payload.company_id, 'c1');
    assert.equal(client.calls[0].payload.status, 'ativo');
    await assert.rejects(() => createDriver(client, 'c1', { name: ' ' }), /Nome é obrigatório/);
  });

  it('deactivateDriver alterna status', async () => {
    const client = createMockClient({ tables: { delivery_drivers: { single: { data: {}, error: null } } } });
    await deactivateDriver(client, 'd1', false);
    assert.deepEqual(client.calls[0].payload, { status: 'inativo' });
  });

  it('sem empresa falha antes da rede', async () => {
    const client = createMockClient();
    await assert.rejects(() => listDrivers(client, undefined), /Empresa atual/);
    assert.equal(client.calls.length, 0);
  });
});
