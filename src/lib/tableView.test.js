import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTableName, filterOpenTableOrders } from './tableView.js';

describe('tableView — nome real da mesa', () => {
  const tables = { t1: { id: 't1', name: 'ARANHA' } };

  it('usa o cadastro via table_id', () => {
    assert.deepEqual(
      resolveTableName({ table_id: 't1', table_number: 'X' }, tables),
      { name: 'ARANHA', missing: false },
    );
  });

  it('sem vínculo não mostra nada; sem cadastro usa table_number ou neutro', () => {
    assert.deepEqual(resolveTableName({ table_id: null }, tables), { name: null, missing: false });
    assert.deepEqual(resolveTableName({ table_id: 't9', table_number: '7' }, tables), { name: '7', missing: false });
    assert.deepEqual(resolveTableName({ table_id: 't9' }, tables), { name: null, missing: true });
    assert.deepEqual(resolveTableName({}, {}), { name: null, missing: false });
  });

  it('filtra abertos da mesa por table_id real', () => {
    const orders = [
      { id: 'a', table_id: 't1', status: 'novo' },
      { id: 'b', table_id: 't1', status: 'aguardando_retirada' },
      { id: 'c', table_id: 't1', status: 'cancelado' },
      { id: 'd', table_id: 't1', status: 'finalizado' },
      { id: 'e', table_id: 't2', status: 'novo' },
      { id: 'f', table_id: 't1', status: 'saiu_entrega', payment_status: 'paid' },
      { id: 'g', table_id: 't1', status: 'estado_futuro', payment_status: 'pending' },
    ];
    const open = filterOpenTableOrders(orders, 't1').map((o) => o.id);
    assert.deepEqual(open, ['a', 'b', 'f', 'g']);
    assert.deepEqual(filterOpenTableOrders(orders, 't9'), []);
    assert.deepEqual(filterOpenTableOrders(orders, null), []);
    assert.deepEqual(filterOpenTableOrders(null, 't1'), []);
  });
});
