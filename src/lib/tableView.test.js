import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTableName } from './tableView.js';

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
});
