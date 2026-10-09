import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  slugifyPlanName, fromSupabasePlan, toSupabasePlan, validatePlanData,
  listPlans, createPlan, updatePlan, deletePlan, isPlatformAdmin,
} from './plans.js';

function createMockClient({ tables = {} } = {}) {
  const calls = [];
  const table = (name) => {
    const cfg = tables[name] || {};
    const chain = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      insert: (p) => { calls.push({ table: name, op: 'insert', payload: p }); return chain; },
      update: (p) => { calls.push({ table: name, op: 'update', payload: p }); return chain; },
      delete: () => { calls.push({ table: name, op: 'delete' }); return chain; },
      single: async () => cfg.single || { data: null, error: null },
      maybeSingle: async () => cfg.maybeSingle || { data: null, error: null },
      then: (resolve) => { resolve(cfg.list || { data: [], error: null }); },
    };
    return chain;
  };
  return { calls, from: (name) => table(name) };
}

describe('plans — mapeamento Base44 <-> Supabase', () => {
  it('slugify', () => {
    assert.equal(slugifyPlanName('Plano Pro!'), 'plano-pro');
    assert.equal(slugifyPlanName('  '), '');
  });

  it('from: limits JSONB -> flat + popular', () => {
    const p = fromSupabasePlan({
      id: '1', name: 'Solo', slug: 'solo', price: '29.9', billing_cycle: 'monthly',
      features: ['a'], limits: { users: 1, orders: -1, whatsapp: 5, ia: true, popular: true, storage_mb: 200 },
      sort_order: 0, active: true,
    });
    assert.equal(p.price, 29.9);
    assert.equal(p.limits_users, 1);
    assert.equal(p.limits_whatsapp, 5);
    assert.equal(p.limits_ia, true);
    assert.equal(p.is_popular, true);
    assert.equal(p.limits_storage_mb, 200);
    assert.equal(p.limits_customers, -1);
  });

  it('to: flat -> limits JSONB, sem is_popular solto', () => {
    const out = toSupabasePlan({ name: 'X', price: '10', limits_users: 2, is_popular: true, active: false });
    assert.equal(out.slug, 'x');
    assert.deepEqual(out.limits, { users: 2, popular: true });
    assert.ok(!('is_popular' in out));
    assert.ok(!('limits_users' in out));
  });

  it('list/create/update/delete chamam tabelas certas', async () => {
    const client = createMockClient({ tables: { plans: { list: { data: [], error: null }, single: { data: { id: 'p', name: 'A', limits: {} }, error: null } } } });
    await listPlans(client, { onlyActive: true });
    await createPlan(client, { name: 'A' });
    await updatePlan(client, 'p', { active: false });
    await deletePlan(client, 'p');
    assert.deepEqual(client.calls.map((c) => c.op), ['insert', 'update', 'delete']);
  });

  it('create exige nome; update/delete exigem id', async () => {
    const client = createMockClient();
    await assert.rejects(() => createPlan(client, { name: '' }), /Nome/);
    await assert.rejects(() => updatePlan(client, '', {}), /identificado/);
    await assert.rejects(() => deletePlan(client, ''), /identificado/);
  });

  it('isPlatformAdmin lê profiles.platform_role', async () => {
    const yes = createMockClient({ tables: { profiles: { maybeSingle: { data: { platform_role: 'PLATFORM_ADMIN' }, error: null } } } });
    assert.equal(await isPlatformAdmin(yes, 'u'), true);
    const no = createMockClient({ tables: { profiles: { maybeSingle: { data: { platform_role: 'USER' }, error: null } } } });
    assert.equal(await isPlatformAdmin(no, 'u'), false);
    assert.equal(await isPlatformAdmin(no, null), false);
  });
});

describe('plans — FASE A campos comerciais e validação', () => {
  it('from/to: description/annual/setup/trial/sales/benefits', () => {
    const p = fromSupabasePlan({
      id: '1', name: 'Pro', slug: 'pro', price: '49.9', limits: {},
      description: 'Para crescer', annual_price: '499', setup_fee: '99',
      trial_days: 14, sales_text: 'Venda mais', benefits: ['Suporte'],
      sort_order: 1, active: true,
    });
    assert.equal(p.description, 'Para crescer');
    assert.equal(p.annual_price, 499);
    assert.equal(p.setup_fee, 99);
    assert.equal(p.trial_days, 14);
    assert.equal(p.sales_text, 'Venda mais');
    assert.deepEqual(p.benefits, ['Suporte']);
    const out = toSupabasePlan({
      description: 'D', annual_price: '', setup_fee: '50', trial_days: '14',
      sales_text: 'S', benefits: ['B'],
    });
    assert.equal(out.description, 'D');
    assert.equal(out.annual_price, null);
    assert.equal(out.setup_fee, 50);
    assert.equal(out.trial_days, 14);
    assert.equal(out.sales_text, 'S');
    assert.deepEqual(out.benefits, ['B']);
  });

  it('validatePlanData: preços, trial e limites (-1 = ilimitado)', () => {
    assert.equal(validatePlanData({ name: 'A' }), null);
    assert.equal(validatePlanData({}), 'Nome é obrigatório');
    assert.match(validatePlanData({ name: 'A', price: -5 }), /maior ou igual/);
    assert.match(validatePlanData({ name: 'A', annual_price: -1 }), /nual/);
    assert.match(validatePlanData({ name: 'A', trial_days: 1.5 }), /inteiro/);
    assert.match(validatePlanData({ name: 'A', limits_products: -2 }), /ilimitado/);
    assert.match(validatePlanData({ name: 'A', limits_users: 2.5 }), /ilimitado/);
    assert.equal(validatePlanData({ name: 'A', limits_orders: -1, limits_products: 0 }), null);
    assert.equal(validatePlanData({ active: false }, { partial: true }), null);
    assert.match(validatePlanData({ price: -1 }, { partial: true }), /mensal/);
  });

  it('create/update validam antes da rede; update parcial não exige nome', async () => {
    const client = createMockClient();
    await assert.rejects(() => createPlan(client, { name: 'A', price: -1 }), /maior ou igual/);
    assert.equal(client.calls.length, 0);
    await assert.rejects(() => updatePlan(client, 'p', { limits_products: -2 }), /ilimitado/);
    const ok = createMockClient({ tables: { plans: { single: { data: { id: 'p', name: 'A', limits: {} }, error: null } } } });
    await updatePlan(ok, 'p', { active: false });
    assert.equal(ok.calls[0].op, 'update');
  });

  it('Solo existente mapeia com defaults comerciais sem quebrar', () => {
    const p = fromSupabasePlan({
      id: 's', name: 'Solo', slug: 'solo', price: 0, billing_cycle: 'monthly',
      features: [], limits: { users: 1, products: -1, orders: -1, customers: -1, storage_mb: 100 },
      sort_order: 0, active: true,
    });
    assert.equal(p.trial_days, 7);
    assert.equal(p.setup_fee, 0);
    assert.equal(p.annual_price, null);
    assert.deepEqual(p.benefits, []);
    assert.equal(p.description, '');
  });
});
