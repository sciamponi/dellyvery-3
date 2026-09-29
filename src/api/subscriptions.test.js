import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { manageSubscription, withPeriodEnd } from './subscriptions.js';

// Mock RPC (sem rede). A lógica de autorização/transição vive na RPC
// manage_subscription (SECURITY DEFINER); aqui cobre-se o wiring do
// adapter: ação válida, parâmetros exatos, sem company_id do frontend,
// propagação de erro e preservação dos campos da linha.
function createMockClient({ row = null, error = null } = {}) {
  const calls = [];
  return {
    calls,
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      return { data: row, error };
    },
  };
}

const ROW = {
  id: 's1', company_id: 'c1', plan_id: 'p2', status: 'ativo',
  started_at: '2026-01-01T00:00:00Z', expires_at: '2026-02-01T00:00:00Z',
  created_at: '2026-01-01T00:00:00Z',
};

describe('subscriptions — adapter manageSubscription', () => {
  it('upgrade envia action + plan_id, sem company_id', async () => {
    const client = createMockClient({ row: ROW });
    const out = await manageSubscription(client, { action: 'upgrade', planId: 'p2' });
    assert.deepEqual(client.calls[0], { fn: 'manage_subscription', args: { p_action: 'upgrade', p_plan_id: 'p2' } });
    assert.ok(!('p_company_id' in client.calls[0].args));
    assert.equal(out.plan_id, 'p2');
  });

  it('cancel e reactivate enviam plan_id nulo', async () => {
    const client = createMockClient({ row: { ...ROW, status: 'cancelado' } });
    await manageSubscription(client, { action: 'cancel' });
    assert.deepEqual(client.calls[0].args, { p_action: 'cancel', p_plan_id: null });
    const client2 = createMockClient({ row: { ...ROW, status: 'ativo' } });
    await manageSubscription(client2, { action: 'reactivate' });
    assert.deepEqual(client2.calls[0].args, { p_action: 'reactivate', p_plan_id: null });
  });

  it('ação inválida é rejeitada no client', async () => {
    const client = createMockClient({ row: ROW });
    await assert.rejects(() => manageSubscription(client, { action: 'excluir' }), /Ação inválida/);
    await assert.rejects(() => manageSubscription(client, {}), /Ação inválida/);
    assert.equal(client.calls.length, 0);
  });

  it('erro da RPC (role/estado/plano) é propagado com mensagem', async () => {
    for (const msg of [
      'Apenas OWNER ou ADMIN pode alterar a assinatura',
      'Empresa não encontrada ou sem permissão',
      'Plano não encontrado',
      'Plano indisponível',
      'Plano não informado',
      'Assinatura já cancelada',
      'Assinatura não pode ser cancelada neste estado',
      'Somente assinatura cancelada pode ser reativada',
      'Assinatura expirada não pode ser reativada',
      'Assinatura não encontrada',
      'not authenticated',
    ]) {
      const client = createMockClient({ row: null, error: { message: msg } });
      await assert.rejects(() => manageSubscription(client, { action: 'cancel' }), new RegExp(msg.replace(/[()]/g, '')));
    }
  });

  it('linha retornada preserva expires_at/created_at/company_id', async () => {
    const client = createMockClient({ row: ROW });
    const out = await manageSubscription(client, { action: 'upgrade', planId: 'p2' });
    assert.equal(out.expires_at, ROW.expires_at);
    assert.equal(out.created_at, ROW.created_at);
    assert.equal(out.company_id, ROW.company_id);
  });

  it('sem configuração, lança erro claro', async () => {
    await assert.rejects(() => manageSubscription(null, { action: 'cancel' }), /não configurado/);
  });
});

describe('subscriptions — withPeriodEnd', () => {
  it('expõe expires_at como current_period_end para a UI', () => {
    const out = withPeriodEnd(ROW);
    assert.equal(out.current_period_end, ROW.expires_at);
    assert.equal(out.expires_at, ROW.expires_at);
  });

  it('não sobrescreve current_period_end existente nem nulos', () => {
    const withOwn = { ...ROW, current_period_end: 'X' };
    assert.equal(withPeriodEnd(withOwn).current_period_end, 'X');
    assert.equal(withPeriodEnd(null), null);
    assert.equal(withPeriodEnd(undefined), undefined);
  });
});
