import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLinkOpTracker } from './linkOp.js';

// Simula o componente: linking + conclusão de operação com Promises
// controladas (sem setTimeout arbitrário).
function makeHarness() {
  const tracker = createLinkOpTracker();
  let linking = null;
  const finishOp = (opId, msg) => {
    const applied = { data: true, toast: msg };
    if (tracker.shouldClose(opId)) linking = null;
    return { applied, linking };
  };
  return {
    tracker,
    open: (section) => {
      linking = section;
      tracker.userNavigated();
    },
    getLinking: () => linking,
    finishOp,
  };
}

describe('linkOp — corrida salvar comanda x abrir outra seção', () => {
  it('operação antiga não fecha seção aberta depois (sequência exigida)', async () => {
    const h = makeHarness();
    // 1. Abre a seção de nome da comanda.
    h.open('comanda');
    // 2. Inicia o salvamento (resposta pendente = Promise controlada).
    let resolveSave;
    const pending = new Promise((res) => { resolveSave = res; });
    const opId = h.tracker.beginOp();
    const done = pending.then(() => h.finishOp(opId, 'Nome da comanda salvo!'));
    // 3-4. Resposta ainda pendente; abre outra seção de vínculo.
    h.open('customer');
    assert.equal(h.getLinking(), 'customer');
    // 5. Resolve a operação anterior.
    resolveSave();
    const r = await done;
    // 6. Nova seção permanece aberta; dados/toast da antiga aplicam.
    assert.equal(r.applied.data, true);
    assert.equal(r.applied.toast, 'Nome da comanda salvo!');
    assert.equal(h.getLinking(), 'customer');
    assert.equal(r.linking, 'customer');
  });

  it('seção original sem navegação fecha e finaliza normalmente', async () => {
    const h = makeHarness();
    h.open('comanda');
    let resolveSave;
    const pending = new Promise((res) => { resolveSave = res; });
    const opId = h.tracker.beginOp();
    const done = pending.then(() => h.finishOp(opId, 'Nome da comanda salvo!'));
    resolveSave();
    const r = await done;
    assert.equal(r.linking, null);
    assert.equal(h.getLinking(), null);
  });

  it('reset (troca de pedido) invalida fechamento pendente', () => {
    const t = createLinkOpTracker();
    t.userNavigated();
    const opId = t.beginOp();
    t.reset();
    assert.equal(t.shouldClose(opId), false);
  });

  it('Fechar manual invalida a operação pendente', () => {
    const t = createLinkOpTracker();
    t.userNavigated();
    const opId = t.beginOp();
    t.userNavigated();
    assert.equal(t.shouldClose(opId), false);
  });
});
