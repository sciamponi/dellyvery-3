import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DRIVER_NOTIF_STATUSES, nextDriverNotifStatus,
  getDriverNotification, markDriverNotified, ensureDriverPending,
} from './driverNotifications.js';

function createMockClient({ existing = null, updated = null, inserted = null } = {}) {
  const calls = { select: [], insert: [], update: [] };
  const chainFor = () => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: () => chain,
      insert: (p) => { calls.insert.push(p); chain._insert = p; return chain; },
      update: (p) => { calls.update.push(p); return chain; },
      maybeSingle: async () => {
        if (chain._insert) return { data: inserted, error: null };
        if (calls.update.length > 0) return { data: updated, error: null };
        return { data: existing, error: null };
      },
    };
    return chain;
  };
  return { calls, from: () => chainFor() };
}

describe('driverNotifications — máquina de status', () => {
  it('catálogo e avanço manual máximo até iniciado', () => {
    assert.deepEqual(DRIVER_NOTIF_STATUSES, ['pendente', 'iniciado', 'confirmado']);
    assert.equal(nextDriverNotifStatus('pendente'), 'iniciado');
    assert.equal(nextDriverNotifStatus('iniciado'), 'confirmado');
    assert.equal(nextDriverNotifStatus('confirmado'), null);
  });

  it('sem registro: cria como iniciado (nunca confirmado)', async () => {
    const client = createMockClient({ existing: null, inserted: { id: 'n1', status: 'iniciado' } });
    const out = await markDriverNotified(client, 'c1', { orderId: 'o1', driverId: 'd1', message: 'm' });
    assert.equal(out.status, 'iniciado');
    assert.equal(client.calls.insert[0].status, 'iniciado');
    assert.equal(client.calls.insert[0].company_id, 'c1');
    await assert.rejects(() => markDriverNotified(client, '', { orderId: 'o1' }), /Empresa/);
    await assert.rejects(() => markDriverNotified(client, 'c1', {}), /Pedido/);
  });

  it('pendente avança para iniciado; iniciado não vira confirmado manual', async () => {
    const c1 = createMockClient({ existing: { id: 'n1', status: 'pendente' }, updated: { id: 'n1', status: 'iniciado' } });
    const out1 = await markDriverNotified(c1, 'c1', { orderId: 'o1' });
    assert.equal(out1.status, 'iniciado');
    assert.equal(c1.calls.update[0].status, 'iniciado');
    const c2 = createMockClient({ existing: { id: 'n2', status: 'iniciado' } });
    const out2 = await markDriverNotified(c2, 'c1', { orderId: 'o1' });
    assert.equal(out2.status, 'iniciado');
    assert.equal(c2.calls.update.length, 0);
  });
});

describe('driverNotifications — pendente idempotente (auto na saída)', () => {
  it('cria pendente com motivo quando não há registro', async () => {
    const client = createMockClient({ existing: null, inserted: { id: 'n1', status: 'pendente' } });
    const out = await ensureDriverPending(client, 'c1', { orderId: 'o1', driverId: 'd1', message: 'auto' });
    assert.equal(out.status, 'pendente');
    assert.equal(client.calls.insert[0].status, 'pendente');
    assert.equal(client.calls.insert[0].driver_id, 'd1');
    assert.equal(client.calls.insert[0].channel, 'whatsapp');
    await assert.rejects(() => ensureDriverPending(client, '', { orderId: 'o1' }), /Empresa/);
    await assert.rejects(() => ensureDriverPending(client, 'c1', {}), /Pedido/);
  });

  it('reutiliza pendente/iniciado do mesmo entregador (sem duplicar)', async () => {
    const c1 = createMockClient({ existing: { id: 'n1', status: 'pendente', driver_id: 'd1' } });
    assert.equal((await ensureDriverPending(c1, 'c1', { orderId: 'o1', driverId: 'd1' })).id, 'n1');
    assert.equal(c1.calls.insert.length, 0);
    const c2 = createMockClient({ existing: { id: 'n2', status: 'iniciado', driver_id: 'd1' } });
    assert.equal((await ensureDriverPending(c2, 'c1', { orderId: 'o1', driverId: 'd1' })).id, 'n2');
    assert.equal(c2.calls.insert.length, 0);
  });

  it('troca de entregador abre linha nova; confirmado não reabre', async () => {
    const c1 = createMockClient({ existing: { id: 'n1', status: 'iniciado', driver_id: 'd1' }, inserted: { id: 'n2', status: 'pendente' } });
    const out = await ensureDriverPending(c1, 'c1', { orderId: 'o1', driverId: 'd2' });
    assert.equal(out.id, 'n2');
    assert.equal(c1.calls.insert[0].driver_id, 'd2');
    const c2 = createMockClient({ existing: { id: 'n9', status: 'confirmado', driver_id: 'd1' } });
    assert.equal((await ensureDriverPending(c2, 'c1', { orderId: 'o1', driverId: 'd1' })).id, 'n9');
    assert.equal(c2.calls.insert.length, 0);
  });
});
