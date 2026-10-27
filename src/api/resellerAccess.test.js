import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getResellerAccess, approveResellerAccess } from './resellerAccess.js';

function createReadClient(result) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => result,
  };
  return { from: () => chain };
}

const ROW = {
  id: 'r1',
  user_id: 'u1',
  invite_id: 'i1',
  status: 'ativo',
  approved_at: '2026-10-01T00:00:00Z',
};

describe('resellerAccess — leitura do vínculo (RLS)', () => {
  it('sem sessão não consulta e nega acesso', async () => {
    let called = false;
    const client = { from: () => { called = true; } };
    const out = await getResellerAccess(client, null);
    assert.equal(out.status, 'denied');
    assert.equal(called, false);
  });

  it('vínculo ativo libera e devolve o registro', async () => {
    const out = await getResellerAccess(createReadClient({ data: ROW, error: null }), 'u1');
    assert.equal(out.status, 'allowed');
    assert.equal(out.reseller.id, 'r1');
  });

  it('suspenso e inativo não liberam a área', async () => {
    const suspended = await getResellerAccess(
      createReadClient({ data: { ...ROW, status: 'suspenso' }, error: null }),
      'u1',
    );
    assert.equal(suspended.status, 'suspended');

    const inactive = await getResellerAccess(
      createReadClient({ data: { ...ROW, status: 'inativo' }, error: null }),
      'u1',
    );
    assert.equal(inactive.status, 'denied');
  });

  it('sem linha (RLS) nega; erro de rede é distinguível de erro genérico', async () => {
    const denied = await getResellerAccess(createReadClient({ data: null, error: null }), 'u1');
    assert.equal(denied.status, 'denied');

    const network = await getResellerAccess(
      createReadClient({ data: null, error: { message: 'Failed to fetch' } }),
      'u1',
    );
    assert.equal(network.status, 'network');

    const broken = await getResellerAccess(
      createReadClient({ data: null, error: { message: 'JWT expired', code: 'PGRST301' } }),
      'u1',
    );
    assert.equal(broken.status, 'error');
  });

  it('cliente ausente falha sem mascarar configuração', async () => {
    await assert.rejects(getResellerAccess(null, 'u1'), /não configurado/i);
  });
});

describe('resellerAccess — aprovação via Edge Function', () => {
  it('exige convite e cliente com functions.invoke', async () => {
    await assert.rejects(approveResellerAccess({}, ''), /identificado/i);
    await assert.rejects(approveResellerAccess({ functions: {} }, 'i1'), /indispon/i);
  });

  it('envia somente inviteId e devolve o link sem persistir', async () => {
    let call = null;
    const client = {
      functions: {
        invoke: async (name, opts) => {
          call = { name, opts };
          return { data: { ok: true, accessLink: 'https://x/magic', email: 'a@b.com' }, error: null };
        },
      },
    };
    const out = await approveResellerAccess(client, ' i1 ');
    assert.equal(call.name, 'reseller-approve');
    assert.deepEqual(call.opts, { body: { inviteId: ' i1 ' } });
    assert.equal(out.accessLink, 'https://x/magic');
  });

  it('extrai a mensagem pública do FunctionsHttpError', async () => {
    const client = {
      functions: {
        invoke: async () => ({
          data: null,
          error: {
            message: 'Edge Function returned a non-2xx status code',
            context: { json: async () => ({ error: 'E-mail do usuario nao confere com o convite' }) },
          },
        }),
      },
    };
    await assert.rejects(
      approveResellerAccess(client, 'i1'),
      /E-mail do usuario nao confere com o convite/,
    );
  });

  it('usa fallback quando o corpo do erro não é JSON', async () => {
    const client = {
      functions: {
        invoke: async () => ({
          data: null,
          error: {
            message: 'Falha de transporte',
            context: { json: async () => { throw new Error('not json'); } },
          },
        }),
      },
    };
    await assert.rejects(approveResellerAccess(client, 'i1'), /Falha de transporte/);
  });

  it('rejeita resposta sem ok=true', async () => {
    const client = {
      functions: {
        invoke: async () => ({ data: { ok: false, error: 'Acesso suspenso' }, error: null }),
      },
    };
    await assert.rejects(approveResellerAccess(client, 'i1'), /Acesso suspenso/);
  });
});
