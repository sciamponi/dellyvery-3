import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getSubscriptionSettings,
  setSubscriptionGraceDays,
  setSubscriptionGateEnabled,
  grantCompanyGrace,
} from './subscriptionSettings.js';

function createMockClient({ row = null, settings = null, error = null } = {}) {
  const calls = [];
  return {
    calls,
    from: (table) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: settings, error }),
      };
      calls.push({ table, op: 'select' });
      return chain;
    },
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      return { data: row, error };
    },
  };
}

describe('subscriptionSettings', () => {
  it('le a configuracao e devolve defaults quando nao existe linha', async () => {
    const client = createMockClient({ settings: null });
    const out = await getSubscriptionSettings(client);
    assert.equal(out.subscription_grace_days, 0);
    assert.equal(out.subscription_gate_enabled, false);
    assert.deepEqual(client.calls[0], { table: 'platform_settings', op: 'select' });
  });

  it('envia dias de carencia validos para a RPC', async () => {
    const client = createMockClient({ row: { subscription_grace_days: 5 } });
    await setSubscriptionGraceDays(client, '5');
    assert.deepEqual(client.calls[0], {
      fn: 'set_subscription_grace_days',
      args: { p_days: 5 },
    });
  });

  it('rejeita carencia invalida sem chamar a RPC', async () => {
    const client = createMockClient();
    await assert.rejects(() => setSubscriptionGraceDays(client, -1), /maior ou igual/);
    await assert.rejects(() => setSubscriptionGraceDays(client, 1.5), /maior ou igual/);
    assert.equal(client.calls.length, 0);
  });

  it('envia o estado do gate como booleano', async () => {
    const client = createMockClient({ row: { subscription_gate_enabled: true } });
    await setSubscriptionGateEnabled(client, 1);
    assert.deepEqual(client.calls[0], {
      fn: 'set_subscription_gate_enabled',
      args: { p_enabled: true },
    });
  });

  it('concede carencia usando os dias informados e motivo nulo', async () => {
    const client = createMockClient({ row: { id: 'g1' } });
    await grantCompanyGrace(client, 'c1', '', '');
    assert.deepEqual(client.calls[0], {
      fn: 'grant_company_grace',
      args: { p_company_id: 'c1', p_days: null, p_reason: null },
    });
  });

  it('propaga erro da RPC', async () => {
    const client = createMockClient({ error: { message: 'Apenas PLATFORM_ADMIN' } });
    await assert.rejects(() => setSubscriptionGateEnabled(client, true), /PLATFORM_ADMIN/);
  });
});
