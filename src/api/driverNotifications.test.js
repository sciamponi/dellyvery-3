import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DRIVER_NOTIF_STATUSES, nextDriverNotifStatus,
  getDriverNotification, markDriverNotified,
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
