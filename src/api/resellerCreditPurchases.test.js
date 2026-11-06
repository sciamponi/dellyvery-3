import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  RESELLER_CREDIT_ORDER_STATUSES, creditOrderStatusLabel,
  isValidIdempotencyKey, newIdempotencyKey,
  fromSupabaseCreditPackage, toSupabaseCreditPackage, validateCreditPackageForm,
  fromSupabaseCreditOrder, listResellerCreditPackages,
  createResellerCreditPackage, updateResellerCreditPackage,
  listResellerCreditOrders, createResellerCreditOrder,
  cancelResellerCreditOrder, confirmResellerCreditOrder,
  rejectResellerCreditOrder, expireResellerCreditOrders,
  getCreditOrderExpiryDays, setCreditOrderExpiryDays,
  creditUnitPrice, creditChargeTotal,
  buildCreditChargeMessage, buildCreditChargeUrl,
  createResellerCreditCharge, submitResellerCreditOrderProof,
} from './resellerCreditPurchases.js';

function createMockClient({ tables = {}, rpcs = {} } = {}) {
  const calls = { select: [], insert: [], update: [], filters: [], orders: [], limits: [], rpc: [] };
  const table = (name) => {
    const cfg = tables[name] || {};
    const chain = {
      select: (...args) => {
        calls.select.push({ table: name, args });
        return chain;
      },
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
      order: (col, options) => {
        calls.orders.push({ table: name, col, options });
        return chain;
      },
      not: (col, op, value) => {
        calls.filters.push({ table: name, col, op, value, negated: true });
        return chain;
      },
      neq: (col, value) => {
        calls.filters.push({ table: name, col, value, neq: true });
        return chain;
      },
      or: (expression) => {
        calls.filters.push({ table: name, col: null, expression });
        return chain;
      },
      limit: (value) => {
        calls.limits.push({ table: name, value });
        return chain;
      },
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
  };
}

describe('resellerCreditPurchases - status e idempotencia', () => {
  it('expoe status do pedido com label e fallback', () => {
    assert.deepEqual(RESELLER_CREDIT_ORDER_STATUSES.map((item) => item.id), [
      'pendente', 'creditado', 'cancelado', 'rejeitado', 'expirado',
    ]);
    assert.equal(creditOrderStatusLabel('pendente'), 'Aguardando pagamento');
    assert.equal(creditOrderStatusLabel('creditado'), 'Creditado');
    assert.equal(creditOrderStatusLabel('rejeitado'), 'Rejeitado');
    assert.equal(creditOrderStatusLabel('expirado'), 'Expirado');
    assert.equal(creditOrderStatusLabel('desconhecido'), 'desconhecido');
    assert.equal(creditOrderStatusLabel(null), '-');
  });

  it('valida UUID de idempotencia', () => {
    assert.equal(isValidIdempotencyKey('550e8400-e29b-41d4-a716-446655440000'), true);
    assert.equal(isValidIdempotencyKey('550E8400-E29B-41D4-A716-446655440000'), true);
    assert.equal(isValidIdempotencyKey('nao-e-uuid'), false);
    assert.equal(isValidIdempotencyKey(''), false);
    assert.equal(isValidIdempotencyKey(null), false);
  });

  it('gera chaves novas e validas', () => {
    const first = newIdempotencyKey();
    const second = newIdempotencyKey();
    assert.equal(isValidIdempotencyKey(first), true);
    assert.equal(isValidIdempotencyKey(second), true);
    assert.notEqual(first, second);
  });
});

describe('resellerCreditPackages - mapeamento e validacao', () => {
  it('mapeia pacote com defaults seguros', () => {
    assert.deepEqual(fromSupabaseCreditPackage({ id: 'p1' }), {
      id: 'p1',
      name: '',
      description: '',
      credits: 0,
      price: 0,
      currency: 'BRL',
      active: true,
      sort_order: 0,
      created_by: null,
      created_at: null,
      updated_at: null,
    });
    assert.equal(fromSupabaseCreditPackage({ id: 'p2', price: '12.50' }).price, 12.5);
  });

  it('normaliza payload e preserva apenas campos conhecidos', () => {
    assert.deepEqual(toSupabaseCreditPackage({
      name: '  Pacote  ', description: '  Dez  ', credits: '10', price: '99.90',
      currency: 'brl', active: 1, sort_order: '2', hacker: true,
    }), {
      name: 'Pacote',
      description: 'Dez',
      credits: 10,
      price: 99.9,
      currency: 'BRL',
      active: true,
      sort_order: 2,
    });
    assert.deepEqual(toSupabaseCreditPackage({ currency: '  ' }), { currency: 'BRL' });
  });

  it('valida nome, creditos, preco, moeda e ordem', () => {
    const base = { name: 'Pacote', credits: 10, price: 99.9, currency: 'BRL', sort_order: 0 };
    assert.equal(validateCreditPackageForm(base), null);
    assert.match(validateCreditPackageForm({ ...base, name: '  ' }), /nome/i);
    assert.match(validateCreditPackageForm({ ...base, credits: 0 }), /inteiro maior que zero/i);
    assert.match(validateCreditPackageForm({ ...base, credits: 1.5 }), /inteiro/i);
    assert.match(validateCreditPackageForm({ ...base, price: -1 }), /maior ou igual a zero/i);
    assert.match(validateCreditPackageForm({ ...base, price: '' }), /preco/i);
    assert.equal(validateCreditPackageForm({ ...base, price: 0 }), null);
    assert.match(validateCreditPackageForm({ ...base, currency: 'BR' }), /Moeda/i);
    assert.match(validateCreditPackageForm({ ...base, sort_order: 1.2 }), /inteiro/i);
    assert.equal(validateCreditPackageForm({}, { partial: true }), null);
    assert.match(validateCreditPackageForm({ credits: 0 }, { partial: true }), /inteiro/i);
  });
});

describe('resellerCreditOrders - mapeamento', () => {
  it('mapeia pedido com snapshot e defaults', () => {
    const mapped = fromSupabaseCreditOrder({
      id: 'o1', reseller_id: 'r1', package_id: 'p1', package_name: 'Pacote',
      package_snapshot: { credits: 10 }, credits: '10', amount: '99.90',
      status: 'pendente', idempotency_key: 'key',
    });
    assert.deepEqual(mapped, {
      id: 'o1',
      reseller_id: 'r1',
      package_id: 'p1',
      package_name: 'Pacote',
      package_snapshot: { credits: 10 },
      credits: 10,
      amount: 99.9,
      confirmed_amount: null,
      currency: 'BRL',
      status: 'pendente',
      idempotency_key: 'key',
      payment_reference: '',
      proof_url: null,
      has_proof: false,
      confirmed_by: null,
      paid_at: null,
      credited_at: null,
      pending_expires_at: null,
      canceled_by: null,
      canceled_at: null,
      cancel_reason: '',
      rejected_by: null,
      rejected_at: null,
      rejection_reason: '',
      expired_at: null,
      created_by: null,
      created_at: null,
      updated_at: null,
    });
    assert.deepEqual(fromSupabaseCreditOrder({ id: 'o2', package_snapshot: [] }).package_snapshot, {});
    assert.equal(fromSupabaseCreditOrder({ id: 'o3' }).status, 'pendente');
  });
});

describe('resellerCreditPackages - operacoes', () => {
  it('lista pacotes ativos por padrao', async () => {
    const client = createMockClient({
      tables: { reseller_credit_packages: { list: { data: [{ id: 'p1', name: 'Pacote' }], error: null } } },
    });
    const out = await listResellerCreditPackages(client);
    assert.equal(out[0].name, 'Pacote');
    assert.ok(client.calls.filters.some((filter) => filter.col === 'active' && filter.value === true));
    assert.deepEqual(client.calls.orders.map((item) => item.col), ['sort_order', 'created_at']);
  });

  it('inclui inativos quando solicitado', async () => {
    const client = createMockClient();
    await listResellerCreditPackages(client, { includeInactive: true });
    assert.equal(client.calls.filters.some((filter) => filter.col === 'active'), false);
  });

  it('cria pacote validado e normalizado', async () => {
    const client = createMockClient({
      tables: { reseller_credit_packages: { single: { data: { id: 'p1', name: 'Pacote', credits: 10 }, error: null } } },
    });
    const out = await createResellerCreditPackage(client, {
      name: ' Pacote ', credits: '10', price: '99.90', currency: 'brl', hacker: true,
    });
    assert.equal(out.id, 'p1');
    assert.deepEqual(client.calls.insert[0].payload, {
      name: 'Pacote', credits: 10, price: 99.9, currency: 'BRL',
    });
    await assert.rejects(() => createResellerCreditPackage(client, { name: 'X', credits: 0 }), /inteiro/i);
  });

  it('atualiza pacote por id com validacao parcial', async () => {
    const client = createMockClient({
      tables: { reseller_credit_packages: { single: { data: { id: 'p1', active: false }, error: null } } },
    });
    const out = await updateResellerCreditPackage(client, 'p1', { active: false });
    assert.equal(out.active, false);
    assert.deepEqual(client.calls.update[0].payload, { active: false });
    assert.ok(client.calls.filters.some((filter) => filter.col === 'id' && filter.value === 'p1'));
    await assert.rejects(() => updateResellerCreditPackage(client, '', { active: false }), /identificado/i);
    await assert.rejects(() => updateResellerCreditPackage(client, 'p1', { price: -1 }), /maior ou igual/i);
  });
});

describe('resellerCreditOrders - operacoes', () => {
  it('lista pedidos com filtros opcionais', async () => {
    const client = createMockClient({
      tables: { reseller_credit_orders: { list: { data: [{ id: 'o1', status: 'pendente' }], error: null } } },
    });
    const out = await listResellerCreditOrders(client, { resellerId: 'r1', status: 'pendente' });
    assert.equal(out[0].status, 'pendente');
    assert.ok(client.calls.filters.some((filter) => filter.col === 'reseller_id' && filter.value === 'r1'));
    assert.ok(client.calls.filters.some((filter) => filter.col === 'status' && filter.value === 'pendente'));
  });

  it('cria pedido somente com pacote e chave valida', async () => {
    const key = '550e8400-e29b-41d4-a716-446655440000';
    const client = createMockClient({
      rpcs: { create_reseller_credit_order: { data: { order_id: 'o1', reused: false }, error: null } },
    });
    const out = await createResellerCreditOrder(client, { packageId: 'p1', idempotencyKey: key });
    assert.equal(out.order_id, 'o1');
    assert.deepEqual(client.calls.rpc[0], {
      fn: 'create_reseller_credit_order',
      args: { p_package_id: 'p1', p_idempotency_key: key },
    });
    await assert.rejects(() => createResellerCreditOrder(client, { idempotencyKey: key }), /Pacote/i);
    await assert.rejects(() => createResellerCreditOrder(client, { packageId: 'p1', idempotencyKey: 'x' }), /idempotencia/i);
  });

  it('cancela pedido com motivo normalizado', async () => {
    const client = createMockClient({
      rpcs: { cancel_reseller_credit_order: { data: { order_id: 'o1', status: 'cancelado' }, error: null } },
    });
    const out = await cancelResellerCreditOrder(client, 'o1', '  sem pagamento  ');
    assert.equal(out.status, 'cancelado');
    assert.deepEqual(client.calls.rpc[0], {
      fn: 'cancel_reseller_credit_order',
      args: { p_order_id: 'o1', p_reason: 'sem pagamento' },
    });
    await assert.rejects(() => cancelResellerCreditOrder(client, '', 'x'), /identificado/i);
  });

  it('confirma pedido com referencia e valor normalizados', async () => {
    const client = createMockClient({
      rpcs: { confirm_reseller_credit_order: { data: { order_id: 'o1', balance: 10 }, error: null } },
    });
    const out = await confirmResellerCreditOrder(client, 'o1', '  comprovante 123  ', '99.90');
    assert.equal(out.balance, 10);
    assert.deepEqual(client.calls.rpc[0], {
      fn: 'confirm_reseller_credit_order',
      args: {
        p_order_id: 'o1',
        p_confirmed_amount: 99.9,
        p_payment_reference: 'comprovante 123',
      },
    });
    await assert.rejects(() => confirmResellerCreditOrder(client, '', '', '1'), /identificado/i);
    await assert.rejects(() => confirmResellerCreditOrder(client, 'o1', '', '99.90'), /referencia/i);
    await assert.rejects(() => confirmResellerCreditOrder(client, 'o1', 'ref', ''), /valor confirmado/i);
    await assert.rejects(() => confirmResellerCreditOrder(client, 'o1', 'ref', '-1'), /invalido/i);
  });

  it('rejeita pedido com motivo normalizado', async () => {
    const client = createMockClient({
      rpcs: { reject_reseller_credit_order: { data: { order_id: 'o1', status: 'rejeitado' }, error: null } },
    });
    const out = await rejectResellerCreditOrder(client, 'o1', '  sem comprovante  ');
    assert.equal(out.status, 'rejeitado');
    assert.deepEqual(client.calls.rpc[0], {
      fn: 'reject_reseller_credit_order',
      args: { p_order_id: 'o1', p_reason: 'sem comprovante' },
    });
    await assert.rejects(() => rejectResellerCreditOrder(client, '', 'x'), /identificado/i);
    await assert.rejects(() => rejectResellerCreditOrder(client, 'o1', '  '), /motivo/i);
  });

  it('expira pedidos vencidos', async () => {
    const client = createMockClient({
      rpcs: { expire_reseller_credit_orders: { data: 2, error: null } },
    });
    const out = await expireResellerCreditOrders(client);
    assert.equal(out, 2);
    assert.equal(client.calls.rpc[0].fn, 'expire_reseller_credit_orders');
  });

  it('le e atualiza a validade dos pedidos', async () => {
    const readClient = createMockClient({
      tables: { platform_settings: { single: { data: { credit_order_expiry_days: 1 }, error: null } } },
    });
    assert.equal(await getCreditOrderExpiryDays(readClient), 1);
    assert.ok(readClient.calls.filters.some((filter) => filter.col === 'id' && filter.value === true));

    const emptyClient = createMockClient({
      tables: { platform_settings: { single: { data: { credit_order_expiry_days: null }, error: null } } },
    });
    assert.equal(await getCreditOrderExpiryDays(emptyClient), null);

    const writeClient = createMockClient({
      rpcs: { set_credit_order_expiry_days: { data: { credit_order_expiry_days: 2 }, error: null } },
    });
    assert.equal(await setCreditOrderExpiryDays(writeClient, '2'), 2);
    assert.deepEqual(writeClient.calls.rpc[0], {
      fn: 'set_credit_order_expiry_days',
      args: { p_days: 2 },
    });
    await setCreditOrderExpiryDays(writeClient, '');
    assert.deepEqual(writeClient.calls.rpc[1], {
      fn: 'set_credit_order_expiry_days',
      args: { p_days: null },
    });
    await assert.rejects(() => setCreditOrderExpiryDays(writeClient, '0'), /maior que zero/i);
    await assert.rejects(() => setCreditOrderExpiryDays(writeClient, '1.5'), /inteiro/i);
  });

  it('propaga mensagem de erro da RPC', async () => {
    const client = createMockClient({
      rpcs: { create_reseller_credit_order: { data: null, error: { message: 'Pacote indisponivel' } } },
    });
    await assert.rejects(
      () => createResellerCreditOrder(client, {
        packageId: 'p1', idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
      }),
      /Pacote indisponivel/,
    );
  });
});

describe('resellerCreditOrders - cobranca e comprovante', () => {
  it('calcula valor unitario e total a partir do pacote', () => {
    assert.equal(creditUnitPrice({ credits: 10, price: 99.9 }), 9.99);
    assert.equal(creditUnitPrice({ credits: 3, price: 10 }), 3.3333);
    assert.equal(creditUnitPrice({ credits: 0, price: 10 }), 0);
    assert.equal(creditChargeTotal(9.99, 1), 9.99);
    assert.equal(creditChargeTotal(9.99, 5), 49.95);
    assert.equal(creditChargeTotal(9.99, 0), 0);
    assert.equal(creditChargeTotal(9.99, 1.5), 0);
  });

  it('filtra pedidos por comprovante enviado', async () => {
    const withProof = createMockClient({
      tables: { reseller_credit_orders: { list: { data: [{ id: 'o1' }], error: null } } },
    });
    await listResellerCreditOrders(withProof, { hasProof: true });
    assert.ok(withProof.calls.filters.some((f) => f.col === 'proof_url' && f.negated === true));
    assert.ok(withProof.calls.filters.some((f) => f.col === 'proof_url' && f.neq === true));

    const withoutProof = createMockClient();
    await listResellerCreditOrders(withoutProof, { hasProof: false });
    assert.ok(withoutProof.calls.filters.some((f) => typeof f.expression === 'string' && f.expression.includes('proof_url')));
  });

  it('mapeia comprovante no pedido', () => {
    const mapped = fromSupabaseCreditOrder({ id: 'o1', proof_url: 'r1/o1/proof.png' });
    assert.equal(mapped.proof_url, 'r1/o1/proof.png');
    assert.equal(mapped.has_proof, true);
    assert.equal(fromSupabaseCreditOrder({ id: 'o2' }).has_proof, false);
  });

  it('monta mensagem e URL de cobranca com Pix', () => {
    const message = buildCreditChargeMessage({
      name: 'Maria Silva',
      credits: 10,
      total: 99.9,
      currency: 'BRL',
      pixKey: 'pix@exemplo.com',
      receiverName: 'Dellyvery',
      instructions: 'Pagamento via Pix.',
    });
    assert.match(message, /Olá, Maria!/);
    assert.match(message, /10 créditos/);
    assert.match(message, /R\$\s*99,90/);
    assert.match(message, /pix@exemplo.com/);
    assert.match(message, /Pagamento via Pix\./);

    const url = buildCreditChargeUrl({
      phone: '+55 (11) 99999-9999',
      name: 'Maria',
      credits: 1,
      total: 9.9,
      pixKey: 'pix@exemplo.com',
    });
    assert.ok(url.startsWith('https://wa.me/5511999999999?text='));
    assert.throws(() => buildCreditChargeUrl({ phone: '123', name: 'X', credits: 1, total: 1 }), /WhatsApp/i);
  });

  it('cria cobranca enviando apenas revendedor, quantidade e chave', async () => {
    const key = '550e8400-e29b-41d4-a716-446655440000';
    const client = createMockClient({
      rpcs: { create_reseller_credit_charge: { data: { order_id: 'o1', reused: false }, error: null } },
    });
    const out = await createResellerCreditCharge(client, {
      resellerId: 'r1', credits: '10', idempotencyKey: key,
    });
    assert.equal(out.order_id, 'o1');
    assert.deepEqual(client.calls.rpc[0], {
      fn: 'create_reseller_credit_charge',
      args: { p_reseller_id: 'r1', p_credits: 10, p_idempotency_key: key },
    });
    await assert.rejects(
      () => createResellerCreditCharge(client, { resellerId: 'r1', credits: 0, idempotencyKey: key }),
      /inteir/i,
    );
    await assert.rejects(
      () => createResellerCreditCharge(client, { resellerId: 'r1', credits: 10, idempotencyKey: 'x' }),
      /idempotencia/i,
    );
    await assert.rejects(
      () => createResellerCreditCharge(client, { credits: 10, idempotencyKey: key }),
      /identificado/i,
    );
  });

  it('envia comprovante normalizado e valida campos', async () => {
    const client = createMockClient({
      rpcs: { submit_reseller_credit_order_proof: { data: { order_id: 'o1' }, error: null } },
    });
    const out = await submitResellerCreditOrderProof(client, {
      orderId: 'o1', paymentReference: '  pix 123  ', proofUrl: '  r1/o1/proof.png  ',
    });
    assert.equal(out.order_id, 'o1');
    assert.deepEqual(client.calls.rpc[0], {
      fn: 'submit_reseller_credit_order_proof',
      args: {
        p_order_id: 'o1',
        p_payment_reference: 'pix 123',
        p_proof_url: 'r1/o1/proof.png',
      },
    });
    await assert.rejects(
      () => submitResellerCreditOrderProof(client, { orderId: 'o1', paymentReference: '', proofUrl: 'x' }),
      /referencia/i,
    );
    await assert.rejects(
      () => submitResellerCreditOrderProof(client, { orderId: 'o1', paymentReference: 'x', proofUrl: '' }),
      /comprovante/i,
    );
  });
});
