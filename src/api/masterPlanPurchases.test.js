import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PIX_KEY_TYPES, fromMasterPlanPurchase, fromPlatformPixSettings,
  validatePixSettings, listPlanPurchaseRequests, confirmPlanPurchaseRequest,
  rejectPlanPurchaseRequest, getPlatformPixSettings, setPlatformPixSettings,
  getPlanPurchaseExpiryDays, setPlanPurchaseExpiryDays,
} from './masterPlanPurchases.js';

function createMockClient({ rpcs = {}, tables = {} } = {}) {
  const calls = { rpc: [], select: [], filters: [] };
  const chain = {
    select: (...args) => {
      calls.select.push(args);
      return chain;
    },
    eq: (col, value) => {
      calls.filters.push({ col, value });
      return chain;
    },
    single: async () => tables.platform_settings || { data: null, error: null },
  };
  return {
    calls,
    rpc: async (fn, args) => {
      calls.rpc.push({ fn, args });
      return rpcs[fn] || { data: null, error: null };
    },
    from: () => chain,
  };
}

describe('masterPlanPurchases - mapeamento e validacao', () => {
  it('mapeia fila com dados da empresa e solicitante', () => {
    const out = fromMasterPlanPurchase({
      id: 'r1', plan_name_snapshot: 'Plano', price_snapshot: '99.90',
      company_name: 'Empresa', company_slug: 'empresa',
      requested_by_name: 'Maria', requested_by_email: 'maria@test.local',
      reseller_client_id: 'rc1', reseller_client_status: 'ativo',
      reseller_id: 'rs1', reseller_name: 'Revenda', reseller_email: 'revenda@test.local',
      queue_order: 0,
    });
    assert.equal(out.company_name, 'Empresa');
    assert.equal(out.requested_by_name, 'Maria');
    assert.equal(out.reseller_id, 'rs1');
    assert.equal(out.reseller_name, 'Revenda');
    assert.equal(out.reseller_email, 'revenda@test.local');
    assert.equal(out.price, 99.9);
    assert.equal(out.queue_order, 0);
  });

  it('mapeia configuracao Pix e tipos aceitos', () => {
    assert.deepEqual(PIX_KEY_TYPES.map((item) => item.id), ['cpf', 'cnpj', 'email', 'phone', 'random']);
    const out = fromPlatformPixSettings({
      active: true, pix_key_type: 'email', pix_key: 'x', version: 2,
      qr_image_url: 'https://cdn/pix-qr/a.png', qr_image_path: 'pix-qr/a.png',
      previous_qr_image_path: 'pix-qr/old.png',
    });
    assert.equal(out.active, true);
    assert.equal(out.pix_key, 'x');
    assert.equal(out.qr_image_path, 'pix-qr/a.png');
    assert.equal(out.previous_qr_image_path, 'pix-qr/old.png');
    assert.equal(out.qr_payload, '');
    assert.equal(fromPlatformPixSettings(null), null);
  });

  it('valida configuracao Pix antes da RPC', () => {
    assert.equal(validatePixSettings({ active: false }), null);
    assert.match(validatePixSettings({ active: true }), /Informe a chave Pix/i);
    assert.match(validatePixSettings({ active: true, pix_key: 'x', pix_key_type: 'invalido' }), /Tipo de chave/i);
    assert.match(validatePixSettings({ pix_key: 'x'.repeat(501) }), /muito longa/i);
    assert.match(validatePixSettings({ qr_payload: 'x'.repeat(4001) }), /muito longo/i);
  });
});

describe('masterPlanPurchases - operacoes', () => {
  it('lista fila por status e valida status', async () => {
    const client = createMockClient({
      rpcs: { list_plan_purchase_requests: { data: [{ id: 'r1', status: 'pendente' }], error: null } },
    });
    const out = await listPlanPurchaseRequests(client, { status: 'todas' });
    assert.equal(out[0].status, 'pendente');
    assert.deepEqual(client.calls.rpc[0], { fn: 'list_plan_purchase_requests', args: { p_status: 'todas' } });
    await assert.rejects(() => listPlanPurchaseRequests(client, { status: 'x' }), /Status invalido/i);
  });

  it('confirma com valor, referencia e motivo normalizados', async () => {
    const client = createMockClient({
      rpcs: { confirm_plan_purchase_request: { data: { request_id: 'r1', status: 'confirmada' }, error: null } },
    });
    const out = await confirmPlanPurchaseRequest(client, 'r1', {
      confirmedAmount: '99.90', paymentReference: '  pix  ', reason: '  ok  ',
    });
    assert.equal(out.status, 'confirmada');
    assert.deepEqual(client.calls.rpc[0], {
      fn: 'confirm_plan_purchase_request',
      args: {
        p_request_id: 'r1',
        p_confirmed_amount: 99.9,
        p_payment_reference: 'pix',
        p_reason: 'ok',
      },
    });
    await assert.rejects(() => confirmPlanPurchaseRequest(client, 'r1', { paymentReference: 'x' }), /valor confirmado/i);
    await assert.rejects(() => confirmPlanPurchaseRequest(client, 'r1', { confirmedAmount: '1' }), /referencia/i);
    await assert.rejects(() => confirmPlanPurchaseRequest(client, 'r1', { confirmedAmount: '-1', paymentReference: 'x' }), /invalido/i);
  });

  it('rejeita com motivo obrigatorio', async () => {
    const client = createMockClient({
      rpcs: { reject_plan_purchase_request: { data: { request_id: 'r1', status: 'rejeitada' }, error: null } },
    });
    const out = await rejectPlanPurchaseRequest(client, 'r1', '  sem comprovante  ');
    assert.equal(out.status, 'rejeitada');
    assert.deepEqual(client.calls.rpc[0], {
      fn: 'reject_plan_purchase_request',
      args: { p_request_id: 'r1', p_reason: 'sem comprovante' },
    });
    await assert.rejects(() => rejectPlanPurchaseRequest(client, 'r1', '  '), /motivo/i);
  });

  it('le e salva configuracao Pix', async () => {
    const qrUrl = 'https://cdn/storage/v1/object/public/platform-assets/pix-qr/a.png';
    const client = createMockClient({
      rpcs: {
        get_platform_pix_settings: { data: { active: false, version: 1 }, error: null },
        set_platform_pix_settings: {
          data: {
            active: true, pix_key: 'x', version: 2,
            qr_image_url: qrUrl, qr_image_path: 'pix-qr/a.png',
            previous_qr_image_path: 'pix-qr/old.png',
          },
          error: null,
        },
      },
    });
    const current = await getPlatformPixSettings(client);
    assert.equal(current.version, 1);
    const saved = await setPlatformPixSettings(client, {
      active: true, pix_key_type: 'email', pix_key: '  x  ', receiver_name: ' Loja ',
      qr_image_url: ` ${qrUrl} `,
    });
    assert.equal(saved.version, 2);
    assert.equal(saved.qr_image_path, 'pix-qr/a.png');
    assert.equal(saved.previous_qr_image_path, 'pix-qr/old.png');
    assert.deepEqual(client.calls.rpc[1], {
      fn: 'set_platform_pix_settings',
      args: {
        p_active: true,
        p_pix_key_type: 'email',
        p_pix_key: 'x',
        p_receiver_name: 'Loja',
        p_qr_image_url: qrUrl,
        p_qr_payload: null,
        p_instructions: null,
      },
    });
    await assert.rejects(() => setPlatformPixSettings(client, { active: true }), /chave Pix/i);
  });

  it('le e atualiza validade da solicitacao', async () => {
    const readClient = createMockClient({
      tables: { platform_settings: { data: { plan_purchase_expiry_days: 1 }, error: null } },
    });
    assert.equal(await getPlanPurchaseExpiryDays(readClient), 1);
    assert.deepEqual(readClient.calls.select[0], ['plan_purchase_expiry_days']);
    assert.ok(readClient.calls.filters.some((filter) => filter.col === 'id' && filter.value === true));

    const writeClient = createMockClient({
      rpcs: { set_plan_purchase_expiry_days: { data: { plan_purchase_expiry_days: 2 }, error: null } },
    });
    assert.equal(await setPlanPurchaseExpiryDays(writeClient, '2'), 2);
    assert.deepEqual(writeClient.calls.rpc[0], { fn: 'set_plan_purchase_expiry_days', args: { p_days: 2 } });
    await setPlanPurchaseExpiryDays(writeClient, '');
    assert.deepEqual(writeClient.calls.rpc[1], { fn: 'set_plan_purchase_expiry_days', args: { p_days: null } });
    await assert.rejects(() => setPlanPurchaseExpiryDays(writeClient, '0'), /maior que zero/i);
    await assert.rejects(() => setPlanPurchaseExpiryDays(writeClient, '1.5'), /inteiro/i);
  });
});
