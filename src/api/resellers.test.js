import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  RESELLER_PRODUCT, RESELLER_MODALITY, RESELLER_STATUSES,
  resellerStatusLabel, allowedResellerTransitions, validateResellerTransition,
  isValidInviteToken, validateInviteForm,
  buildResellerInviteLink, buildResellerInviteMessage, buildResellerInviteUrl,
  buildResellerAccessMessage, buildResellerAccessUrl,
  validateResellerEmail, normalizeResellerEmail,
  fromSupabaseInvite, fromSupabaseReseller, appendResellerEvent,
  createResellerInvite, resolveResellerInvite, claimResellerInvite,
  listResellerInvites, listResellers, getResellerInvite, updateResellerInvite,
  sweepExpiredInvites,
} from './resellers.js';

function createMockClient({ rpcs = {}, rows = {} } = {}) {
  const calls = { rpc: [], update: [] };
  const table = (name) => {
    const cfg = rows[name] || {};
    const chain = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: () => chain,
      update: (p) => { calls.update.push({ table: name, payload: p }); return chain; },
      single: async () => cfg.single || { data: null, error: null },
      maybeSingle: async () => cfg.maybeSingle || { data: null, error: null },
      then: (resolve) => { resolve(cfg.list || { data: [], error: null }); },
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

const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'.slice(0, 32);

describe('resellers — catálogo e ciclo de vida', () => {
  it('produto Dellyvery e modalidade Parceiro fixos', () => {
    assert.equal(RESELLER_PRODUCT.id, 'dellyvery');
    assert.equal(RESELLER_MODALITY.id, 'parceiro');
  });

  it('labels de status cobrem todo o ciclo', () => {
    assert.equal(resellerStatusLabel('criado'), 'Convite criado');
    assert.equal(resellerStatusLabel('aguardando_aprovacao'), 'Aguardando aprovação');
    assert.equal(resellerStatusLabel('aprovado'), 'Aprovado');
    assert.equal(resellerStatusLabel('xx'), 'xx');
    assert.ok(RESELLER_STATUSES.some((s) => s.id === 'suspenso'));
  });

  it('transições: aprovação/recusa só de pendente; sem pular etapas', () => {
    assert.deepEqual(allowedResellerTransitions('criado'), ['enviado', 'revogado']);
    assert.deepEqual(allowedResellerTransitions('aguardando_aprovacao'), ['aprovado', 'recusado']);
    assert.deepEqual(allowedResellerTransitions('aprovado'), ['suspenso', 'revogado']);
    assert.deepEqual(allowedResellerTransitions('suspenso'), ['aprovado', 'revogado']);
    assert.deepEqual(allowedResellerTransitions('recusado'), []);
    assert.deepEqual(allowedResellerTransitions('revogado'), []);
    assert.equal(validateResellerTransition('aguardando_aprovacao', 'aprovado'), null);
    assert.equal(validateResellerTransition('aguardando_aprovacao', 'recusado'), null);
    assert.equal(validateResellerTransition('aprovado', 'revogado'), null);
    assert.equal(validateResellerTransition('suspenso', 'revogado'), null);
    assert.match(validateResellerTransition('criado', 'aprovado'), /inválida/);
    assert.match(validateResellerTransition('enviado', 'aprovado'), /inválida/);
    assert.match(validateResellerTransition('recusado', 'aprovado'), /inválida/);
    assert.match(validateResellerTransition('revogado', 'aprovado'), /inválida/);
    assert.match(validateResellerTransition('criado', 'xx'), /inválido/);
  });
});

describe('resellers — convite e WhatsApp', () => {
  it('token: 32 hex, sem adivinhação', () => {
    assert.ok(isValidInviteToken(TOKEN));
    assert.ok(!isValidInviteToken('123'));
    assert.ok(!isValidInviteToken('g'.repeat(32)));
    assert.ok(!isValidInviteToken(null));
  });

  it('validação do formulário de convite (nome + WhatsApp com ou sem DDI)', () => {
    assert.equal(validateInviteForm({ name: 'João Silva', phone: '+55 (11) 99999-9999' }), null);
    assert.equal(validateInviteForm({ name: 'João Silva', phone: '(11) 99999-9999' }), null);
    assert.match(validateInviteForm({ name: '', phone: '5511999999999' }), /nome/i);
    assert.match(validateInviteForm({ name: 'J', phone: '5511999999999' }), /nome/i);
    assert.match(validateInviteForm({ name: 'João', phone: 'abc' }), /WhatsApp/);
    assert.match(validateInviteForm({ name: 'João', phone: '123' }), /WhatsApp/);
  });

  it('link exclusivo por token', () => {
    assert.equal(
      buildResellerInviteLink('https://app.exemplo.com', TOKEN),
      `https://app.exemplo.com/cadastro?convite=${TOKEN}`,
    );
    assert.equal(
      buildResellerInviteLink('https://app.exemplo.com/', TOKEN),
      `https://app.exemplo.com/cadastro?convite=${TOKEN}`,
    );
    assert.throws(() => buildResellerInviteLink('https://x.com', 'invalido'), /inválido/);
    assert.throws(() => buildResellerInviteLink('', TOKEN), /Origem/);
  });

  it('mensagem de convite com nome e link, sem afirmar envio', () => {
    const msg = buildResellerInviteMessage({ name: 'João Silva', link: 'https://x/cadastro?convite=abc' });
    assert.ok(msg.includes('João'));
    assert.ok(msg.includes('https://x/cadastro?convite=abc'));
    assert.ok(msg.includes('parceiros do Dellyvery'));
    assert.ok(!/mensagem enviada|enviado com sucesso|entregue/i.test(msg));
  });

  it('URL wa.me abre conversa com mensagem pronta (envio manual)', () => {
    const url = buildResellerInviteUrl({ phone: '5511999999999', name: 'João', link: 'https://x/l' });
    assert.ok(url.startsWith('https://wa.me/5511999999999?text='));
    assert.throws(() => buildResellerInviteUrl({ phone: 'invalido', name: 'J', link: 'https://x' }), /inválido/);
  });

  it('e-mail de acesso é validado e normalizado (chave exata do vínculo)', () => {
    assert.equal(validateResellerEmail('  REVENDEDOR@Exemplo.COM '), null);
    assert.equal(normalizeResellerEmail('  REVENDEDOR@Exemplo.COM '), 'revendedor@exemplo.com');
    assert.match(validateResellerEmail(''), /Informe/);
    assert.match(validateResellerEmail('sem-arroba'), /inválido/i);
    assert.match(validateResellerEmail('a@b'), /inválido/i);
  });

  it('mensagem de acesso aprovado usa link pessoal e não promete envio', () => {
    const msg = buildResellerAccessMessage({ name: 'Maria Souza', link: 'https://x/magic' });
    assert.ok(msg.includes('Maria'));
    assert.ok(msg.includes('https://x/magic'));
    assert.ok(msg.includes('Área do Revendedor'));
    assert.ok(!/mensagem enviada|enviado com sucesso|entregue/i.test(msg));
  });

  it('URL de acesso normaliza WhatsApp e rejeita telefone inválido', () => {
    const url = buildResellerAccessUrl({
      phone: '5511999999999',
      name: 'Maria',
      link: 'https://x/magic',
    });
    assert.ok(url.startsWith('https://wa.me/5511999999999?text='));
    assert.throws(
      () => buildResellerAccessUrl({ phone: '', name: 'M', link: 'https://x' }),
      /inválido/,
    );
  });
});

describe('resellers — mapeamento e eventos', () => {
  it('fromSupabaseInvite normaliza registro e eventos', () => {
    const a = fromSupabaseInvite({
      id: 'i1', token: TOKEN, name: 'João', phone: '5511999999999', status: 'aguardando_aprovacao',
      registration: { full_name: 'João', city: 'SP' }, events: [{ action: 'criado' }],
    });
    assert.equal(a.product, 'dellyvery');
    assert.equal(a.modality, 'parceiro');
    assert.equal(a.registration.city, 'SP');
    assert.equal(a.token, TOKEN); // admin remonta o link p/ reenvio
    assert.equal(fromSupabaseInvite({}).status, 'criado');
  });

  it('appendResellerEvent nunca edita anteriores', () => {
    const prev = [{ action: 'criado' }];
    const next = appendResellerEvent(prev, 'aprovado', { de: 'aguardando_aprovacao' }, 'u1');
    assert.equal(prev.length, 1);
    assert.equal(next.length, 2);
    assert.equal(next[1].by, 'u1');
  });

  it('fromSupabaseReseller normaliza o vínculo de acesso', () => {
    const r = fromSupabaseReseller({
      id: 'r1',
      user_id: 'u1',
      invite_id: 'i1',
      status: 'suspenso',
      approved_at: '2026-10-01T00:00:00Z',
      suspended_at: '2026-10-02T00:00:00Z',
    });
    assert.equal(r.status, 'suspenso');
    assert.equal(r.invite_id, 'i1');
    assert.equal(r.approved_at, '2026-10-01T00:00:00Z');
    assert.equal(fromSupabaseReseller({}).status, 'ativo');
  });
});

describe('resellers — adapter (RPCs + RLS admin)', () => {
  it('create valida antes da rede e chama RPC oficial', async () => {
    const client = createMockClient({
      rpcs: { create_reseller_invite: { data: { invite_id: 'i1', token: TOKEN, reused: false }, error: null } },
    });
    await assert.rejects(createResellerInvite(client, { name: '', phone: '5511999999999' }), /nome/i);
    await assert.rejects(createResellerInvite(client, { name: 'João', phone: 'xx' }), /WhatsApp/);
    assert.equal(client.calls.rpc.length, 0);
    const out = await createResellerInvite(client, { name: 'João', phone: '5511999999999' });
    assert.equal(out.token, TOKEN);
    assert.equal(client.calls.rpc[0].fn, 'create_reseller_invite');
    // Telefone normalizado com DDI antes da RPC (exige ^55…).
    assert.equal(client.calls.rpc[0].args.p_phone, '5511999999999');
  });

  it('resolve/claim exigem token válido', async () => {
    const client = createMockClient({
      rpcs: {
        resolve_reseller_invite: { data: { name: 'João', status: 'enviado' }, error: null },
        claim_reseller_invite: { data: { invite_id: 'i1', status: 'aguardando_aprovacao' }, error: null },
      },
    });
    await assert.rejects(resolveResellerInvite(client, 'curto'), /identificado/);
    await assert.rejects(claimResellerInvite(client, 'curto', {}), /identificado/);
    const r = await resolveResellerInvite(client, TOKEN);
    assert.equal(r.name, 'João');
    const c = await claimResellerInvite(client, TOKEN, { full_name: 'João' });
    assert.equal(c.status, 'aguardando_aprovacao');
  });

  it('update valida transição e edita via RLS (sem RPC)', async () => {
    const row = { id: 'i1', name: 'João', status: 'aguardando_aprovacao', events: [] };
    const client = createMockClient({
      rows: { reseller_invites: { maybeSingle: { data: row, error: null }, single: { data: row, error: null } } },
    });
    await assert.rejects(updateResellerInvite(client, '', {}, null, 'u1'), /identificado/);
    await assert.rejects(
      updateResellerInvite(client, 'i1', { status: 'suspenso' }, null, 'u1'),
      /inválida/,
    );
    await updateResellerInvite(client, 'i1', { status: 'aprovado' }, { action: 'aprovado' }, 'u1');
    const u = client.calls.update[0];
    assert.equal(u.payload.status, 'aprovado');
    assert.equal(u.payload.events.length, 1);
  });

  it('list/get normalizam linhas', async () => {
    const client = createMockClient({
      rows: {
        reseller_invites: {
          list: { data: [{ id: 'i1', status: 'aprovado' }], error: null },
          maybeSingle: { data: { id: 'i1', status: 'aprovado' }, error: null },
        },
      },
    });
    const list = await listResellerInvites(client, {});
    assert.equal(list.length, 1);
    assert.equal(list[0].product, 'dellyvery');
    assert.equal((await getResellerInvite(client, 'i1')).status, 'aprovado');
    await assert.rejects(getResellerInvite(client, ''), /identificado/);
  });

  it('sweepExpiredInvites chama RPC oficial', async () => {
    const client = createMockClient({
      rpcs: { sweep_expired_reseller_invites: { data: { swept: 2 }, error: null } },
    });
    const out = await sweepExpiredInvites(client);
    assert.equal(out.swept, 2);
    assert.equal(client.calls.rpc[0].fn, 'sweep_expired_reseller_invites');
  });

  it('listResellers lê o vínculo via RLS e normaliza', async () => {
    const client = createMockClient({
      rows: {
        resellers: {
          list: {
            data: [{ id: 'r1', user_id: 'u1', invite_id: 'i1', status: 'ativo' }],
            error: null,
          },
        },
      },
    });
    const list = await listResellers(client);
    assert.equal(list.length, 1);
    assert.equal(list[0].invite_id, 'i1');
    assert.equal(list[0].status, 'ativo');
  });
});
