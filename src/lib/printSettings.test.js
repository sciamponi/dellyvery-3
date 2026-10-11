import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PRINT_MODES, normalizePrintSettings, printModeLabel, resolvePrintTrigger,
  printLogKey, wasPrinted, markPrinted,
} from './printSettings.js';

function memStore() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
  };
}

const stages = [
  { id: 'st-novo', mapsTo: 'novo', name: 'Novo' },
  { id: 'st-conf', mapsTo: 'confirmado', name: 'Confirmado' },
  { id: 'st-prep', mapsTo: 'em_preparo', name: 'Em preparo' },
];

describe('printSettings — normalização', () => {
  it('modos válidos e padrão manual', () => {
    assert.deepEqual(PRINT_MODES.map((m) => m.id), ['manual', 'confirm', 'auto']);
    assert.deepEqual(normalizePrintSettings(null), { mode: 'manual', stages: [], width: '80' });
    assert.deepEqual(
      normalizePrintSettings({ mode: 'auto', stages: ['a', 1, null], width: '58' }),
      { mode: 'auto', stages: ['a'], width: '58' },
    );
    assert.equal(normalizePrintSettings({ mode: 'x' }).mode, 'manual');
    assert.equal(printModeLabel('confirm'), 'Confirmar antes de imprimir');
  });
});

describe('printSettings — disparo por etapa real', () => {
  it('manual ou sem etapas nunca dispara', () => {
    assert.equal(resolvePrintTrigger({ settings: null, toStageId: 'st-conf', displayStages: stages }), 'none');
    assert.equal(
      resolvePrintTrigger({ settings: { mode: 'auto', stages: [] }, toStageId: 'st-conf', displayStages: stages }),
      'none',
    );
  });

  it('casa por id da etapa ou mapsTo (fallback legado)', () => {
    const cfg = { mode: 'confirm', stages: ['st-conf'] };
    assert.equal(resolvePrintTrigger({ settings: cfg, toStageId: 'st-conf', displayStages: stages }), 'prompt');
    assert.equal(resolvePrintTrigger({ settings: cfg, toStageId: 'outro', displayStages: stages }), 'none');
    const byMaps = { mode: 'auto', stages: ['st-prep'] };
    assert.equal(
      resolvePrintTrigger({ settings: byMaps, toStageId: 'st-x', toMapsTo: 'em_preparo', displayStages: stages }),
      'auto',
    );
  });
});

describe('printSettings — anti-duplicidade', () => {
  it('uma transição imprime uma vez; manual fora do registro', () => {
    const store = memStore();
    assert.equal(wasPrinted('o1', 'st-conf', store), false);
    assert.equal(markPrinted('o1', 'st-conf', store), true);
    assert.equal(wasPrinted('o1', 'st-conf', store), true);
    assert.equal(wasPrinted('o1', 'st-prep', store), false);
    assert.equal(wasPrinted('o2', 'st-conf', store), false);
    assert.equal(printLogKey('o1', 'st-conf'), 'dellyvery:print:o1:st-conf');
  });

  it('sem storage não quebra nem marca', () => {
    assert.equal(wasPrinted('o1', 's', null), false);
    assert.equal(markPrinted('o1', 's', null), false);
  });
});
