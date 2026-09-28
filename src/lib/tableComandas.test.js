import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIVE_COMANDA_STATUSES,
  isActiveComanda,
  normalizeTable,
  comandaSummary,
  groupComandasByTable,
  comandasTotal,
  mergeComandaItems,
  toPdvDraftItem,
} from './tableComandas.js';

const O = (over = {}) => ({
  id: 'o1', order_number: 26, order_type: 'mesa', table_number: '02',
  status: 'novo', total: 85, customer_name: 'João', customer_phone: '119',
  items: [{ product_id: 'p1', quantity: 2 }, { product_id: 'p2', quantity: 1 }],
  ...over,
});

describe('tableComandas — comandas derivadas de pedidos', () => {
  it('status ativos reconhecidos', () => {
    assert.deepEqual(ACTIVE_COMANDA_STATUSES, ['novo', 'confirmado', 'em_preparo', 'aguardando_retirada', 'saiu_entrega']);
    assert.equal(isActiveComanda(O()), true);
    assert.equal(isActiveComanda(O({ status: 'finalizado' })), false);
    assert.equal(isActiveComanda(O({ status: 'cancelado' })), false);
    assert.equal(isActiveComanda(O({ order_type: 'delivery' })), false);
    assert.equal(isActiveComanda(null), false);
  });

  it('normalizeTable aparas e trata nulo', () => {
    assert.equal(normalizeTable(' 02 '), '02');
    assert.equal(normalizeTable(null), '');
    assert.equal(normalizeTable(undefined), '');
  });

  it('comandaSummary conta itens e total', () => {
    const s = comandaSummary(O());
    assert.equal(s.itemCount, 3);
    assert.equal(s.total, 85);
    assert.equal(s.customerName, 'João');
    assert.equal(s.table, '02');
  });

  it('agrupa por mesa com status ocupada/multipla', () => {
    const groups = groupComandasByTable([
      O({ id: 'a', order_number: 1, table_number: '02' }),
      O({ id: 'b', order_number: 2, table_number: '02' }),
      O({ id: 'c', order_number: 3, table_number: '05' }),
      O({ id: 'd', order_number: 4, table_number: '05', status: 'finalizado' }),
      O({ id: 'e', order_number: 5, table_number: '  ', status: 'novo' }),
      O({ id: 'f', order_number: 6, order_type: 'delivery', table_number: '' }),
    ]);
    assert.equal(groups.length, 2);
    assert.equal(groups[0].table, '02');
    assert.equal(groups[0].status, 'multipla');
    assert.equal(groups[0].comandas.length, 2);
    assert.equal(groups[1].table, '05');
    assert.equal(groups[1].status, 'ocupada');
  });

  it('comandasTotal soma totais', () => {
    assert.equal(comandasTotal([comandaSummary(O({ total: 85 })), comandaSummary(O({ total: 42 }))]), 127);
    assert.equal(comandasTotal([]), 0);
  });

  it('mergeComandaItems achata e ignora inválidos', () => {
    const merged = mergeComandaItems([
      [{ product_id: 'p1', quantity: 2, complements: [{ option_name: 'X' }], notes: 'ok' }],
      [{ product_id: 'p2', quantity: 1 }],
      [{ product_id: '', quantity: 1 }, { product_id: 'p3', quantity: 0 }, null],
    ]);
    assert.deepEqual(merged, [
      { product_id: 'p1', quantity: 2, complements: [{ option_name: 'X' }], notes: 'ok' },
      { product_id: 'p2', quantity: 1, complements: [], notes: '' },
    ]);
  });

  it('toPdvDraftItem preserva campos do rascunho', () => {
    const d = toPdvDraftItem({ product_id: 'p1', name: 'Burger', unit_price: '16', quantity: 2 });
    assert.equal(d.name, 'Burger');
    assert.equal(d.unit_price, 16);
    assert.equal(d.quantity, 2);
    assert.deepEqual(d.complements, []);
  });
});
