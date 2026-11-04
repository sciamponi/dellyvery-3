import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PLAN_PURCHASE_STATUSES, planPurchaseStatusLabel,
  isValidIdempotencyKey, newIdempotencyKey,
  fromSupabasePlanPurchase, fromSupabasePixInstructions,
  createPlanPurchaseRequest, submitPlanPurchasePayment,
  cancelPlanPurchaseRequest, getMyPlanPurchaseRequests,
  getPlanPurchasePixInstructions, expirePlanPurchaseRequests,
} from './planPurchases.js';

function createMockClient({ rpcs = {} } = {}) {
  const calls = { rpc: [] };
  return {
    calls,
    rpc: async (fn, args) => {
      calls.rpc.push({ fn, args });
      return rpcs[fn] || { data: null, error: null };
    },
  };
}

describe('planPurchases - status e idempotencia', () => {
  it('expoe status e labels', () => {
    assert.deepEqual(PLAN_PURCHASE_STATUSES.map((item) => item.id), [
      'pendente', 'confirmada', 'rejeitada', 'cancelada', 'expirada',
    ]);
    assert.equal(planPurchaseStatusLabel('pendente'), 'Aguardando pagamento');
    assert.equal(planPurchaseStatusLabel('confirmada'), 'Confirmada');
    assert.equal(planPurchaseStatusLabel('desconhecido'), 'desconhecido');
    assert.equal(planPurchaseStatusLabel(null), '-');
  });

  it('valida e gera chaves de idempotencia', () => {
    assert.equal(isValidIdempotencyKey('550e8400-e29b-41d4-a716-446655440000'), true);
    assert.equal(isValidIdempotencyKey('nao-e-uuid'), false);
    const key = newIdempotencyKey();
    assert.equal(isValidIdempotencyKey(key), true);
  });
});

describe('planPurchases - mapeamento', () => {
  it('mapeia solicitacao com snapshot e defaults seguros', () => {
    const out = fromSupabasePlanPurchase({
      id: 'r1', company_id: 'c1', plan_id: 'p1',
      plan_name_snapshot: 'Plano', plan_slug_snapshot: 'plano',
      price_snapshot: '99.90', status: 'pendente', proof_url: 'https://x',
    });
    assert.equal(out.plan_name, 'Plano');
    assert.equal(out.price, 99.9);
    assert.equal(out.currency, 'BRL');
    assert.equal(out.has_proof, true);
    assert.equal(out.proof_url, 'https://x');
    assert.equal(out.reason, '');
  });

  it('mapeia instrucoes Pix sem inventar dados', () => {
    const out = fromSupabasePixInstructions({
      request_id: 'r1', status: 'pendente', available: true,
      pix_key: 'chave', qr_image_url: 'https://cdn/pix-qr/a.png',
      qr_image_path: 'pix-qr/a.png',
      version: 2, request_version: 1, version_changed: true,
    });
    assert.equal(out.pix_key, 'chave');
    assert.equal(out.qr_image_url, 'https://cdn/pix-qr/a.png');
    assert.equal(out.qr_image_path, 'pix-qr/a.png');
    assert.equal(out.available, true);
    assert.equal(out.version_changed, true);
    assert.equal(out.instructions, null);
  });
});

describe('planPurchases - operacoes', () => {
  it('cria solicitacao somente com empresa, plano e chave valida', async () => {
    const key = '550e8400-e29b-41d4-a716-446655440000';
    const client = createMockClient({
      rpcs: { create_plan_purchase_request: { data: { request_id: 'r1', reused: false }, error: null } },
    });
    const out = await createPlanPurchaseRequest(client, { companyId: 'c1', planId: 'p1', idempotencyKey: key });
    assert.equal(out.request_id, 'r1');
    assert.deepEqual(client.calls.rpc[0], {
      fn: 'create_plan_purchase_request',
      args: { p_company_id: 'c1', p_plan_id: 'p1', p_idempotency_key: key },
    });
    await assert.rejects(() => createPlanPurchaseRequest(client, { planId: 'p1', idempotencyKey: key }), /Empresa/i);
    await assert.rejects(() => createPlanPurchaseRequest(client, { companyId: 'c1', idempotencyKey: key }), /Plano/i);
    await assert.rejects(() => createPlanPurchaseRequest(client, { companyId: 'c1', planId: 'p1', idempotencyKey: 'x' }), /idempotencia/i);
  });

  it('envia referencia, comprovante e pagador normalizados', async () => {
    const client = createMockClient({
      rpcs: { submit_plan_purchase_payment: { data: { request_id: 'r1', status: 'pendente' }, error: null } },
    });
    const out = await submitPlanPurchasePayment(client, 'r1', {
      paymentReference: '  pix 123  ',
      proofUrl: '  https://x  ',
      payerName: '  Maria  ',
    });
    assert.equal(out.status, 'pendente');
    assert.deepEqual(client.calls.rpc[0], {
      fn: 'submit_plan_purchase_payment',
      args: {
        p_request_id: 'r1',
        p_payment_reference: 'pix 123',
        p_proof_url: 'https://x',
        p_payer_name: 'Maria',
      },
    });
    await assert.rejects(() => submitPlanPurchasePayment(client, '', { paymentReference: 'x' }), /identificada/i);
    await assert.rejects(() => submitPlanPurchasePayment(client, 'r1', { paymentReference: '  ' }), /referencia/i);
  });

  it('cancela solicitacao com motivo opcional', async () => {
    const client = createMockClient({
      rpcs: { cancel_plan_purchase_request: { data: { request_id: 'r1', status: 'cancelada' }, error: null } },
    });
    const out = await cancelPlanPurchaseRequest(client, 'r1', '  desisti  ');
    assert.equal(out.status, 'cancelada');
    assert.deepEqual(client.calls.rpc[0], {
      fn: 'cancel_plan_purchase_request',
      args: { p_request_id: 'r1', p_reason: 'desisti' },
    });
    await cancelPlanPurchaseRequest(client, 'r1');
    assert.deepEqual(client.calls.rpc[1].args, { p_request_id: 'r1', p_reason: null });
    await assert.rejects(() => cancelPlanPurchaseRequest(client, ''), /identificada/i);
  });

  it('lista historico e instrucoes Pix', async () => {
    const client = createMockClient({
      rpcs: {
        get_my_plan_purchase_requests: { data: [{ id: 'r1', plan_name_snapshot: 'Plano' }], error: null },
        get_plan_purchase_pix_instructions: { data: { request_id: 'r1', available: false }, error: null },
      },
    });
    const rows = await getMyPlanPurchaseRequests(client, 'c1');
    assert.equal(rows[0].plan_name, 'Plano');
    assert.deepEqual(client.calls.rpc[0], { fn: 'get_my_plan_purchase_requests', args: { p_company_id: 'c1' } });

    const pix = await getPlanPurchasePixInstructions(client, 'r1');
    assert.equal(pix.available, false);
    assert.deepEqual(client.calls.rpc[1], { fn: 'get_plan_purchase_pix_instructions', args: { p_request_id: 'r1' } });
    await assert.rejects(() => getMyPlanPurchaseRequests(client, ''), /Empresa/i);
    await assert.rejects(() => getPlanPurchasePixInstructions(client, ''), /identificada/i);
  });

  it('expira solicitacoes e propaga erro', async () => {
    const client = createMockClient({
      rpcs: { expire_plan_purchase_requests: { data: 2, error: null } },
    });
    assert.equal(await expirePlanPurchaseRequests(client), 2);
    assert.equal(client.calls.rpc[0].fn, 'expire_plan_purchase_requests');

    const errorClient = createMockClient({
      rpcs: { create_plan_purchase_request: { data: null, error: { message: 'Plano indisponivel' } } },
    });
    await assert.rejects(
      () => createPlanPurchaseRequest(errorClient, {
        companyId: 'c1', planId: 'p1', idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
      }),
      /Plano indisponivel/,
    );
  });
});
