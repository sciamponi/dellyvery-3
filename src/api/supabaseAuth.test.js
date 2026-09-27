import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  signUpWithPassword,
  signInWithPassword,
  signOut,
  getSession,
  ensureProfile,
  fetchMemberships,
  fetchRestaurantSegment,
  createCompanyWithOwner,
  signUpRestaurant,
  provisionCompanyForCurrentUser,
  slugifyCompanyName,
  ONBOARDING_SEGMENT_SLUG,
} from './supabaseAuth.js';

// Mock do client Supabase (sem rede). Cadeias .select().eq()... são thenables
// que resolvem { data, error }; terminais .single()/.maybeSingle() idem.
function createMockClient({ auth = {}, tables = {}, rpcResult = { data: 'company-id-1', error: null } } = {}) {
  const calls = { rpc: [], insert: [], authCalls: [] };
  const table = (name) => {
    const cfg = tables[name] || {};
    let mode = 'select';
    const chain = {
      select: () => chain,
      eq: () => chain,
      insert: (payload) => {
        mode = 'insert';
        calls.insert.push({ table: name, payload });
        return chain;
      },
      single: async () => (mode === 'insert' ? cfg.insert : cfg.select) || { data: null, error: null },
      maybeSingle: async () => (mode === 'insert' ? cfg.insert : cfg.select) || { data: null, error: null },
      then: (resolve, reject) => {
        try {
          resolve(cfg.select || { data: null, error: null });
        } catch (e) {
          reject(e);
        }
      },
    };
    return chain;
  };
  return {
    calls,
    auth: {
      signUp: async (args) => {
        calls.authCalls.push({ op: 'signUp', args });
        return auth.signUp || { data: { user: { id: 'u1', email: args.email }, session: { access_token: 't' } }, error: null };
      },
      signInWithPassword: async (args) => {
        calls.authCalls.push({ op: 'signIn', args });
        return auth.signIn || { data: { user: { id: 'u1' }, session: { access_token: 't' } }, error: null };
      },
      signOut: async () => {
        calls.authCalls.push({ op: 'signOut' });
        return auth.signOut || { error: null };
      },
      getSession: async () => auth.session || { data: { session: null }, error: null },
      onAuthStateChange: (cb) => {
        calls.authCalls.push({ op: 'onAuthStateChange' });
        return { data: { subscription: { unsubscribe: () => {} } }, __cb: cb };
      },
    },
    from: (name) => table(name),
    rpc: async (fn, args) => {
      calls.rpc.push({ fn, args });
      return rpcResult;
    },
  };
}

describe('supabaseAuth — sessão', () => {
  it('usuário não autenticado: getSession retorna null', async () => {
    const client = createMockClient();
    assert.equal(await getSession(client), null);
  });

  it('login cria sessão', async () => {
    const client = createMockClient({
      auth: { signIn: { data: { user: { id: 'u1' }, session: { access_token: 'tok' } }, error: null } },
    });
    const data = await signInWithPassword(client, { email: 'a@x.com', password: '123456' });
    assert.equal(data.session.access_token, 'tok');
  });

  it('logout chama signOut do client', async () => {
    const client = createMockClient();
    await signOut(client);
    assert.deepEqual(client.calls.authCalls, [{ op: 'signOut' }]);
  });

  it('sem configuração, operações lançam erro claro', async () => {
    await assert.rejects(() => signInWithPassword(null, { email: 'a', password: 'b' }), /não configurado/);
  });
});

describe('supabaseAuth — profile', () => {
  it('profile existente é retornado sem INSERT', async () => {
    const profile = { id: 'u1', platform_role: 'USER' };
    const client = createMockClient({ tables: { profiles: { select: { data: profile, error: null } } } });
    assert.deepEqual(await ensureProfile(client, { id: 'u1', email: 'a@x.com' }), profile);
    assert.equal(client.calls.insert.length, 0);
  });

  it('profile ausente é criado com id do auth e role USER', async () => {
    const created = { id: 'u1', platform_role: 'USER' };
    const client = createMockClient({
      tables: { profiles: { select: { data: null, error: null }, insert: { data: created, error: null } } },
    });
    assert.deepEqual(await ensureProfile(client, { id: 'u1', email: 'user@mail.com' }), created);
    assert.equal(client.calls.insert.length, 1);
    assert.deepEqual(client.calls.insert[0].payload, {
      id: 'u1',
      email: 'user@mail.com',
      name: 'user',
      platform_role: 'USER',
    });
  });
});

describe('supabaseAuth — memberships/role', () => {
  it('carrega memberships com empresa e role', async () => {
    const rows = [
      { company_id: 'c1', role: 'OWNER', active: true, companies: { id: 'c1', name: 'Loja', slug: 'loja', active: true, is_open: true } },
    ];
    const client = createMockClient({ tables: { company_members: { select: { data: rows, error: null } } } });
    const members = await fetchMemberships(client, 'u1');
    assert.deepEqual(members, [{ companyId: 'c1', role: 'OWNER', company: { id: 'c1', name: 'Loja', slug: 'loja', active: true, is_open: true } }]);
  });

  it('usuário sem empresa retorna lista vazia (tratável pela UI)', async () => {
    const client = createMockClient({ tables: { company_members: { select: { data: [], error: null } } } });
    assert.deepEqual(await fetchMemberships(client, 'u9'), []);
  });
});

describe('supabaseAuth — criação de empresa', () => {
  it('usa segmento Restaurante', () => {
    assert.equal(ONBOARDING_SEGMENT_SLUG, 'restaurant');
  });

  it('fetchRestaurantSegment busca slug restaurant ativo', async () => {
    const seg = { id: 'seg1', slug: 'restaurant', name: 'Restaurante' };
    const client = createMockClient({ tables: { business_segments: { select: { data: seg, error: null } } } });
    assert.deepEqual(await fetchRestaurantSegment(client), seg);
  });

  it('create_company_with_owner via RPC (nunca INSERT direto)', async () => {
    const client = createMockClient();
    const id = await createCompanyWithOwner(client, { name: 'Minha Loja', segmentId: 'seg1' });
    assert.equal(id, 'company-id-1');
    assert.equal(client.calls.rpc.length, 1);
    assert.equal(client.calls.rpc[0].fn, 'create_company_with_owner');
    assert.deepEqual(client.calls.rpc[0].args, {
      p_name: 'Minha Loja',
      p_slug: 'minha-loja',
      p_segment_id: 'seg1',
      p_description: null,
      p_phone: null,
      p_email: null,
      p_address: null,
    });
    assert.equal(client.calls.insert.filter((c) => ['companies', 'company_members'].includes(c.table)).length, 0);
  });

  it('fluxo signUpRestaurant encadeia Auth → profile → segmento → RPC → memberships', async () => {
    const seg = { id: 'seg1', slug: 'restaurant', name: 'Restaurante' };
    const members = [{ company_id: 'c9', role: 'OWNER', active: true, companies: { id: 'c9', name: 'L', slug: 'l', active: true } }];
    const client = createMockClient({
      tables: {
        profiles: { select: { data: null, error: null }, insert: { data: { id: 'u1' }, error: null } },
        business_segments: { select: { data: seg, error: null } },
        company_members: { select: { data: members, error: null } },
      },
      rpcResult: { data: 'c9', error: null },
    });
    const out = await signUpRestaurant(client, { email: 'n@x.com', password: '123456', companyName: 'Loja Nova' });
    assert.equal(out.companyId, 'c9');
    assert.equal(out.memberships.length, 1);
    assert.equal(out.memberships[0].role, 'OWNER');
    // empresa criada possui OWNER + subscription é efeito da DEFINER (coberta pelo teste SQL 9a–9c)
  });

  it('slugify gera slug válido', () => {
    assert.equal(slugifyCompanyName('Minha Loja!'), 'minha-loja');
    assert.equal(slugifyCompanyName('  '), '');
  });

  it('signUp sem password válido propaga erro do Auth', async () => {
    const client = createMockClient({ auth: { signUp: { data: { user: null, session: null }, error: new Error('weak password') } } });
    await assert.rejects(() => signUpWithPassword(client, { email: 'a@x.com', password: '1' }), /weak password/);
  });
});

describe('supabaseAuth — onboarding usuário autenticado (correção create restaurant)', () => {
  const seg = { id: 'seg1', slug: 'restaurant', name: 'Restaurante' };
  const members = [{ company_id: 'c9', role: 'OWNER', active: true, companies: { id: 'c9', name: 'L', slug: 'l', active: true } }];

  function authedClient() {
    return createMockClient({
      auth: { session: { data: { session: { user: { id: 'u1', email: 'n@x.com' } } }, error: null } },
      tables: {
        profiles: { select: { data: { id: 'u1' }, error: null } },
        business_segments: { select: { data: seg, error: null } },
        company_members: { select: { data: [], error: null } },
      },
      rpcResult: { data: 'c9', error: null },
    });
  }

  it('NÃO refaz signup: usa sessão, cria empresa (created true)', async () => {
    const client = authedClient();
    const out = await provisionCompanyForCurrentUser(client, { companyName: 'Loja Nova' });
    assert.equal(out.companyId, 'c9');
    assert.equal(out.created, true);
    assert.ok(client.calls.authCalls.every((c) => c.op !== 'signUp'), 'signup não deve ser chamado');
    assert.equal(client.calls.rpc.length, 1);
  });

  it('com empresa existente: não cria outra (created false, sem RPC)', async () => {
    const client = authedClient();
    client.from = ((orig) => (name) => {
      if (name === 'company_members') {
        const chain = {
          select: () => chain,
          eq: () => chain,
          then: (resolve) => resolve({ data: members, error: null }),
        };
        return chain;
      }
      return orig(name);
    })(client.from);
    const out = await provisionCompanyForCurrentUser(client, { companyName: 'Outra' });
    assert.equal(out.companyId, 'c9');
    assert.equal(out.created, false);
    assert.equal(client.calls.rpc.length, 0);
  });

  it('sem sessão: erro claro (entrar novamente)', async () => {
    const client = createMockClient();
    await assert.rejects(() => provisionCompanyForCurrentUser(client, { companyName: 'X' }), /Sessão não encontrada/);
  });
});
