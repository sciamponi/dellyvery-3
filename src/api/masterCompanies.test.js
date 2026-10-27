import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  listMasterCompanies,
  getMasterCompanyMetrics,
  mapMasterCompany,
  normalizeMasterSearch,
} from './masterCompanies.js';

function result(value) {
  return value || { data: [], error: null };
}

function createMockClient({ tables = {} } = {}) {
  const calls = [];
  const queues = Object.fromEntries(
    Object.entries(tables).map(([name, value]) => [name, Array.isArray(value) ? [...value] : [value]]),
  );

  const table = (name) => {
    const chain = {};
    const record = (op, args) => {
      calls.push({ table: name, op, args });
      return chain;
    };
    for (const op of ['select', 'eq', 'order', 'limit', 'in', 'is', 'or', 'not', 'gte', 'lte', 'ilike']) {
      chain[op] = (...args) => record(op, args);
    }
    chain.then = (resolve, reject) => {
      const queue = queues[name] || [];
      const next = queue.length > 1 ? queue.shift() : queue[0];
      return Promise.resolve(result(next)).then(resolve, reject);
    };
    return chain;
  };

  return { calls, from: table };
}

const companyRow = {
  id: 'c1',
  name: 'Cantina da Praça',
  slug: 'cantina-da-praca',
  active: true,
  created_at: '2026-10-01T12:00:00.000Z',
  segment: { name: 'Restaurante' },
  subscriptions: {
    status: 'ativo',
    started_at: '2026-10-02T12:00:00.000Z',
    expires_at: '2026-11-02T12:00:00.000Z',
    plans: { id: 'p1', name: 'Pro', price: '49.90', billing_cycle: 'monthly' },
  },
};

const ownerRow = {
  company_id: 'c1',
  user_id: 'u1',
  role: 'OWNER',
  active: true,
  profiles: { name: 'Maria', email: 'maria@exemplo.com', phone: '11999998888' },
};

describe('masterCompanies — métricas globais', () => {
  it('usa contagens exatas e calcula inativas/sem plano sem depender da lista', async () => {
    const client = createMockClient({
      tables: {
        companies: [{ count: 10, error: null }, { count: 7, error: null }],
        subscriptions: [{ count: 2, error: null }, { count: 3, error: null }, { count: 6, error: null }],
      },
    });

    const metrics = await getMasterCompanyMetrics(client);
    assert.deepEqual(metrics, {
      totalCompanies: 10,
      activeCompanies: 7,
      inactiveCompanies: 3,
      trials: 2,
      expiringSoon: 3,
      withoutSubscriptionOrPlan: 4,
    });

    assert.ok(client.calls.some((c) => c.table === 'companies' && c.op === 'eq' && c.args[0] === 'active'));
    assert.ok(client.calls.some((c) => c.table === 'subscriptions' && c.op === 'eq' && c.args[0] === 'status' && c.args[1] === 'trial'));
    assert.ok(client.calls.some((c) => c.table === 'subscriptions' && c.op === 'gte' && c.args[0] === 'expires_at'));
    assert.ok(client.calls.some((c) => c.table === 'subscriptions' && c.op === 'lte' && c.args[0] === 'expires_at'));
    assert.ok(client.calls.some((c) => c.table === 'subscriptions' && c.op === 'not' && c.args[0] === 'plan_id'));
  });

  it('propaga erro de contagem em vez de mostrar zero', async () => {
    const client = createMockClient({
      tables: { companies: { count: null, error: { message: 'sem permissão' } } },
    });
    await assert.rejects(() => getMasterCompanyMetrics(client), /sem permissão/);
  });
});

describe('masterCompanies — lista e relacionamentos', () => {
  it('mapeia empresa, dono, assinatura e plano sem N+1', async () => {
    const client = createMockClient({
      tables: {
        companies: { data: [companyRow], error: null },
        company_members: { data: [ownerRow], error: null },
      },
    });

    const out = await listMasterCompanies(client);
    assert.equal(out.items.length, 1);
    assert.equal(out.hasMore, false);
    assert.deepEqual(out.items[0], {
      id: 'c1',
      name: 'Cantina da Praça',
      slug: 'cantina-da-praca',
      active: true,
      createdAt: '2026-10-01T12:00:00.000Z',
      segment: 'Restaurante',
      owner: {
        id: 'u1',
        name: 'Maria',
        email: 'maria@exemplo.com',
        phone: '11999998888',
        active: true,
      },
      subscription: {
        status: 'ativo',
        startedAt: '2026-10-02T12:00:00.000Z',
        expiresAt: '2026-11-02T12:00:00.000Z',
      },
      plan: { id: 'p1', name: 'Pro', price: 49.9, billingCycle: 'monthly' },
    });

    const companiesSelect = client.calls.find((c) => c.table === 'companies' && c.op === 'select');
    assert.match(companiesSelect.args[0], /business_segments/);
    assert.match(companiesSelect.args[0], /subscriptions/);
    assert.match(companiesSelect.args[0], /plans/);
    assert.ok(client.calls.some((c) => c.table === 'companies' && c.op === 'limit' && c.args[0] === 201));
    assert.ok(client.calls.some((c) => c.table === 'company_members' && c.op === 'in' && c.args[1][0] === 'c1'));
  });

  it('sinaliza mais resultados ao passar do limite de 200', async () => {
    const rows = Array.from({ length: 201 }, (_, i) => ({ ...companyRow, id: `c${i}` }));
    const client = createMockClient({
      tables: {
        companies: { data: rows, error: null },
        company_members: { data: [], error: null },
      },
    });
    const out = await listMasterCompanies(client);
    assert.equal(out.items.length, 200);
    assert.equal(out.hasMore, true);
  });

  it('busca por nome/slug/e-mail do proprietário e aplica filtros no servidor', async () => {
    const client = createMockClient({
      tables: {
        profiles: { data: [{ id: 'u1' }], error: null },
        company_members: [
          { data: [{ company_id: 'c1', user_id: 'u1', role: 'OWNER' }], error: null },
          { data: [ownerRow], error: null },
        ],
        companies: { data: [companyRow], error: null },
      },
    });

    await listMasterCompanies(client, {
      search: 'maria@exemplo.com',
      companyStatus: 'active',
      subscriptionStatus: 'ativo',
      planId: 'p1',
    });

    const select = client.calls.find((c) => c.table === 'companies' && c.op === 'select');
    assert.match(select.args[0], /subscriptions!inner/);
    const orCall = client.calls.find((c) => c.table === 'companies' && c.op === 'or');
    assert.match(orCall.args[0], /name\.ilike\.%maria@exemplo\.com%/);
    assert.match(orCall.args[0], /slug\.ilike\.%maria@exemplo\.com%/);
    assert.match(orCall.args[0], /id\.in\.\(c1\)/);
    assert.ok(client.calls.some((c) => c.op === 'eq' && c.args[0] === 'active' && c.args[1] === true));
    assert.ok(client.calls.some((c) => c.op === 'eq' && c.args[0] === 'subscriptions.status' && c.args[1] === 'ativo'));
    assert.ok(client.calls.some((c) => c.op === 'eq' && c.args[0] === 'subscriptions.plan_id' && c.args[1] === 'p1'));
  });

  it('filtra empresas sem assinatura usando left join explícito', async () => {
    const client = createMockClient({
      tables: {
        companies: { data: [], error: null },
        company_members: { data: [], error: null },
      },
    });
    await listMasterCompanies(client, { subscriptionStatus: 'none' });
    const select = client.calls.find((c) => c.table === 'companies' && c.op === 'select');
    assert.doesNotMatch(select.args[0], /!inner/);
    assert.ok(client.calls.some((c) => c.op === 'is' && c.args[0] === 'subscriptions' && c.args[1] === null));
  });

  it('normaliza busca e mapeia relações retornadas como array', () => {
    assert.equal(normalizeMasterSearch('  a,(b)  '), 'a b');
    const mapped = mapMasterCompany({
      ...companyRow,
      segment: [{ name: 'Restaurante' }],
      subscriptions: [{ ...companyRow.subscriptions, plans: [{ id: 'p1', name: 'Pro', price: 10, billing_cycle: 'yearly' }] }],
    }, { ...ownerRow, profiles: [{ name: 'Maria', email: 'm@x', phone: '1' }] });
    assert.equal(mapped.segment, 'Restaurante');
    assert.equal(mapped.plan.billingCycle, 'yearly');
    assert.equal(mapped.owner.email, 'm@x');
  });

  it('propaga erro da lista', async () => {
    const client = createMockClient({
      tables: { companies: { data: null, error: { message: 'falha na consulta' } } },
    });
    await assert.rejects(() => listMasterCompanies(client), /falha na consulta/);
  });
});
