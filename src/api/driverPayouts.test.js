import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  listPayouts, getPayoutItems, createPayout, paidOrderIds,
} from './driverPayouts.js';

function createMockClient({ rows = {}, errors = {} } = {}) {
  const calls = [];
  const table = (name) => {
    const cfg = rows[name] || {};
    const chain = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: () => chain,
      in: () => chain,
      insert: (p) => { calls.push({ table: name, op: 'insert', payload: p }); return chain; },
      delete: () => { calls.push({ table: name, op: 'delete' }); return chain; },
      single: async () => cfg.single || { data: null, error: errors[name] || null },
      maybeSingle: async () => cfg.maybeSingle || { data: null, error: errors[name] || null },
      then: (resolve) => { resolve(cfg.list || { data: [], error: errors[name] || null }); },
    };
    return chain;
  };
  return { calls, from: (name) => table(name) };
}

const goodOrder = { id: 'o1', driver_id: 'd1', status: 'finalizado', delivery_fee: 6 };

describe('driverPayouts — leitura com escopo', () => {
  it('lista com empresa + filtro de entregador; sem empresa falha antes', async () => {
    const client = createMockClient({
      rows: { driver_payouts: { list: { data: [{ id: 'p1' }], error: null } } },
    });
    assert.deepEqual(await listPayouts(client, 'c1', { driverId: 'd1' }), [{ id: 'p1' }]);
    await assert.rejects(listPayouts(client, ''), /Empresa atual/);
    await assert.rejects(getPayoutItems(client, ''), /identificado/);
    assert.deepEqual(await getPayoutItems(createMockClient(), 'p1'), []);
  });
});

describe('driverPayouts — fechamento', () => {
  it('valida entregador, período e elegibilidade antes da rede', async () => {
    const client = createMockClient({
      rows: { driver_payouts: { single: { data: { id: 'p1' }, error: null } } },
    });
    await assert.rejects(createPayout(client, 'c1', { driverId: '', periodStart: '2026-10-01', periodEnd: '2026-10-07', orders: [goodOrder] }), /entregador/);
    await assert.rejects(createPayout(client, 'c1', { driverId: 'd1', periodStart: '', periodEnd: '', orders: [goodOrder] }), /período/);
    await assert.rejects(
      createPayout(client, 'c1', { driverId: 'd1', periodStart: '2026-10-01', periodEnd: '2026-10-07', orders: [{ ...goodOrder, status: 'novo' }] }),
      /elegível/,
    );
    assert.equal(client.calls.length, 0);
  });

  it('congela totais do snapshot e envia itens com fee do pedido', async () => {
    const client = createMockClient({
      rows: { driver_payouts: { single: { data: { id: 'p1' }, error: null } } },
    });
    const out = await createPayout(client, 'c1', {
      driverId: 'd1', periodStart: '2026-10-01', periodEnd: '2026-10-07',
      orders: [goodOrder, { ...goodOrder, id: 'o2', delivery_fee: '4.5' }],
    });
    assert.equal(out.id, 'p1');
    const head = client.calls.find((c) => c.table === 'driver_payouts');
    assert.equal(head.payload.total_orders, 2);
    assert.equal(head.payload.total_fee, 10.5);
    assert.equal(head.payload.paid_amount, 10.5);
    assert.equal(head.payload.company_id, 'c1');
    const items = client.calls.find((c) => c.table === 'driver_payout_items');
    assert.deepEqual(items.payload.map((i) => [i.order_id, i.fee]), [['o1', 6], ['o2', 4.5]]);
  });

  it('duplicidade do banco vira mensagem clara (sem travar em erro cru)', async () => {
    const client = createMockClient({
      rows: {
        driver_payouts: { single: { data: { id: 'p1' }, error: null } },
        driver_payout_items: { list: { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "uq_payout_item_order"' } } },
      },
    });
    await assert.rejects(
      createPayout(client, 'c1', { driverId: 'd1', periodStart: '2026-10-01', periodEnd: '2026-10-07', orders: [goodOrder] }),
      /já foi paga/,
    );
    // Lote parcial revertido: cabeçalho removido.
    assert.ok(client.calls.some((c) => c.table === 'driver_payouts' && c.op === 'delete'));
  });
});

describe('driverPayouts — pedidos já pagos', () => {
  it('retorna ids via payouts da empresa (2 consultas)', async () => {
    const client = createMockClient({
      rows: {
        driver_payouts: { list: { data: [{ id: 'p1' }], error: null } },
        driver_payout_items: { list: { data: [{ order_id: 'o1' }], error: null } },
      },
    });
    assert.deepEqual(await paidOrderIds(client, 'c1', 'd1'), ['o1']);
    const empty = createMockClient({ rows: { driver_payouts: { list: { data: [], error: null } } } });
    assert.deepEqual(await paidOrderIds(empty, 'c1', 'd1'), []);
  });
});
