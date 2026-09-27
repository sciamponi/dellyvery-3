import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  fromSupabaseOrder,
  fromSupabaseOrderItem,
  fromSupabaseHistory,
  listOrders,
  createOrder,
  changeOrderStatus,
  cancelOrder,
  editOrder,
  getOrderByToken,
  listNotifications,
  subscribeCompanyTable,
  __activeChannelCount,
  assignDriver,
} from './orders.js';

// Mock fiel ao supabase-js v2: channel() devolve a MESMA instância por tópico
// e o segundo .on('postgres_changes') lança (causa raiz do QA).
function createRealtimeMockClient() {
  const instances = new Map();
  const removed = [];
  return {
    removed,
    channel: (topic) => {
      if (!instances.has(topic)) {
        const inst = {
          onCount: 0,
          cb: null,
          on: (ev, filter, cb) => {
            inst.onCount++;
            if (inst.onCount > 1) {
              throw new Error("cannot add 'postgres_changes' callbacks for realtime channel");
            }
            inst.cb = cb;
            return inst;
          },
          subscribe: () => inst,
          __emit: (payload) => inst.cb?.(payload),
          __get: () => inst,
        };
        instances.set(topic, inst);
      }
      return instances.get(topic);
    },
    removeChannel: (ch) => {
      removed.push(ch);
      for (const [k, v] of instances) if (v === ch) instances.delete(k);
    },
  };
}

function createMockClient({ tables = {}, rpcs = {} } = {}) {
  const calls = { rpc: [] };
  const table = (name) => {
    const cfg = tables[name] || {};
    const chain = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: () => chain,
      insert: (p) => chain,
      update: (p) => chain,
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
      calls.rpc.push({ fn, args });
      return rpcs[fn] || { data: null, error: null };
    },
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
    removeChannel: () => {},
  };
}

describe('orders — mapeamento', () => {
  it('created_date/customer_* planos/items/history vazios', () => {
    const o = fromSupabaseOrder({
      id: '1', company_id: 'c', order_number: 3, status: 'novo', subtotal: '10.5',
      customer_data: { name: 'Zé', phone: '119' },
      delivery_address: { street: 'R', number: '1' },
      created_at: '2026-01-01',
    });
    assert.equal(o.created_date, '2026-01-01');
    assert.equal(o.customer_name, 'Zé');
    assert.equal(o.customer_address, 'R');
    assert.equal(o.customer_number, '1');
    assert.deepEqual(o.items, []);
    assert.deepEqual(o.status_history, []);
  });

  it('item: total->price, options->complements', () => {
    const i = fromSupabaseOrderItem({ id: 'i', product_name: 'X', quantity: 2, unit_price: '5', total: '10', options: [{ a: 1 }] });
    assert.equal(i.name, 'X');
    assert.equal(i.price, 10);
    assert.deepEqual(i.complements, [{ a: 1 }]);
  });

  it('history: new_status->status, created_at->timestamp', () => {
    const h = fromSupabaseHistory({ new_status: 'confirmado', old_status: 'novo', created_at: 't' });
    assert.equal(h.status, 'confirmado');
    assert.equal(h.timestamp, 't');
  });
});

describe('orders — escrita via RPC (nunca direta)', () => {
  it('createOrder chama RPC sem totais do frontend', async () => {
    const client = createMockClient({ rpcs: { create_order: { data: { order_id: 'o', order_number: 1, tracking_token: 't' }, error: null } } });
    const out = await createOrder(client, {
      companySlug: 'loja', orderType: 'mesa', tableNumber: '5',
      items: [{ product_id: 'p', quantity: 2, complements: [], notes: '' }],
      customer: { name: 'Z', phone: '119' }, paymentMethod: 'pix', notes: '',
    });
    assert.equal(out.order_number, 1);
    const args = client.calls.rpc[0].args;
    assert.equal(client.calls.rpc[0].fn, 'create_order');
    assert.ok(!('total' in args) && !('subtotal' in args) && !JSON.stringify(args).includes('unit_price'));
    assert.equal(args.p_table_number, '5');
  });

  it('changeOrderStatus/cancel/edit usam manage_order', async () => {
    const row = { id: 'o', company_id: 'c', status: 'confirmado', subtotal: 0, customer_data: {}, delivery_address: {}, created_at: '' };
    const client = createMockClient({ rpcs: { manage_order: { data: row, error: null } } });
    await changeOrderStatus(client, 'o', 'em_preparo');
    assert.deepEqual(client.calls.rpc[0], { fn: 'manage_order', args: { p_order_id: 'o', p_action: 'status', p_status: 'em_preparo' } });
    await cancelOrder(client, 'o', 'motivo');
    assert.equal(client.calls.rpc[1].args.p_action, 'cancel');
    await assert.rejects(() => cancelOrder(client, 'o', '  '), /Motivo/);
    await editOrder(client, 'o', { discount: 2 });
    assert.equal(client.calls.rpc[2].args.p_discount, 2);
  });

  it('getOrderByToken usa RPC (nunca SELECT anon)', async () => {
    const client = createMockClient({ rpcs: { get_order_by_token: { data: { order_number: 1 }, error: null } } });
    const out = await getOrderByToken(client, 'tok');
    assert.equal(out.order_number, 1);
    assert.equal(client.calls.rpc[0].fn, 'get_order_by_token');
    await assert.rejects(() => getOrderByToken(client, ''), /Token/);
  });

  it('tracking repassa product_id + image_url dos itens (sem quebrar contrato)', async () => {
    const item = {
      name: 'Açaí', quantity: 1, unit_price: 10, price: 10, notes: '',
      complements: [], product_id: 'p1', image_url: 'http://img/x.jpg',
    };
    const client = createMockClient({ rpcs: { get_order_by_token: { data: { order_number: 8, items: [item] }, error: null } } });
    const out = await getOrderByToken(client, 'tok');
    assert.equal(out.items[0].product_id, 'p1');
    assert.equal(out.items[0].image_url, 'http://img/x.jpg');
    assert.equal(out.items[0].name, 'Açaí');
    assert.equal(out.order_number, 8);
  });

  it('sem empresa falha antes da rede', async () => {
    const client = createMockClient();
    await assert.rejects(() => listOrders(client, null), /Empresa atual/);
  });

  it('notifications ganham title derivado + created_date', async () => {
    const client = createMockClient({
      tables: { notifications: { list: { data: [{ id: 'n', status: 'novo', order_number: 4, created_at: 't' }], error: null } } },
    });
    const list = await listNotifications(client, 'c');
    assert.equal(list[0].title, 'Novo pedido #4');
    assert.equal(list[0].created_date, 't');
  });
});

describe('orders — realtime idempotente (QA duplicação)', () => {
  it('dois mounts no mesmo tópico não lançam e ambos recebem', () => {
    const client = createRealtimeMockClient();
    const got1 = [];
    const got2 = [];
    const unsub1 = subscribeCompanyTable(client, 'notifications', 'c1', (e) => got1.push(e));
    const unsub2 = subscribeCompanyTable(client, 'notifications', 'c1', (e) => got2.push(e));
    assert.equal(__activeChannelCount(), 1);
    client.channel('dellyvery3-notifications-c1').__emit({ eventType: 'INSERT', new: { id: 'n1' } });
    assert.equal(got1.length, 1);
    assert.equal(got2.length, 1);
    assert.equal(got1[0].type, 'create');
    unsub1();
    unsub2();
    assert.equal(__activeChannelCount(), 0);
    assert.equal(client.removed.length, 1);
  });

  it('cleanup parcial mantém o outro listener; trocar empresa isola', () => {
    const client = createRealtimeMockClient();
    const got1 = [];
    const got2 = [];
    const unsub1 = subscribeCompanyTable(client, 'orders', 'c1', (e) => got1.push(e));
    const unsub2 = subscribeCompanyTable(client, 'orders', 'c2', (e) => got2.push(e));
    assert.equal(__activeChannelCount(), 2);
    unsub1();
    assert.equal(__activeChannelCount(), 1);
    assert.equal(client.removed.length, 1);
    client.channel('dellyvery3-orders-c2').__emit({ eventType: 'INSERT', new: { id: 'y' } });
    assert.equal(got1.length, 0);
    assert.equal(got2.length, 1);
    unsub2();
    assert.equal(__activeChannelCount(), 0);
  });

  it('normaliza INSERT/UPDATE/DELETE para create/update/delete', () => {
    const client = createRealtimeMockClient();
    const got = [];
    const unsub = subscribeCompanyTable(client, 'orders', 'c1', (e) => got.push(e));
    client.channel('dellyvery3-orders-c1').__emit({ eventType: 'INSERT', new: { id: 'a' } });
    client.channel('dellyvery3-orders-c1').__emit({ eventType: 'UPDATE', new: { id: 'a' } });
    client.channel('dellyvery3-orders-c1').__emit({ eventType: 'DELETE', old: { id: 'a' } });
    assert.deepEqual(got.map((e) => e.type), ['create', 'update', 'delete']);
    assert.equal(got[2].id, 'a');
    unsub();
  });

  it('remount após cleanup total funciona', () => {
    const client = createRealtimeMockClient();
    const unsub = subscribeCompanyTable(client, 'orders', 'c9', () => {});
    unsub();
    assert.equal(__activeChannelCount(), 0);
    const got = [];
    const unsub2 = subscribeCompanyTable(client, 'orders', 'c9', (e) => got.push(e));
    client.channel('dellyvery3-orders-c9').__emit({ eventType: 'UPDATE', new: { id: 'z' } });
    assert.equal(got.length, 1);
    unsub2();
  });

  it('cleanup duplo não remove duas vezes', () => {
    const client = createRealtimeMockClient();
    const unsub = subscribeCompanyTable(client, 'orders', 'c1', () => {});
    unsub();
    unsub();
    assert.equal(client.removed.length, 1);
  });
});

describe('orders — assignDriver (5.5-B3)', () => {
  const order = { id: 'o1', company_id: 'c1', status: 'saiu_entrega' };
  const drv = { id: 'd1', company_id: 'c1', status: 'ativo', name: 'João' };
  function assignMock({ orderRow = order, drvRow = drv } = {}) {
    const calls = [];
    const table = (name) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: () => chain,
        insert: (p) => {
          calls.push({ table: name, op: 'insert', payload: p });
          return chain;
        },
        update: (p) => {
          calls.push({ table: name, op: 'update', payload: p });
          return chain;
        },
        delete: () => chain,
        single: async () => ({ data: null, error: null }),
        maybeSingle: async () => ({ data: name === 'orders' ? orderRow : drvRow, error: null }),
        then: (resolve) => resolve({ data: [], error: null }),
      };
      return chain;
    };
    return {
      calls,
      from: (name) => table(name),
      auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } }, error: null }) },
    };
  }

  it('atribui com validações + history/audit, sem notification', async () => {
    const client = assignMock();
    assert.equal(await assignDriver(client, 'o1', 'c1', 'd1'), true);
    const upd = client.calls.find((c) => c.table === 'orders');
    assert.deepEqual(upd.payload, { driver_id: 'd1' });
    const hist = client.calls.find((c) => c.table === 'order_status_history');
    assert.equal(hist.payload.old_status, 'saiu_entrega');
    assert.equal(hist.payload.new_status, 'saiu_entrega');
    const audit = client.calls.find((c) => c.table === 'audit_logs');
    assert.equal(audit.payload.action, 'assign_driver');
    assert.ok(!client.calls.some((c) => c.table === 'notifications'));
  });

  it('remove com driverId nulo', async () => {
    const client = assignMock();
    await assignDriver(client, 'o1', 'c1', null);
    assert.deepEqual(client.calls.find((c) => c.table === 'orders').payload, { driver_id: null });
  });

  it('rejeita terminal, cross-company e inativo', async () => {
    const term = assignMock({ orderRow: { ...order, status: 'finalizado' } });
    await assert.rejects(() => assignDriver(term, 'o1', 'c1', 'd1'), /terminal|finalizado/);
    const cross = assignMock({ drvRow: { ...drv, company_id: 'OUTRA' } });
    await assert.rejects(() => assignDriver(cross, 'o1', 'c1', 'd1'), /outra empresa/);
    const inat = assignMock({ drvRow: { ...drv, status: 'inativo' } });
    await assert.rejects(() => assignDriver(inat, 'o1', 'c1', 'd1'), /inativo/);
  });

  it('pedido de outra empresa não é encontrado', async () => {
    const client = assignMock({ orderRow: null });
    await assert.rejects(() => assignDriver(client, 'o1', 'c1', 'd1'), /sem permissão/);
  });
});
