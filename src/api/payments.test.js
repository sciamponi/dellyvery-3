import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateReceipt, getPaymentReceipts, getPaymentReceiptsForOrders, registerOrderPayment,
  SUPPORTED_PAYMENT_METHODS, RECEIPT_ACTION,
} from './payments.js';

function createMockClient({ rows = [], insertRow = null, insertError = null, userId = 'u1' } = {}) {
  const calls = { insert: [], select: [] };
  const chain = {
    select: (...a) => { calls.select.push(a); return chain; },
    eq: () => chain,
    in: () => chain,
    order: () => chain,
    insert: (p) => { calls.insert.push(p); return chain; },
    single: async () => {
      if (insertError) return { data: null, error: insertError };
      return { data: insertRow || { id: 'r1' }, error: null };
    },
    then: (resolve) => resolve(
      insertError && calls.insert.length > 0
        ? { data: null, error: insertError }
        : { data: rows, error: null },
    ),
  };
  return {
    calls,
    from: () => chain,
    auth: { getSession: async () => ({ data: { session: { user: { id: userId } } }, error: null }) },
  };
}

describe('payments — validação', () => {
  it('métodos suportados, valor positivo, forma válida', () => {
    assert.ok(SUPPORTED_PAYMENT_METHODS.length >= 3);
    assert.equal(validateReceipt({ amount: 10, method: 'Cheque' }), 'Escolha uma forma de pagamento suportada');
    assert.equal(validateReceipt({ amount: 0, method: 'Dinheiro' }), 'Informe um valor recebido maior que 0');
    assert.equal(validateReceipt({ amount: 'x', method: 'Dinheiro' }), 'Informe um valor recebido maior que 0');
    assert.equal(validateReceipt({ amount: 25.5, method: 'Dinheiro' }), null);
  });
});

describe('payments — leitura de recebimentos', () => {
  it('mapeia linhas de auditoria', async () => {
    const client = createMockClient({ rows: [
      { id: 'r1', entity_id: 'o1', user_id: 'u9', metadata: { amount: 50, method: 'Pix', notes: 'ok' }, created_at: 't' },
    ] });
    const out = await getPaymentReceipts(client, 'co', 'o1');
    assert.equal(out.length, 1);
    assert.equal(out[0].amount, 50);
    assert.equal(out[0].method, 'Pix');
    await assert.rejects(() => getPaymentReceipts(client, 'co', ''), /identificado/);
  });

  it('lote: 1 consulta para N pedidos, sem N+1', async () => {
    const client = createMockClient({ rows: [
      { id: 'r1', entity_id: 'o1', user_id: 'u1', metadata: { amount: 10, method: 'Pix' }, created_at: 't' },
      { id: 'r2', entity_id: 'o2', user_id: 'u1', metadata: { amount: 20, method: 'Dinheiro' }, created_at: 't' },
    ] });
    const map = await getPaymentReceiptsForOrders(client, 'co', ['o1', 'o2', 'o3']);
    assert.equal(map.o1.length, 1);
    assert.equal(map.o2[0].amount, 20);
    assert.equal(map.o3, undefined);
    assert.deepEqual(await getPaymentReceiptsForOrders(client, 'co', []), {});
  });
});

describe('payments — registro', () => {
  it('grava audit com autor e metadados; falha lança', async () => {
    const client = createMockClient({});
    const row = await registerOrderPayment(client, 'co', {
      orderId: 'o1', orderStatus: 'finalizado', amount: 50, method: 'Dinheiro', notes: 'x',
    });
    assert.equal(row.id, 'r1');
    const payload = client.calls.insert[0];
    assert.equal(payload.company_id, 'co');
    assert.equal(payload.user_id, 'u1');
    assert.equal(payload.action, RECEIPT_ACTION);
    assert.equal(payload.entity, 'order');
    assert.equal(payload.metadata.amount, 50);
    await assert.rejects(() => registerOrderPayment(client, 'co', {
      orderId: 'o1', amount: 0, method: 'Dinheiro',
    }), /maior que 0/);
    const bad = createMockClient({ insertError: { message: 'rede', code: '500' } });
    await assert.rejects(() => registerOrderPayment(bad, 'co', {
      orderId: 'o1', amount: 5, method: 'Dinheiro',
    }), /rede/);
  });
});
