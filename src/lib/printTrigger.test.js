import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  legacyFallbackDisplayStages,
  resolveDisplayStages,
  printUrl,
  decidePrintTrigger,
  openPrintWindow,
  PRINT_FAILURE_MESSAGE,
} from './printTrigger.js';

function memStore() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
  };
}

const display = [
  { id: 'st-novo', mapsTo: 'novo', name: 'Novo' },
  { id: 'st-conf', mapsTo: 'confirmado', name: 'Confirmado' },
];

describe('printTrigger — url e fallback', () => {
  it('printUrl monta a rota do cupom com etapa encodada', () => {
    assert.equal(printUrl('abc', 'Confirmado'), '/impressao/abc?modo=cozinha&etapa=Confirmado');
    assert.equal(printUrl('abc', ''), '/impressao/abc?modo=cozinha');
    assert.equal(printUrl('abc'), '/impressao/abc?modo=cozinha');
  });

  it('fallback legado cobre todos os status sem stages', () => {
    const stages = legacyFallbackDisplayStages();
    const maps = stages.map((s) => s.mapsTo);
    for (const st of ['novo', 'confirmado', 'em_preparo', 'aguardando_retirada', 'saiu_entrega', 'finalizado', 'cancelado']) {
      assert.ok(maps.includes(st), `sem etapa para ${st}`);
    }
  });

  it('resolveDisplayStages prefere pronto > cru > fallback', () => {
    assert.deepEqual(resolveDisplayStages(null, display), display);
    assert.ok(resolveDisplayStages(null, []).length > 0);
    assert.ok(resolveDisplayStages(null, null).length > 0);
  });
});

describe('printTrigger — decidePrintTrigger (paridade com o Kanban)', () => {
  it('manual ou config ausente nunca dispara', () => {
    assert.deepEqual(
      decidePrintTrigger({ printCfg: null, displayStages: display, toStatus: 'confirmado', orderId: 'o1', store: memStore() }),
      { kind: 'none' },
    );
    assert.deepEqual(
      decidePrintTrigger({ printCfg: { mode: 'manual', stages: ['st-conf'] }, displayStages: display, toStatus: 'confirmado', orderId: 'o1', store: memStore() }),
      { kind: 'none' },
    );
  });

  it('primeira impressão passa; repetição é dedupada', () => {
    const store = memStore();
    const cfg = { mode: 'confirm', stages: ['st-conf'] };
    const first = decidePrintTrigger({ printCfg: cfg, displayStages: display, toStatus: 'confirmado', orderId: 'o1', store });
    assert.equal(first.kind, 'prompt');
    assert.equal(first.url, '/impressao/o1?modo=cozinha&etapa=Confirmado');
    assert.equal(first.stageId, 'st-conf');
    // Simula o markPrinted pós-abertura bem-sucedida (fluxo do Kanban).
    store.setItem('dellyvery:print:o1:st-conf', '1');
    assert.deepEqual(
      decidePrintTrigger({ printCfg: cfg, displayStages: display, toStatus: 'confirmado', orderId: 'o1', store }),
      { kind: 'none' },
    );
    // Outro pedido/etapa não é afetado pelo dedupe.
    const other = decidePrintTrigger({ printCfg: cfg, displayStages: display, toStatus: 'confirmado', orderId: 'o2', store });
    assert.equal(other.kind, 'prompt');
  });

  it('modo auto abre direto; etapa fora da config não dispara', () => {
    const store = memStore();
    const auto = decidePrintTrigger({
      printCfg: { mode: 'auto', stages: ['st-conf'] }, displayStages: display, toStatus: 'confirmado', orderId: 'o9', store,
    });
    assert.equal(auto.kind, 'auto');
    assert.ok(auto.url.startsWith('/impressao/o9'));
    const full = [...display, { id: 'st-prep', mapsTo: 'em_preparo', name: 'Em preparo' }];
    const off = decidePrintTrigger({
      printCfg: { mode: 'auto', stages: ['st-conf'] }, displayStages: full, toStatus: 'em_preparo', orderId: 'o9', store,
    });
    assert.deepEqual(off, { kind: 'none' });
  });

  it('sem stages usa o fallback legado (casa por mapsTo)', () => {
    const store = memStore();
    const d = decidePrintTrigger({
      printCfg: { mode: 'confirm', stages: ['legacy-confirmado'] }, stages: null, displayStages: null,
      toStatus: 'confirmado', orderId: 'o3', store,
    });
    assert.equal(d.kind, 'prompt');
    assert.equal(d.stageId, 'legacy-confirmado');
  });

  it('sem transição válida não dispara', () => {
    const store = memStore();
    assert.deepEqual(
      decidePrintTrigger({ printCfg: { mode: 'auto', stages: ['st-conf'] }, displayStages: [], toStatus: '', orderId: 'o4', store }),
      { kind: 'none' },
    );
  });
});

describe('printTrigger — openPrintWindow (não confia só no retorno)', () => {
  it('bloqueio (null/undefined/fechada) e erro viram falha detectável', () => {
    const real = globalThis.window;
    try {
      globalThis.window = { open: () => null };
      assert.deepEqual(openPrintWindow('/x'), { ok: false, reason: 'blocked' });
      globalThis.window = { open: () => undefined };
      assert.deepEqual(openPrintWindow('/x'), { ok: false, reason: 'blocked' });
      globalThis.window = { open: () => ({ closed: true }) };
      assert.deepEqual(openPrintWindow('/x'), { ok: false, reason: 'blocked' });
      globalThis.window = { open: () => { throw new Error('navegação'); } };
      assert.deepEqual(openPrintWindow('/x'), { ok: false, reason: 'error' });
      globalThis.window = {};
      assert.deepEqual(openPrintWindow('/x'), { ok: false, reason: 'unavailable' });
      globalThis.window = { open: () => ({ closed: false }) };
      assert.deepEqual(openPrintWindow('/x'), { ok: true });
    } finally {
      if (real === undefined) delete globalThis.window;
      else globalThis.window = real;
    }
  });

  it('mensagens de falha cobrem todos os motivos', () => {
    for (const r of ['blocked', 'unavailable', 'error']) {
      assert.ok(typeof PRINT_FAILURE_MESSAGE[r] === 'string' && PRINT_FAILURE_MESSAGE[r].length > 0);
    }
  });
});
