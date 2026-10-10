import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  LEAD_SERVICES, LEAD_STATUSES, LEAD_PAYMENT_PREFERENCES, LEAD_PLANS,
  LEAD_BILLING_PERIODS, leadBillingLabel,
  leadPaymentLabel, leadStatusLabel, resolvePlanInterest,
  createLead, listLeads, setLeadStatus,
} from './leads.js';

function createMockClient({ rpcs = {}, tables = {} } = {}) {
  const calls = { rpc: [] };
  const table = (name) => {
    const cfg = tables[name] || {};
    const chain = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: () => chain,
      then: (resolve) => resolve(cfg.list || { data: [], error: null }),
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
  };
}

describe('leads — catálogo e status', () => {
  it('serviços incluem Dellyvery em destaque', () => {
    assert.equal(LEAD_SERVICES.length, 5);
    const d = LEAD_SERVICES.find((s) => s.id === 'dellyvery');
    assert.ok(d && d.highlight);
    assert.ok(LEAD_SERVICES.some((s) => s.id === 'outro'));
  });

  it('labels de status', () => {
    assert.equal(LEAD_STATUSES.length, 6);
    assert.equal(leadStatusLabel('novo'), 'Novo interessado');
    assert.equal(leadStatusLabel('contratado'), 'Contratado');
    assert.equal(leadStatusLabel('xx'), 'xx');
  });

  it('preferências legadas (compat: só exibição de cadastros antigos)', () => {
    assert.equal(LEAD_PAYMENT_PREFERENCES.length, 3);
    assert.equal(leadPaymentLabel('pix'), 'Pix');
    assert.equal(leadPaymentLabel('cartao'), 'Cartão');
    assert.equal(leadPaymentLabel('negociacao'), 'Negociação');
    assert.equal(leadPaymentLabel('boleto'), 'boleto');
  });

  it('plano via ?plano= preservado como informação (sem cobrança)', () => {
    assert.equal(LEAD_PLANS.length, 1);
    assert.equal(resolvePlanInterest('dellyvery-completo'), 'Dellyvery Completo');
    assert.equal(resolvePlanInterest('DELLYVERY-COMPLETO'), 'Dellyvery Completo');
    assert.equal(resolvePlanInterest(''), '');
    assert.equal(resolvePlanInterest(null), '');
    assert.equal(resolvePlanInterest('outro-plano'), 'outro-plano');
  });

  it('periodicidade: 3 opções, rótulos e compat com antigos', () => {
    assert.deepEqual(LEAD_BILLING_PERIODS.map((p) => p.id), ['mensal', 'semestral', 'anual']);
    assert.equal(leadBillingLabel('mensal'), 'Mensal');
    assert.equal(leadBillingLabel('semestral'), 'Semestral');
    assert.equal(leadBillingLabel('anual'), 'Anual');
    assert.equal(leadBillingLabel(null), '—');
    assert.equal(leadBillingLabel(''), '—');
  });
});

describe('leads — adapter via RPC (sem SELECT anon)', () => {
  it('createLead usa RPC create_lead', async () => {
    const client = createMockClient({ rpcs: { create_lead: { data: { lead_id: 'l1' }, error: null } } });
    const out = await createLead(client, { service: 'dellyvery', full_name: 'Zé' });
    assert.equal(out.lead_id, 'l1');
    assert.equal(client.calls.rpc[0].fn, 'create_lead');
    assert.ok(client.calls.rpc[0].args.p_lead);
    await assert.rejects(() => createLead(client, null), /inválidos/);
  });

  it('setLeadStatus usa RPC sem company_id', async () => {
    const client = createMockClient({ rpcs: { set_lead_status: { data: { id: 'l1' }, error: null } } });
    await setLeadStatus(client, 'l1', 'em_contato');
    assert.deepEqual(client.calls.rpc[0], {
      fn: 'set_lead_status', args: { p_lead_id: 'l1', p_status: 'em_contato' },
    });
    await assert.rejects(() => setLeadStatus(client, '', 'novo'), /identificado/);
  });

  it('listLeads filtra por status', async () => {
    const client = createMockClient({
      tables: { leads: { list: { data: [{ id: 'l1' }], error: null } } },
    });
    const list = await listLeads(client, { status: 'novo' });
    assert.equal(list.length, 1);
  });
});
