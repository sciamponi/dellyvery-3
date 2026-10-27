import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTableCards, comandasForTable, findTableCard, getPdvAssemblyMode, getPdvView,
  hasLocalDraftItems, localDraftItemsOnly, pickLatestComanda, setPdvAssemblyMode,
  setPdvView, sortComandasByRecency,
} from './pdvWorkspace.js';

function memoryStore(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value); },
  };
}

const C1 = 'company-1';
const order = (over = {}) => ({
  id: 'o1', company_id: C1, order_type: 'mesa', status: 'novo', table_number: '1',
  table_id: null, order_number: 10, customer_name: 'Ana', total: 30,
  items: [{ product_id: 'p1', quantity: 2, unit_price: 15 }],
  ...over,
});
const table = (over = {}) => ({ id: 't1', name: '1', code: '', notes: '', active: true, ...over });

describe('pdvWorkspace - preferencias', () => {
  it('defaults preservam produto + auto', () => {
    const store = memoryStore();
    assert.equal(getPdvView(store), 'produtos');
    assert.equal(getPdvAssemblyMode(store), 'auto');
  });

  it('persiste apenas valores validos', () => {
    const store = memoryStore();
    assert.equal(setPdvView('mesas', store), true);
    assert.equal(setPdvAssemblyMode('auto', store), true);
    assert.equal(getPdvView(store), 'mesas');
    assert.equal(getPdvAssemblyMode(store), 'auto');
    assert.equal(setPdvView('outra', store), false);
    assert.equal(setPdvAssemblyMode('outra', store), false);
    assert.equal(getPdvView(store), 'mesas');
    assert.equal(getPdvAssemblyMode(store), 'auto');
  });

  it('storage indisponivel cai no default sem quebrar', () => {
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    assert.equal(getPdvView(broken), 'produtos');
    assert.equal(setPdvView('mesas', broken), false);
    assert.equal(getPdvAssemblyMode(broken), 'auto');
  });
});

describe('pdvWorkspace - cartoes de mesa', () => {
  it('inclui mesas livres e agrupa por table_id', () => {
    const cards = buildTableCards({
      tables: [table(), table({ id: 't2', name: '2' })],
      orders: [order({ id: 'o1', table_id: 't1' })],
      companyId: C1,
    });
    assert.equal(cards.length, 2);
    const one = cards.find((c) => c.tableId === 't1');
    assert.equal(one.status, 'ocupada');
    assert.equal(one.comandas.length, 1);
    assert.equal(one.total, 30);
    assert.equal(one.itemCount, 2);
    const two = cards.find((c) => c.tableId === 't2');
    assert.equal(two.status, 'livre');
    assert.equal(two.comandas.length, 0);
  });

  it('pedido antigo sem table_id cai no nome da mesa cadastrada', () => {
    const cards = buildTableCards({
      tables: [table({ id: 't2', name: '2' })],
      orders: [order({ id: 'old', table_id: null, table_number: ' 2 ', order_number: 4 })],
      companyId: C1,
    });
    assert.equal(cards.length, 1);
    assert.equal(cards[0].key, 'table:t2');
    assert.equal(cards[0].comandas.length, 1);
    assert.equal(cards[0].comandas[0].id, 'old');
    assert.equal(cards[0].legacyCount, 1);
  });

  it('pedido com table_id desconhecido nao some: vira cartao proprio', () => {
    const cards = buildTableCards({
      tables: [table()],
      orders: [order({ id: 'orphan', table_id: 't9', table_number: '9' })],
      companyId: C1,
    });
    const orphan = cards.find((c) => c.tableId === 't9');
    assert.equal(orphan.comandas.length, 1);
    assert.equal(orphan.comandas[0].id, 'orphan');
  });

  it('nao duplica pedido legado que casa com mesa cadastrada e ignora inativos/outra empresa', () => {
    const cards = buildTableCards({
      tables: [table({ id: 't1', name: '1' })],
      orders: [
        order({ id: 'a', table_id: 't1', order_number: 1 }),
        order({ id: 'b', table_id: null, table_number: '1', order_number: 2 }),
        order({ id: 'cancel', table_id: 't1', status: 'cancelado', order_number: 3 }),
        order({ id: 'other', table_id: 't1', company_id: 'company-2', order_number: 4 }),
      ],
      companyId: C1,
    });
    assert.equal(cards.length, 1);
    assert.deepEqual(cards[0].comandas.map((c) => c.id), ['a', 'b']);
    assert.equal(cards[0].status, 'multipla');
  });

  it('findTableCard prioriza id e aceita nome normalizado', () => {
    const cards = buildTableCards({ tables: [table({ id: 't1', name: 'Mesa 1' })], orders: [], companyId: C1 });
    assert.equal(findTableCard(cards, { tableId: 't1' }).name, 'Mesa 1');
    assert.equal(findTableCard(cards, { tableName: ' Mesa 1 ' }).tableId, 't1');
    assert.equal(findTableCard(cards, { tableId: 'nope', tableName: 'Mesa 1' }).tableId, 't1');
  });
});

describe('pdvWorkspace - comandas da mesa', () => {
  it('prioriza table_id e aceita legado pelo nome', () => {
    const orders = [
      order({ id: 'id', table_id: 't1', table_number: '1' }),
      order({ id: 'legacy', table_id: null, table_number: '1' }),
      order({ id: 'other', table_id: 't2', table_number: '2' }),
    ];
    const list = comandasForTable(orders, 't1', '1', C1);
    assert.deepEqual(list.map((o) => o.id), ['id', 'legacy']);
  });

  it('sem table_id filtra apenas pelo nome normalizado', () => {
    const orders = [
      order({ id: 'a', table_id: null, table_number: '1' }),
      order({ id: 'b', table_id: null, table_number: '10' }),
      order({ id: 'c', table_id: 't1', table_number: '1' }),
    ];
    const list = comandasForTable(orders, null, ' 1 ', C1);
    assert.deepEqual(list.map((o) => o.id), ['a', 'c']);
  });
});

describe('pdvWorkspace - comanda mais recente', () => {
  it('usa created_date independentemente da ordem recebida', () => {
    const comandas = [
      order({ id: 'old', order_number: 1, created_date: '2026-01-01T10:00:00Z' }),
      order({ id: 'new', order_number: 2, created_date: '2026-01-01T12:00:00Z' }),
      order({ id: 'mid', order_number: 3, created_date: '2026-01-01T11:00:00Z' }),
    ];
    assert.equal(pickLatestComanda(comandas).id, 'new');
    assert.deepEqual(sortComandasByRecency(comandas).map((c) => c.id), ['old', 'mid', 'new']);
  });

  it('aceita created_at quando created_date nao existe', () => {
    const comandas = [
      order({ id: 'a', created_date: null, created_at: '2026-02-01T10:00:00Z' }),
      order({ id: 'b', created_date: null, created_at: '2026-02-01T11:00:00Z' }),
    ];
    assert.equal(pickLatestComanda(comandas).id, 'b');
  });

  it('desempata por order_number e depois por id', () => {
    const byNumber = [
      order({ id: 'a', order_number: 5, created_date: '2026-03-01T10:00:00Z' }),
      order({ id: 'b', order_number: 8, created_date: '2026-03-01T10:00:00Z' }),
    ];
    assert.equal(pickLatestComanda(byNumber).id, 'b');

    const byId = [
      order({ id: 'a', order_number: 5, created_date: '2026-03-01T10:00:00Z' }),
      order({ id: 'b', order_number: 5, created_date: '2026-03-01T10:00:00Z' }),
    ];
    assert.equal(pickLatestComanda(byId).id, 'b');
    assert.equal(pickLatestComanda([...byId].reverse()).id, 'b');
  });

  it('datas invalidas ou ausentes continuam deterministicas', () => {
    const comandas = [
      order({ id: 'b', order_number: 0, created_date: 'invalida' }),
      order({ id: 'a', order_number: 0, created_date: null }),
      order({ id: 'c', order_number: 2, created_date: undefined }),
    ];
    assert.equal(pickLatestComanda(comandas).id, 'c');
    assert.equal(pickLatestComanda([...comandas].reverse()).id, 'c');
  });

  it('distingue linhas locais de linhas ja enviadas', () => {
    const items = [
      { id: 'sent', persisted: true, quantity: 2 },
      { id: 'local', quantity: 1 },
    ];
    assert.equal(hasLocalDraftItems(items), true);
    assert.equal(hasLocalDraftItems([items[0]]), false);
    assert.deepEqual(localDraftItemsOnly(items).map((i) => i.id), ['local']);
  });
});
