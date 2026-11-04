import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  RESELLER_CLIENT_STATUSES, resellerClientStatusLabel,
  validateResellerClientForm, fromSupabaseResellerClient,
  toSupabaseResellerClient, toSupabaseResellerClientPatch,
  listResellerClients, createResellerClient, updateResellerClient,
  resellerInviteStatusLabel, fromSupabaseResellerInvite, listResellerClientInvites,
  createResellerClientInvite, revokeResellerClientInvite,
  resolveResellerClientInvite, claimResellerClientInvite, getMyResellerClientAccess,
  requestResellerInviteEmailProof, verifyResellerInviteEmailProof,
} from './resellerClients.js';
import {
  RESELLER_CREDIT_KINDS, RESELLER_ACTIVATION_STATUSES,
  creditKindLabel, activationStatusLabel, localISODate,
  validateActivationForm, fromSupabaseCreditEntry, fromSupabaseActivation,
  summarizeCreditEntries, listResellerCreditEntries, listResellerActivations,
  getResellerCreditBalance, grantResellerCredits, activateResellerClient,
  createActivationIdempotencyKey,
} from './resellerCredits.js';

function createMockClient({ tables = {}, rpcs = {}, functions = {} } = {}) {
  const calls = { rpc: [], insert: [], update: [], filters: [], functions: [] };
  const table = (name) => {
    const cfg = tables[name] || {};
    const chain = {
      select: () => chain,
      insert: (payload) => {
        calls.insert.push({ table: name, payload });
        return chain;
      },
      update: (payload) => {
        calls.update.push({ table: name, payload });
        return chain;
      },
      eq: (col, value) => {
        calls.filters.push({ table: name, col, value });
        return chain;
      },
      order: () => chain,
      limit: () => chain,
      single: async () => cfg.single || { data: null, error: null },
      then: (resolve) => resolve(cfg.list || { data: [], error: null }),
    };
    return chain;
  };
  return {
    calls,
    from: table,
    rpc: async (fn, args) => {
      calls.rpc.push({ fn, args });
      return rpcs[fn] || { data: null, error: null };
    },
    functions: {
      invoke: async (name, opts) => {
        calls.functions.push({ name, opts });
        return functions[name] || { data: { ok: true }, error: null };
      },
    },
  };
}

describe('resellerClients - validacao e mapeamento', () => {
  it('status do cliente sao prospecto, ativo e inativo', () => {
    assert.deepEqual(RESELLER_CLIENT_STATUSES.map((item) => item.id), ['prospecto', 'ativo', 'inativo']);
    assert.equal(resellerClientStatusLabel('ativo'), 'Ativo');
    assert.equal(resellerClientStatusLabel('xx'), 'xx');
  });

  it('exige nome e valida email/status', () => {
    assert.match(validateResellerClientForm({}), /nome/i);
    assert.equal(validateResellerClientForm({ name: 'Cantina' }), null);
    assert.match(validateResellerClientForm({ name: 'Cantina', email: 'x' }), /E-mail/);
    assert.match(validateResellerClientForm({ name: 'Cantina', status: 'novo' }), /Status/);
    assert.equal(validateResellerClientForm({ email: 'a@b.com' }, { partial: true }), null);
  });

  it('normaliza textos e preserva somente campos conhecidos', () => {
    const payload = toSupabaseResellerClient('r1', {
      name: '  Cantina  ', phone: ' 1199 ', status: 'ativo', hacker: true,
    });
    assert.deepEqual(payload, {
      reseller_id: 'r1',
      status: 'ativo',
      name: 'Cantina',
      trade_name: '',
      document: '',
      phone: '1199',
      email: '',
      city: '',
      state: '',
      notes: '',
    });
    assert.deepEqual(toSupabaseResellerClientPatch({ name: ' X ', city: ' SP ' }), { name: 'X', city: 'SP' });
    assert.throws(() => toSupabaseResellerClient('', { name: 'X' }), /Revendedor/);
  });

  it('mapeia linha do banco com defaults seguros', () => {
    assert.deepEqual(fromSupabaseResellerClient({ id: 'c1' }), {
      id: 'c1',
      reseller_id: undefined,
      name: '',
      trade_name: '',
      document: '',
      phone: '',
      email: '',
      city: '',
      state: '',
      notes: '',
      status: 'prospecto',
      user_id: null,
      company_id: null,
      activated_at: null,
      access_expires_at: null,
      created_by: null,
      created_at: null,
      updated_at: null,
    });
  });
});

describe('resellerClients - operacoes', () => {
  it('lista sempre ordenada e filtra pelo revendedor', async () => {
    const client = createMockClient({
      tables: { reseller_clients: { list: { data: [{ id: 'c1', name: 'Cantina' }], error: null } } },
    });
    const out = await listResellerClients(client, 'r1');
    assert.equal(out[0].name, 'Cantina');
    assert.ok(client.calls.filters.some((f) => f.col === 'reseller_id' && f.value === 'r1'));
  });

  it('cria cliente com escopo do revendedor e rejeita nome vazio antes da rede', async () => {
    const client = createMockClient({
      tables: { reseller_clients: { single: { data: { id: 'c1', name: 'Cantina' }, error: null } } },
    });
    const created = await createResellerClient(client, 'r1', { name: 'Cantina' });
    assert.equal(created.id, 'c1');
    assert.equal(client.calls.insert[0].payload.reseller_id, 'r1');
    await assert.rejects(() => createResellerClient(client, 'r1', { name: '  ' }), /nome/i);
  });

  it('atualiza somente o cliente do revendedor', async () => {
    const client = createMockClient({
      tables: { reseller_clients: { single: { data: { id: 'c1', name: 'Novo' }, error: null } } },
    });
    await updateResellerClient(client, 'r1', 'c1', { name: 'Novo' });
    assert.deepEqual(client.calls.update[0].payload, { name: 'Novo' });
    const scoped = client.calls.filters.filter((f) => f.table === 'reseller_clients');
    assert.ok(scoped.some((f) => f.col === 'id' && f.value === 'c1'));
    assert.ok(scoped.some((f) => f.col === 'reseller_id' && f.value === 'r1'));
  });
});

describe('resellerCredits - labels, datas e validacao', () => {
  it('catalogo de movimentacoes e status de ativacao', () => {
    assert.deepEqual(RESELLER_CREDIT_KINDS.map((item) => item.id), ['credito', 'compra', 'ajuste', 'ativacao', 'estorno']);
    assert.equal(creditKindLabel('ativacao'), 'Ativação');
    assert.deepEqual(RESELLER_ACTIVATION_STATUSES.map((item) => item.id), ['ativa', 'vencida', 'cancelada']);
    assert.equal(activationStatusLabel('vencida'), 'Vencida');
  });

  it('data local nao sofre deslocamento de UTC', () => {
    assert.equal(localISODate(new Date(2026, 0, 2, 23, 59)), '2026-01-02');
    assert.equal(localISODate('invalida'), '');
  });

  it('valida cliente e plano; duracao vem do plano', () => {
    const base = { clientId: 'c1', planId: 'p1', credits: 2, startsOn: '2026-11-01', expiresOn: '2026-12-01' };
    assert.equal(validateActivationForm(base), null);
    assert.equal(validateActivationForm({ clientId: 'c1', planId: 'p1' }), null);
    assert.match(validateActivationForm({ ...base, clientId: '' }), /cliente/i);
    assert.match(validateActivationForm({ ...base, planId: '' }), /plano/i);
  });

  it('mapeia extrato e resumo', () => {
    assert.deepEqual(fromSupabaseCreditEntry({ id: 'e1', amount: '5' }), {
      id: 'e1',
      reseller_id: undefined,
      activation_id: null,
      purchase_order_id: null,
      kind: 'ajuste',
      amount: 5,
      reason: '',
      created_by: null,
      created_at: null,
    });
    assert.deepEqual(summarizeCreditEntries([
      { amount: 10 }, { amount: -3 }, { amount: 2 }, { amount: 0 },
    ]), { credited: 12, consumed: 3 });
  });

  it('calcula status vencido na leitura sem alterar o banco', () => {
    const active = fromSupabaseActivation({ id: 'a1', status: 'ativa', expires_on: '2026-12-01' }, '2026-11-01');
    assert.equal(active.status, 'ativa');
    const expired = fromSupabaseActivation({ id: 'a2', status: 'ativa', expires_on: '2026-10-01' }, '2026-11-01');
    assert.equal(expired.status, 'vencida');
    const renewed = fromSupabaseActivation({
      id: 'a4',
      status: 'ativa',
      expires_on: '2026-10-01',
      new_expires_at: '2026-12-01T12:00:00Z',
      access_days: 30,
      kind: 'renewal',
    }, '2026-11-01');
    assert.equal(renewed.status, 'ativa');
    assert.equal(renewed.access_days, 30);
    assert.equal(renewed.kind, 'renewal');
    assert.equal(renewed.expires_on, '2026-12-01T12:00:00Z');
    const cancelled = fromSupabaseActivation({ id: 'a3', status: 'cancelada', expires_on: '2026-10-01' }, '2026-11-01');
    assert.equal(cancelled.status, 'cancelada');
  });
});

describe('resellerCredits - RPCs e leitura', () => {
  it('lista extrato e ativacoes com escopo do revendedor', async () => {
    const client = createMockClient({
      tables: {
        reseller_credit_entries: { list: { data: [{ id: 'e1', amount: 3 }], error: null } },
        reseller_activations: { list: { data: [{ id: 'a1', status: 'ativa', expires_on: '2099-01-01' }], error: null } },
      },
    });
    const entries = await listResellerCreditEntries(client, 'r1');
    const activations = await listResellerActivations(client, 'r1', { today: '2026-11-01' });
    assert.equal(entries[0].amount, 3);
    assert.equal(activations[0].status, 'ativa');
    assert.equal(client.calls.filters.filter((f) => f.value === 'r1').length, 2);
  });

  it('consulta saldo por RPC', async () => {
    const client = createMockClient({ rpcs: { reseller_credit_balance: { data: 7, error: null } } });
    assert.equal(await getResellerCreditBalance(client, 'r1'), 7);
    assert.deepEqual(client.calls.rpc[0], { fn: 'reseller_credit_balance', args: { p_reseller_id: 'r1' } });
  });

  it('concede creditos via RPC e valida quantidade', async () => {
    const client = createMockClient({
      rpcs: { grant_reseller_credits: { data: { balance: 10 }, error: null } },
    });
    const out = await grantResellerCredits(client, 'r1', 10, '  Pacote  ');
    assert.equal(out.balance, 10);
    assert.deepEqual(client.calls.rpc[0], {
      fn: 'grant_reseller_credits',
      args: { p_reseller_id: 'r1', p_amount: 10, p_reason: 'Pacote' },
    });
    await assert.rejects(() => grantResellerCredits(client, 'r1', 0), /maior que zero/);
  });

  it('ativa/renova com 1 credito e chave de idempotencia via RPC v2', async () => {
    const client = createMockClient({
      rpcs: { activate_reseller_client_v2: { data: { activation_id: 'a1', balance: 8 }, error: null } },
    });
    const out = await activateResellerClient(client, {
      clientId: 'c1', planId: 'p1', idempotencyKey: '00000000-0000-4000-8000-000000000001',
    });
    assert.equal(out.activation_id, 'a1');
    assert.deepEqual(client.calls.rpc[0], {
      fn: 'activate_reseller_client_v2',
      args: {
        p_client_id: 'c1',
        p_plan_id: 'p1',
        p_idempotency_key: '00000000-0000-4000-8000-000000000001',
      },
    });
    assert.match(createActivationIdempotencyKey(), /^[0-9a-f-]{36}$/i);
  });
});

describe('resellerClients - convites e acesso', () => {
  it('mapeia convites e status', () => {
    assert.equal(resellerInviteStatusLabel('pending'), 'Aguardando cadastro');
    assert.deepEqual(fromSupabaseResellerInvite({
      invite_id: 'i1', client_id: 'c1', invited_email: 'a@b.com', status: 'expired',
    }), {
      id: 'i1',
      reseller_id: null,
      client_id: 'c1',
      email: 'a@b.com',
      status: 'expired',
      expires_at: null,
      accepted_by: null,
      accepted_at: null,
      revoked_at: null,
      created_at: null,
    });
  });

  it('chama RPCs de convite e acesso', async () => {
    const client = createMockClient({
      rpcs: {
        create_reseller_client_invite: { data: { invite_id: 'i1', token: 'tok' }, error: null },
        revoke_reseller_client_invite: { data: { status: 'revoked' }, error: null },
        resolve_reseller_client_invite: { data: { status: 'pending' }, error: null },
        claim_reseller_client_invite: { data: { status: 'accepted' }, error: null },
        get_my_reseller_client_access: { data: { status: 'pending' }, error: null },
        list_reseller_client_invites: {
          data: [{ invite_id: 'i1', client_id: 'c1', invited_email: 'a@b.com', status: 'pending' }],
          error: null,
        },
      },
    });

    assert.equal((await createResellerClientInvite(client, 'c1')).invite_id, 'i1');
    assert.equal((await revokeResellerClientInvite(client, 'i1')).status, 'revoked');
    assert.equal((await resolveResellerClientInvite(client, 'tok')).status, 'pending');
    assert.equal((await claimResellerClientInvite(client, 'tok')).status, 'accepted');
    assert.equal((await getMyResellerClientAccess(client)).status, 'pending');
    const invites = await listResellerClientInvites(client);
    assert.equal(invites[0].id, 'i1');
    assert.equal(invites[0].email, 'a@b.com');

    assert.deepEqual(client.calls.rpc.map((call) => call.fn), [
      'create_reseller_client_invite',
      'revoke_reseller_client_invite',
      'resolve_reseller_client_invite',
      'claim_reseller_client_invite',
      'get_my_reseller_client_access',
      'list_reseller_client_invites',
    ]);
    assert.deepEqual(client.calls.rpc[0].args, { p_client_id: 'c1' });
    assert.deepEqual(client.calls.rpc[2].args, { p_token: 'tok' });
  });

  it('envia e confirma codigo pela Edge Function de prova', async () => {
    const client = createMockClient({
      functions: {
        'reseller-invite-email-proof': { data: { ok: true, sent: true }, error: null },
      },
    });

    const requested = await requestResellerInviteEmailProof(client, 'tok');
    assert.equal(requested.sent, true);
    assert.equal((await verifyResellerInviteEmailProof(client, 'tok', ' 123456 ')).ok, true);
    assert.deepEqual(client.calls.functions, [
      {
        name: 'reseller-invite-email-proof',
        opts: { body: { action: 'request', inviteToken: 'tok' } },
      },
      {
        name: 'reseller-invite-email-proof',
        opts: { body: { action: 'verify', inviteToken: 'tok', code: '123456' } },
      },
    ]);
  });

  it('recusa codigo invalido e servico indisponivel', async () => {
    await assert.rejects(() => verifyResellerInviteEmailProof(createMockClient(), 'tok', '12'), /6 digitos/);
    await assert.rejects(() => requestResellerInviteEmailProof({}, 'tok'), /indisponivel/);
    await assert.rejects(() => requestResellerInviteEmailProof(createMockClient(), ''), /identificado/);
  });

  it('extrai mensagem publica do erro da Edge Function', async () => {
    const client = createMockClient({
      functions: {
        'reseller-invite-email-proof': {
          data: null,
          error: {
            message: 'Edge Function returned a non-2xx status code',
            context: { json: async () => ({ error: 'Codigo invalido ou expirado' }) },
          },
        },
      },
    });

    await assert.rejects(
      () => verifyResellerInviteEmailProof(client, 'tok', '123456'),
      /Codigo invalido ou expirado/,
    );
  });
});
