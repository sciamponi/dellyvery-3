import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { UPDATE_TABS, STATUS_META, UPDATES, updatesByTab, detailsOf } from './updates.js';

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

  it('disponíveis têm detalhe próprio completo', () => {
    const keys = ['what', 'how', 'why', 'usage'];
    for (const u of UPDATES.filter(u => u.status === 'disponivel')) {
      assert.ok(u.details, u.id);
      for (const k of keys) assert.ok(u.details[k]?.length > 10, `${u.id}.${k}`);
    }
  });

  it('futuros usam template por status', () => {
    for (const u of UPDATES.filter(u => u.status !== 'disponivel')) {
      const d = detailsOf(u);
      assert.ok(d.what && d.how && d.why && d.usage, u.id);
    }
    assert.ok(detailsOf(null).what);
  });

  it('ordenação por sort_order dentro da aba', () => {
    for (const t of UPDATE_TABS) {
      const list = updatesByTab(t.id).map(u => u.sort_order ?? 0);
      assert.deepEqual(list, [...list].sort((a, b) => a - b), t.id);
    }
  });
});
