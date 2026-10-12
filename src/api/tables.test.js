import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  toSupabaseTablePatch, listTables, createTable, updateTable, setTableActive,
  resolveTableToken, deleteTable, getTableBlockers,
} from './tables.js';

function createMockClient({ list = [], single = null, updated = null } = {}) {
  const calls = { insert: [], update: [] };
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    insert: (p) => { calls.insert.push(p); return chain; },
    update: (p) => { calls.update.push(p); return chain; },
    single: async () => ({ data: single, error: null }),
    maybeSingle: async () => ({ data: updated, error: null }),
    then: (resolve) => resolve({ data: list, error: null }),
  };
  return { calls, from: () => chain };
}

describe('tables — patch e leitura', () => {
  it('patch parcial só chaves presentes, sem company_id', () => {
    assert.deepEqual(
      toSupabaseTablePatch({ name: ' Janela ', code: '', company_id: 'OUTRA' }),
      { name: 'Janela', code: null },
    );
  });

  it('listar filtra por empresa (falha antes da rede sem ela)', async () => {
    const client = createMockClient({ list: [{ id: 't1' }] });
    assert.equal((await listTables(client, 'c1')).length, 1);
    await assert.rejects(() => listTables(client, ''), /Empresa/);
  });
});

describe('tables — escrita com guardas', () => {
  it('criar exige nome e força company_id do contexto', async () => {
    const client = createMockClient({ single: { id: 't1' } });
    await createTable(client, 'c1', { name: 'Mesa 1' });
    assert.equal(client.calls.insert[0].company_id, 'c1');
    assert.equal(client.calls.insert[0].name, 'Mesa 1');
    await assert.rejects(() => createTable(client, 'c1', { name: '  ' }), /obrigatório/);
  });

  it('atualizar nunca envia company_id e trava sem retorno', async () => {
    const client = createMockClient({ updated: { id: 't1', name: 'X' } });
    await updateTable(client, 'c1', 't1', { name: 'X', company_id: 'OUTRA' });
    assert.ok(!('company_id' in client.calls.update[0]));
    await assert.rejects(() => updateTable(client, 'c1', '', { name: 'X' }), /identificada/);
    const empty = createMockClient({ updated: null });
    await assert.rejects(() => updateTable(empty, 'c1', 't1', { name: 'X' }), /permissão/);
  });

  it('ativar/desativar delega com booleano', async () => {
    const client = createMockClient({ updated: { id: 't1', active: false } });
    await setTableActive(client, 'c1', 't1', false);
    assert.equal(client.calls.update[0].active, false);
  });
});

describe('tables — token, exclusão e bloqueios', () => {
  function rpcMock({ rpcData = null, list = [] } = {}) {
    const calls = { rpc: [] };
    const chain = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: () => chain,
      then: (resolve) => resolve({ data: list, error: null }),
    };
    return {
      calls,
      from: () => chain,
      rpc: async (fn, args) => {
        calls.rpc.push({ fn, args });
        return { data: rpcData, error: null };
      },
    };
  }

  it('resolveTableToken usa RPC sem expor IDs', async () => {
    const client = rpcMock({ rpcData: { company_slug: 'loja', table_name: 'Janela' } });
    const out = await resolveTableToken(client, 'abc123def456');
    assert.equal(out.table_name, 'Janela');
    assert.equal(client.calls.rpc[0].fn, 'resolve_table_token');
    await assert.rejects(() => resolveTableToken(client, '  '), /identificada/);
  });

  it('deleteTable exige ids e usa RPC atômica', async () => {
    const client = rpcMock({ rpcData: { deleted: true } });
    assert.deepEqual(await deleteTable(client, 'c1', 't1'), { deleted: true });
    assert.deepEqual(client.calls.rpc[0], { fn: 'delete_table_if_unused', args: { p_table_id: 't1' } });
    await assert.rejects(() => deleteTable(client, 'c1', ''), /identificada/);
    await assert.rejects(() => deleteTable(client, '', 't1'), /Empresa/);
  });

  it('getTableBlockers lista referências escopadas', async () => {
    const client = rpcMock({ list: [{ id: 'o1', order_number: 5, status: 'novo' }] });
    const rows = await getTableBlockers(client, 'c1', 't1');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].order_number, 5);
  });

  it('patch nunca envia public_token (estável)', () => {
    assert.deepEqual(toSupabaseTablePatch({ name: 'X', public_token: 'novo' }), { name: 'X' });
  });
});
