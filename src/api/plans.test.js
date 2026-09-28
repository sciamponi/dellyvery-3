import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  slugifyPlanName, fromSupabasePlan, toSupabasePlan,
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
