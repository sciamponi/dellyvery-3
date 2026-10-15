import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getCustomerHistory, isFirstOrder, freezeFirstFlags,
  resolveFirstOrderFlags, attachFirstOrderFlag,
} from './customerHistory.js';

const o = (over = {}) => ({ id: 'x', customer_id: 'c1', status: 'novo', ...over });

describe('customerHistory — primeiro pedido', () => {
  it('cliente sem pedidos anteriores recebe o selo', () => {
    assert.equal(isFirstOrder(o({ id: 'a' }), [o({ id: 'a' }), o({ id: 'b', customer_id: 'c2' })]), true);
    assert.deepEqual(getCustomerHistory(o({ id: 'a' }), [o({ id: 'a' })]), []);
  });

  it('cliente com histórico não recebe', () => {
    const orders = [o({ id: 'a' }), o({ id: 'b' }), o({ id: 'c', status: 'finalizado' })];
    assert.equal(isFirstOrder(o({ id: 'a' }), orders), false);
    assert.equal(getCustomerHistory(o({ id: 'a' }), orders).length, 2);
  });

  it('pedido sem vínculo nunca é primeiro (avulso ≠ novo)', () => {
    assert.equal(isFirstOrder(o({ id: 'a', customer_id: null }), [o({ id: 'a', customer_id: null })]), false);
    assert.equal(isFirstOrder(o({ id: 'a', customer_id: '' }), []), false);
    assert.equal(isFirstOrder(null, []), false);
  });

  it('cancelados não contam: nem como histórico, nem o próprio', () => {
    const orders = [o({ id: 'a' }), o({ id: 'b', status: 'cancelado' })];
    assert.equal(isFirstOrder(o({ id: 'a' }), orders), true);
    assert.equal(isFirstOrder(o({ id: 'b', status: 'cancelado' }), orders), false);
  });

  it('isolamento por empresa vem da lista (só compara o recebido)', () => {
    // Listas de empresas distintas nunca se misturam: cada chamada avalia
    // apenas o array informado (já escopado por company_id/RLS).
    assert.equal(isFirstOrder(o({ id: 'a' }), [o({ id: 'a' })]), true);
  });
});

describe('customerHistory — vida útil congelada (ciclo do pedido)', () => {
  it('nunca true→false: 2º pedido não apaga o selo do 1º', () => {
    let m = freezeFirstFlags(null, new Map([['a', true]]));
    assert.equal(m.get('a'), true);
    m = freezeFirstFlags(m, new Map([['a', false], ['b', true]]));
    assert.equal(m.get('a'), true);
    assert.equal(m.get('b'), true);
    // Sem mudança: devolve o mesmo Map (sem re-render).
    assert.equal(freezeFirstFlags(m, new Map([['a', true]])), m);
    assert.equal(freezeFirstFlags(m, null), m);
  });

  it('lote único classifica sem N+1 (persistido, 1 consulta)', async () => {
    let queries = 0;
    const countPrior = async (ids) => {
      queries += 1;
      // c1 tem 2 pedidos (a + b); c2 tem 1 (c); c9 inexistente.
      const m = new Map();
      if (ids.includes('c1')) m.set('c1', 2);
      if (ids.includes('c2')) m.set('c2', 1);
      return m;
    };
    const orders = [o({ id: 'a' }), o({ id: 'b' }), o({ id: 'c', customer_id: 'c2' }), o({ id: 'd', customer_id: null })];
    const flags = await resolveFirstOrderFlags({}, 'co1', orders, countPrior);
    assert.equal(queries, 1);
    assert.equal(flags.get('a'), false);
    assert.equal(flags.get('b'), false);
    assert.equal(flags.get('c'), true);
    assert.equal(flags.get('d'), false);
  });

  it('falha na contagem = sem selo, nunca exceção', async () => {
    const flags = await resolveFirstOrderFlags({}, 'co1', [o({ id: 'a' })], async () => { throw new Error('rede'); });
    assert.equal(flags.get('a'), false);
  });

  it('attach anexa flag por chegada; sem cliente/empresa passa direto', async () => {
    const withFlag = await attachFirstOrderFlag({}, 'co1', o({ id: 'a' }));
    // Sem cliente injetável aqui: import dinâmico falha sem RLS? Não — o
    // adapter lança sem client configurado e o attach engole: sem selo.
    assert.equal(withFlag.isFirstOrder, undefined);
    assert.equal(withFlag.id, 'a');
    const avulso = await attachFirstOrderFlag({}, 'co1', o({ id: 'a', customer_id: null }));
    assert.equal(avulso.isFirstOrder, undefined);
    const noCompany = await attachFirstOrderFlag({}, null, o({ id: 'a' }));
    assert.equal(noCompany.isFirstOrder, undefined);
  });
});
