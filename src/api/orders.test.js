import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  fromSupabaseOrder,
  fromSupabaseOrderItem,
  fromSupabaseHistory,
  listOrders,
  createOrder,
  buildCreateOrderItems,
  countCustomerOrders,
  countPriorOrders,
  changeOrderStatus,
  cancelOrder,
  editOrder,
  getOrderByToken,
  listNotifications,
  subscribeCompanyTable,
  __activeChannelCount,
  assignDriver,
  isRestaurantClosedError,
  linkOrderCustomer,
  linkOrderTable,
  setComandaName,
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
      neq: () => chain,
      in: () => chain,
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

  it('createOrder envia p_table_id quando há mesa vinculada', async () => {
    const client = createMockClient({ rpcs: { create_order: { data: { order_id: 'o' }, error: null } } });
    await createOrder(client, {
      companySlug: 'loja', orderType: 'mesa', tableNumber: 'Janela', tableId: 't1',
      items: [{ product_id: 'p', quantity: 1 }], customer: {},
    });
    assert.equal(client.calls.rpc[0].args.p_table_id, 't1');
    const c2 = createMockClient({ rpcs: { create_order: { data: { order_id: 'o' }, error: null } } });
    await createOrder(c2, {
      companySlug: 'loja', orderType: 'retirada',
      items: [{ product_id: 'p', quantity: 1 }], customer: {},
    });
    assert.equal(c2.calls.rpc[0].args.p_table_id, null);
  });

  it('createOrder repassa troco (p_change_for) e mapeia change_for', async () => {
    const client = createMockClient({ rpcs: { create_order: { data: { order_id: 'o', order_number: 2, tracking_token: 't' }, error: null } } });
    await createOrder(client, {
      companySlug: 'loja', orderType: 'delivery',
      items: [{ product_id: 'p', quantity: 1 }],
      customer: { name: 'Z', phone: '119' }, paymentMethod: 'dinheiro', changeFor: 50,
    });
    assert.equal(client.calls.rpc[0].args.p_change_for, 50);
    const row = {
      id: 'o', company_id: 'c', status: 'novo', subtotal: 20, total: 20,
      change_for: 50, customer_data: {}, delivery_address: {}, created_at: '',
    };
    assert.equal(fromSupabaseOrder(row).change_for, 50);
    assert.equal(fromSupabaseOrder({ ...row, change_for: null }).change_for, null);
    // Sem troco: parâmetro vai nulo (RPC antiga continua válida).
    const c2 = createMockClient({ rpcs: { create_order: { data: { order_id: 'o' }, error: null } } });
    await createOrder(c2, { companySlug: 'loja', items: [{ product_id: 'p', quantity: 1 }], customer: { name: 'Z', phone: '119' } });
    assert.equal(c2.calls.rpc[0].args.p_change_for, null);
  });

  it('buildCreateOrderItems preserva todas as linhas (jornada completa)', () => {    const cart = [
      { product_id: 'lanche', quantity: 1, complements: [{ group_name: 'G', option_name: 'O', price: 2, quantity: 1 }], notes: 'sem cebola' },
      { product_id: 'fritas', quantity: 2 },
      { product_id: 'coca', quantity: 1, notes: '' },
      { product_id: 'pudim', quantity: 3, complements: [] },
    ];
    assert.deepEqual(buildCreateOrderItems(cart), [
      { product_id: 'lanche', quantity: 1, complements: [{ group_name: 'G', option_name: 'O', price: 2, quantity: 1 }], notes: 'sem cebola' },
      { product_id: 'fritas', quantity: 2, complements: [], notes: '' },
      { product_id: 'coca', quantity: 1, complements: [], notes: '' },
      { product_id: 'pudim', quantity: 3, complements: [], notes: '' },
    ]);
    assert.deepEqual(buildCreateOrderItems(null), []);
  });

  it('buildCreateOrderItems leva config V2 sanitizada (sem ela, legado)', () => {
    const v2 = { steps: [{ step_id: 's1', items: [{ option_id: 'o1', quantity: 1 }, { option_id: '', quantity: 2 }] }] };
    const out = buildCreateOrderItems([
      { product_id: 'acai', quantity: 1, complements: [{ group_name: 'T', option_name: 'M', price: 2, quantity: 1 }], notes: '', config: v2 },
      { product_id: 'fritas', quantity: 2 },
    ]);
    assert.deepEqual(out[0].config, { steps: [{ step_id: 's1', items: [{ option_id: 'o1', quantity: 1 }] }] });
    assert.equal('config' in out[1], false);
    // Vazias/malformadas não viajam.
    assert.equal('config' in buildCreateOrderItems([{ product_id: 'p', quantity: 1, config: { steps: [] } }])[0], false);
    assert.equal('config' in buildCreateOrderItems([{ product_id: 'p', quantity: 1, config: { steps: [{ step_id: '', items: [] }] } }])[0], false);
  });

  it('countCustomerOrders conta anteriores (sem cancelados, sem o atual)', async () => {
    const calls = [];
    const chain = {
      select: () => chain,
      eq: (k, v) => { calls.push(['eq', k, v]); return chain; },
      neq: (k, v) => { calls.push(['neq', k, v]); return chain; },
      then: (resolve) => resolve({ count: 2, error: null }),
    };
    const client = { from: () => chain };
    assert.equal(await countCustomerOrders(client, 'c1', 'k1', 'o9'), 2);
    assert.ok(calls.some(([op, k, v]) => op === 'eq' && k === 'company_id' && v === 'c1'));
    assert.ok(calls.some(([op, k, v]) => op === 'eq' && k === 'customer_id' && v === 'k1'));
    assert.ok(calls.some(([op, k, v]) => op === 'neq' && k === 'status' && v === 'cancelado'));
    assert.ok(calls.some(([op, k, v]) => op === 'neq' && k === 'id' && v === 'o9'));
    assert.equal(await countCustomerOrders(client, 'c1', null), 0);
    await assert.rejects(() => countCustomerOrders(client, '', 'k1'), /Empresa/);
  });

  it('countPriorOrders: 1 consulta em lote por empresa/clientes', async () => {
    const calls = [];
    const rows = [
      { id: 'a', customer_id: 'k1' },
      { id: 'b', customer_id: 'k1' },
      { id: 'c', customer_id: 'k2' },
    ];
    const chain = {
      select: () => chain,
      eq: (k, v) => { calls.push(['eq', k, v]); return chain; },
      in: (k, v) => { calls.push(['in', k, v]); return chain; },
      neq: (k, v) => { calls.push(['neq', k, v]); return chain; },
      then: (resolve) => resolve({ data: rows, error: null }),
    };
    const client = { from: () => chain };
    const m = await countPriorOrders(client, 'c1', ['k1', 'k2', 'k1', null]);
    assert.equal(m.get('k1'), 2);
    assert.equal(m.get('k2'), 1);
    assert.ok(calls.some(([op, k, v]) => op === 'eq' && k === 'company_id' && v === 'c1'));
    assert.ok(calls.some(([op, k]) => op === 'in' && k === 'customer_id'));
    assert.ok(calls.some(([op, k, v]) => op === 'neq' && k === 'status' && v === 'cancelado'));
    assert.deepEqual(await countPriorOrders(client, 'c1', []), new Map());
    await assert.rejects(() => countPriorOrders(client, '', ['k1']), /Empresa/);
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

  it('editOrder leva config V2 dos itens (comanda PDV)', async () => {
    const row = { id: 'o', company_id: 'c', status: 'confirmado', subtotal: 0, customer_data: {}, delivery_address: {}, created_at: '' };
    const client = createMockClient({ rpcs: { manage_order: { data: row, error: null } } });
    const cfg = { steps: [{ step_id: 's1', items: [{ option_id: 'o1', quantity: 1 }] }] };
    await editOrder(client, 'o', { items: [{ product_id: 'p', quantity: 1, complements: [], notes: '', config: cfg }] });
    assert.deepEqual(client.calls.rpc[0].args.p_items, [
      { product_id: 'p', quantity: 1, complements: [], notes: '', config: cfg },
    ]);
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

describe('orders — assignDriver (5.5-B3)', () => {  const order = { id: 'o1', company_id: 'c1', status: 'saiu_entrega' };
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

describe('orders — vincular cliente/mesa (balcão)', () => {
  const order = { id: 'o1', company_id: 'c1', status: 'novo', order_type: 'retirada' };
  const cust = { id: 'k1', company_id: 'c1', name: 'Maria', phone: '119', email: '' };
  const table = { id: 't1', company_id: 'c1', name: '7', active: true };
  function linkMock({ orderRow = order, refRow = cust, refTable = 'customers' } = {}) {
    const calls = [];
    const tableFn = (name) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: () => chain,
        insert: (p) => { calls.push({ table: name, op: 'insert', payload: p }); return chain; },
        update: (p) => { calls.push({ table: name, op: 'update', payload: p }); return chain; },
        delete: () => chain,
        single: async () => ({ data: null, error: null }),
        maybeSingle: async () => ({
          data: name === 'orders' ? orderRow : (name === refTable ? refRow : null),
          error: null,
        }),
        then: (resolve) => resolve({ data: [], error: null }),
      };
      return chain;
    };
    return {
      calls,
      from: (name) => tableFn(name),
      auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } }, error: null }) },
    };
  }

  it('vincula cliente com snapshot + history/audit, sem recriar', async () => {
    const client = linkMock();
    assert.equal(await linkOrderCustomer(client, 'o1', 'c1', 'k1'), true);
    const upd = client.calls.find((c) => c.table === 'orders');
    assert.equal(upd.payload.customer_id, 'k1');
    assert.deepEqual(upd.payload.customer_data, { name: 'Maria', phone: '119', email: '' });
    assert.ok(!('order_number' in upd.payload) && !('items' in upd.payload));
    const hist = client.calls.find((c) => c.table === 'order_status_history');
    assert.equal(hist.payload.new_status, 'novo');
    const audit = client.calls.find((c) => c.table === 'audit_logs');
    assert.equal(audit.payload.action, 'link_customer');
    assert.ok(!client.calls.some((c) => c.table === 'notifications'));
  });

  it('rejeita cliente de outra empresa, pedido terminal e sem id', async () => {
    const cross = linkMock({ refRow: { ...cust, company_id: 'OUTRA' } });
    await assert.rejects(() => linkOrderCustomer(cross, 'o1', 'c1', 'k1'), /outra empresa/);
    const term = linkMock({ orderRow: { ...order, status: 'cancelado' } });
    await assert.rejects(() => linkOrderCustomer(term, 'o1', 'c1', 'k1'), /finalizado\/cancelado/);
    await assert.rejects(() => linkOrderCustomer(linkMock(), 'o1', 'c1', ''), /identificado/);
    await assert.rejects(() => linkOrderCustomer(linkMock(), 'o1', '', 'k1'), /Empresa/);
  });

  it('vincula mesa válida em pedido de mesa', async () => {
    const mesaOrder = { ...order, order_type: 'mesa' };
    const client = linkMock({ orderRow: mesaOrder, refRow: table, refTable: 'dining_tables' });
    assert.equal(await linkOrderTable(client, 'o1', 'c1', 't1'), true);
    const upd = client.calls.find((c) => c.table === 'orders');
    assert.deepEqual(upd.payload, { table_id: 't1', table_number: '7' });
    const audit = client.calls.find((c) => c.table === 'audit_logs');
    assert.equal(audit.payload.action, 'link_table');
  });

  it('rejeita mesa de outra empresa, inativa e em pedido não-mesa', async () => {
    const mesaOrder = { ...order, order_type: 'mesa' };
    const cross = linkMock({ orderRow: mesaOrder, refRow: { ...table, company_id: 'OUTRA' }, refTable: 'dining_tables' });
    await assert.rejects(() => linkOrderTable(cross, 'o1', 'c1', 't1'), /outra empresa/);
    const inat = linkMock({ orderRow: mesaOrder, refRow: { ...table, active: false }, refTable: 'dining_tables' });
    await assert.rejects(() => linkOrderTable(inat, 'o1', 'c1', 't1'), /inativa/);
    const deliv = linkMock({ orderRow: { ...order, order_type: 'delivery' }, refRow: table, refTable: 'dining_tables' });
    await assert.rejects(() => linkOrderTable(deliv, 'o1', 'c1', 't1'), /Somente pedidos de mesa/);
  });
});

describe('orders — FASE 2 aberto/fechado (source + erro de fechado)', () => {
  const base = {
    companySlug: 'loja',
    orderType: 'retirada',
    items: [{ product_id: 'p', quantity: 1, complements: [], notes: '' }],
    customer: { name: 'Z', phone: '119' },
  };

  it('createOrder envia p_source online por padrão', async () => {
    const client = createMockClient({ rpcs: { create_order: { data: { order_id: 'o' }, error: null } } });
    await createOrder(client, base);
    assert.equal(client.calls.rpc[0].args.p_source, 'online');
  });

  it('PDV envia p_source balcao (nunca bloqueado por is_open)', async () => {
    const client = createMockClient({ rpcs: { create_order: { data: { order_id: 'o' }, error: null } } });
    await createOrder(client, { ...base, source: 'balcao' });
    assert.equal(client.calls.rpc[0].args.p_source, 'balcao');
  });

  it('isRestaurantClosedError detecta o erro controlado da RPC', async () => {
    assert.equal(isRestaurantClosedError(new Error('Estamos fechados no momento e não estamos recebendo pedidos online.')), true);
    assert.equal(isRestaurantClosedError({ message: 'Estabelecimento fechado no momento' }), true);
    assert.equal(isRestaurantClosedError(new Error('Produto indisponível: X')), false);
    assert.equal(isRestaurantClosedError(new Error('Seu carrinho está vazio')), false);
    assert.equal(isRestaurantClosedError(null), false);
    assert.equal(isRestaurantClosedError('RESTAURANTE FECHADO'), true);
  });
});

describe('orders - setComandaName (sem criar cliente)', () => {
  function comandaMock({ orderRow } = {}) {
    const writes = { updates: [], inserts: [] };
    const row = orderRow || {
      id: 'o1', company_id: 'c1', status: 'confirmado',
      order_type: 'retirada', customer_id: null,
      customer_data: { name: '', phone: '', email: '' },
    };
    const forTable = (tname) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: tname === 'orders' ? row : null, error: null }),
        update: (p) => { writes.updates.push({ table: tname, payload: p }); return chain; },
        insert: (p) => { writes.inserts.push({ table: tname, payload: p }); return chain; },
        then: (resolve) => { resolve({ data: null, error: null }); },
      };
      return chain;
    };
    return {
      writes,
      from: (name) => forTable(name),
      auth: { getSession: async () => ({ data: { session: null } }) },
    };
  }

  it('salva nome no snapshot sem tocar em customers', async () => {
    const client = comandaMock();
    const out = await setComandaName(client, 'o1', 'c1', '  André ');
    assert.equal(out, 'André');
    const orderUpdates = client.writes.updates.filter((w) => w.table === 'orders');
    assert.equal(orderUpdates.length, 1);
    assert.deepEqual(Object.keys(orderUpdates[0].payload), ['customer_data']);
    assert.deepEqual(orderUpdates[0].payload.customer_data, { name: 'André', phone: '', email: '' });
    assert.ok(client.writes.inserts.every((w) => w.table !== 'customers'));
    assert.ok(!client.writes.updates.some((w) => w.table === 'customers'));
  });

  it('vazio remove o nome (volta a Avulso)', async () => {
    const client = comandaMock({ orderRow: {
      id: 'o1', company_id: 'c1', status: 'em_preparo',
      order_type: 'retirada', customer_id: null,
      customer_data: { name: 'João', phone: '', email: '' },
    } });
    const out = await setComandaName(client, 'o1', 'c1', '   ');
    assert.equal(out, '');
    assert.equal(client.writes.updates.find((w) => w.table === 'orders').payload.customer_data.name, '');
  });

  it('recusa delivery, com cliente e terminal', async () => {
    const base = { id: 'o1', company_id: 'c1', status: 'confirmado', customer_id: null, customer_data: {} };
    await assert.rejects(
      setComandaName(comandaMock({ orderRow: { ...base, order_type: 'delivery' } }), 'o1', 'c1', 'X'),
      /balcão\/retirada/,
    );
    await assert.rejects(
      setComandaName(comandaMock({ orderRow: { ...base, order_type: 'retirada', customer_id: 'c9' } }), 'o1', 'c1', 'X'),
      /cliente vinculado/,
    );
    await assert.rejects(
      setComandaName(comandaMock({ orderRow: { ...base, order_type: 'retirada', status: 'finalizado' } }), 'o1', 'c1', 'X'),
      /finalizado\/cancelado/,
    );
  });
});

describe('orders — dependências entre produtos (Gate 3, servidor é autoridade)', () => {
  // O frontend valida por UX; estes testes garantem que o adapter envia
  // product_id/quantity íntegros (o que o servidor valida) e que a rejeição
  // do servidor (chamada direta/bypass) chega clara ao chamador, sem o
  // adapter remover ou alterar itens.
  const depReject = { data: null, error: { message: 'Batata frita exige Lanche ou Combo no pedido' } };

  it('bypass direto no create_order: servidor rejeita e mensagem chega intacta', async () => {
    const client = createMockClient({ rpcs: { create_order: depReject } });
    await assert.rejects(
      createOrder(client, {
        companySlug: 'loja', orderType: 'retirada',
        items: [{ product_id: 'batata', quantity: 1 }],
        customer: { name: 'Z', phone: '119' },
      }),
      /Batata frita exige Lanche ou Combo no pedido/,
    );
    // O payload enviado continha exatamente o item violador (sem mutação).
    assert.deepEqual(client.calls.rpc[0].args.p_items, [
      { product_id: 'batata', quantity: 1, complements: [], notes: '' },
    ]);
  });

  it('pedido válido com dependência satisfeita segue para a RPC com todos os itens', async () => {
    const client = createMockClient({ rpcs: { create_order: { data: { order_id: 'o', order_number: 7, tracking_token: 't' }, error: null } } });
    const out = await createOrder(client, {
      companySlug: 'loja', orderType: 'retirada',
      items: [
        { product_id: 'batata', quantity: 1 },
        { product_id: 'lanche', quantity: 2 },
      ],
      customer: { name: 'Z', phone: '119' },
    });
    assert.equal(out.order_number, 7);
    assert.equal(client.calls.rpc[0].args.p_items.length, 2);
  });

  it('edição com itens incompatíveis: manage_order rejeita e edição é preservada', async () => {
    const client = createMockClient({ rpcs: { manage_order: depReject } });
    const items = [
      { product_id: 'batata', quantity: 1, complements: [], notes: '' },
    ];
    await assert.rejects(
      editOrder(client, 'o1', { items }),
      /Batata frita exige/,
    );
    // Adapter não removeu nada: o chamador mantém `items` para corrigir.
    assert.deepEqual(items, [{ product_id: 'batata', quantity: 1, complements: [], notes: '' }]);
    assert.equal(client.calls.rpc[0].args.p_action, 'edit');
  });

  it('remoção do exigido via edit: servidor barra o conjunto resultante', async () => {
    const client = createMockClient({ rpcs: { manage_order: depReject } });
    await assert.rejects(
      editOrder(client, 'o1', { items: [{ product_id: 'batata', quantity: 1 }] }),
      /exige/,
    );
  });

  it('isolamento por empresa: slug da empresa sempre no escopo; cross-tenant barrado', async () => {
    const client = createMockClient({ rpcs: { create_order: { data: { order_id: 'o' }, error: null } } });
    await createOrder(client, {
      companySlug: 'loja-a', items: [{ product_id: 'p', quantity: 1 }], customer: {},
    });
    assert.equal(client.calls.rpc[0].args.p_company_slug, 'loja-a');
    // Sem slug, nem há chamada (falha local antes da rede).
    await assert.rejects(
      createOrder(createMockClient({}), { companySlug: '', items: [{ product_id: 'p', quantity: 1 }], customer: {} }),
      /Empresa não identificada/,
    );
    // Servidor rejeita pedido de outra empresa com mensagem clara.
    const cross = createMockClient({ rpcs: { manage_order: { data: null, error: { message: 'Pedido não encontrado ou sem permissão' } } } });
    await assert.rejects(editOrder(cross, 'outra-empresa', { items: [] }), /sem permissão/);
  });

  it('compatibilidade: legado (complements) e V2 (config) preservam product_id para a checagem', async () => {
    const client = createMockClient({ rpcs: { create_order: { data: { order_id: 'o' }, error: null } } });
    await createOrder(client, {
      companySlug: 'loja',
      items: [
        { product_id: 'batata', quantity: 1, complements: [{ group_name: 'G', option_name: 'O', price: 2, quantity: 1 }] },
        { product_id: 'monte', quantity: 1, config: { steps: [{ step_id: 's', items: [{ option_id: 'o', quantity: 1 }] }] } },
        { product_id: 'lanche', quantity: 1 },
      ],
      customer: {},
    });
    const sent = client.calls.rpc[0].args.p_items;
    assert.deepEqual(sent.map((i) => i.product_id), ['batata', 'monte', 'lanche']);
    assert.deepEqual(sent[0].complements, [{ group_name: 'G', option_name: 'O', price: 2, quantity: 1 }]);
    assert.deepEqual(sent[1].config, { steps: [{ step_id: 's', items: [{ option_id: 'o', quantity: 1 }] }] });
  });

  it('regra inativa / produto indisponível: erros do servidor propagam sem mascarar', async () => {
    const unavailable = createMockClient({ rpcs: { create_order: { data: null, error: { message: 'Produto indisponível: Lanche' } } } });
    await assert.rejects(
      createOrder(unavailable, { companySlug: 'loja', items: [{ product_id: 'lanche', quantity: 1 }], customer: {} }),
      /indisponível/,
    );
    // Regra inativa não gera erro: pedido passa (servidor só lê active=true).
    const ok = createMockClient({ rpcs: { create_order: { data: { order_id: 'o', order_number: 1 }, error: null } } });
    const out = await createOrder(ok, {
      companySlug: 'loja', items: [{ product_id: 'coca', quantity: 1 }], customer: {},
    });
    assert.equal(out.order_number, 1);
  });
});
