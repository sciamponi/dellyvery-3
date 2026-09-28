import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { UPDATE_TABS, STATUS_META, UPDATES, updatesByTab } from './updates.js';

describe('updates — canal de atualizações', () => {
  it('6 abas na ordem', () => {
    assert.deepEqual(UPDATE_TABS.map(t => t.id), ['destaques', 'novidades', 'melhorias', 'correcoes', 'pagamentos', 'embreve']);
  });

  it('11 itens disponíveis', () => {
    assert.equal(UPDATES.filter(u => u.status === 'disponivel').length, 11);
  });

  it('13 itens futuros (desenvolvimento + embreve)', () => {
    assert.equal(UPDATES.filter(u => u.status !== 'disponivel').length, 13);
  });

  it('futuros nunca sem marca de status', () => {
    for (const u of UPDATES.filter(u => u.status !== 'disponivel')) {
      assert.ok(STATUS_META[u.status], u.id);
    }
  });

  it('updatesByTab filtra por aba', () => {
    assert.ok(updatesByTab('destaques').length >= 3);
    assert.ok(updatesByTab('embreve').length >= 3);
    assert.equal(updatesByTab('inexistente').length, 0);
  });

  it('todo item tem título, descrição e status válido', () => {
    for (const u of UPDATES) {
      assert.ok(u.title && u.desc, u.id);
      assert.ok(['disponivel', 'desenvolvimento', 'embreve'].includes(u.status), u.id);
    }
  });
});
