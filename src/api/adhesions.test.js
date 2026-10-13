import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  fromSupabaseAdhesion, toSupabaseAdhesion, appendAdhesionEvent,
  listAdhesions, getAdhesion, createAdhesion, updateAdhesion,
} from './adhesions.js';

function createMockClient({ rows = {} } = {}) {
  const calls = [];
  const table = (name) => {
    const cfg = rows[name] || {};
    const chain = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: () => chain,
      insert: (p) => { calls.push({ table: name, op: 'insert', payload: p }); return chain; },
      update: (p) => { calls.push({ table: name, op: 'update', payload: p }); return chain; },
      single: async () => cfg.single || { data: null, error: null },
      maybeSingle: async () => cfg.maybeSingle || { data: null, error: null },
      then: (resolve) => { resolve(cfg.list || { data: [], error: null }); },
    };
    return chain;
  };
  return { calls, from: (name) => table(name) };
}

describe('adhesions — mapeamento', () => {
  it('from/to preservam comercial + provedor; eventos array', () => {
    const row = {
      id: 'a1', lead_id: 'l1', full_name: 'Joice', person_type: 'pf',
      plan_id: 'p1', plan_name: 'Completo', adhesion_fee: '100', monthly_fee: 49.9,
      status: 'ativa', provider: { razao_social: 'X' }, events: [{ action: 'criada' }],
    };
    const a = fromSupabaseAdhesion(row);
    assert.equal(a.adhesion_fee, 100);
    assert.equal(a.monthly_fee, 49.9);
    assert.equal(a.provider.razao_social, 'X');
    assert.equal(a.events.length, 1);
    assert.equal(fromSupabaseAdhesion({}).status, 'rascunho');
    const out = toSupabaseAdhesion({ full_name: '  Joice ', monthly_fee: '', due_day: '', payment_method: 'Pix' });
    assert.equal(out.full_name, 'Joice');
    assert.equal(out.monthly_fee, 0);
    assert.equal(out.due_day, null);
  });

  it('appendAdhesionEvent nunca edita anteriores', () => {
    const prev = [{ action: 'criada' }];
    const next = appendAdhesionEvent(prev, 'status', { de: 'rascunho', para: 'ativa' }, 'u1');
    assert.equal(prev.length, 1);
    assert.equal(next.length, 2);
    assert.equal(next[1].by, 'u1');
    assert.ok(next[1].at);
  });
});

describe('adhesions — CRUD valida antes da rede', () => {
  it('create valida e registra evento de criação', async () => {
    const client = createMockClient({
      rows: { commercial_adhesions: { single: { data: { id: 'a1', full_name: 'Joice' }, error: null } } },
    });
    await assert.rejects(createAdhesion(client, { monthly_fee: -1 }, 'u1'), /zero/);
    assert.equal(client.calls.length, 0);
    const a = await createAdhesion(client, { full_name: 'Joice', monthly_fee: 49.9 }, 'u1');
    assert.equal(a.id, 'a1');
    const ins = client.calls.find((c) => c.op === 'insert');
    assert.equal(ins.payload.events.length, 1);
    assert.equal(ins.payload.events[0].action, 'criada');
  });

  it('update exige id, valida e preserva eventos sem evento novo', async () => {
    const row = { id: 'a1', full_name: 'Joice', events: [{ action: 'criada' }] };
    const client = createMockClient({
      rows: { commercial_adhesions: { maybeSingle: { data: row, error: null }, single: { data: row, error: null } } },
    });
    await assert.rejects(updateAdhesion(client, '', { monthly_fee: 10 }, null, 'u1'), /identificada/);
    const upd = await updateAdhesion(client, 'a1', { monthly_fee: 59.9 }, { action: 'status', detail: 'ativa' }, 'u1');
    assert.equal(upd.id, 'a1');
    const u = client.calls.find((c) => c.op === 'update');
    assert.equal(u.payload.events.length, 2);
  });

  it('list/get chamam a tabela certa', async () => {
    const client = createMockClient({
      rows: { commercial_adhesions: { list: { data: [{ id: 'a1' }], error: null }, maybeSingle: { data: { id: 'a1' }, error: null } } },
    });
    assert.equal((await listAdhesions(client)).length, 1);
    assert.equal((await getAdhesion(client, 'a1')).id, 'a1');
    await assert.rejects(getAdhesion(client, ''), /identificada/);
  });
});
