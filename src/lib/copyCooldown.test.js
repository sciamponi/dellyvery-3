import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { COOLDOWN_SECONDS, createCooldownController, copyText } from './copyCooldown.js';

// Timers falsos: determinísticos, sem esperar 4s reais.
function fakeTimers() {
  const fns = new Map();
  let next = 1;
  return {
    setIntervalFn: (fn) => {
      const id = next++;
      fns.set(id, fn);
      return id;
    },
    clearIntervalFn: (id) => {
      fns.delete(id);
    },
    tick: (n = 1) => {
      for (let i = 0; i < n; i++) [...fns.values()].forEach((fn) => fn());
    },
    active: () => fns.size,
  };
}

describe('copyCooldown', () => {
  it('constante de 4 segundos', () => {
    assert.equal(COOLDOWN_SECONDS, 4);
  });

  it('success inicia cooldown 4..1 e libera ao fim', () => {
    const t = fakeTimers();
    const c = createCooldownController({ ...t });
    assert.equal(c.cooling, false);
    c.success();
    assert.equal(c.cooling, true);
    assert.equal(c.remaining, 4);
    t.tick(1);
    assert.equal(c.remaining, 3);
    t.tick(2);
    assert.equal(c.remaining, 1);
    t.tick(1);
    assert.equal(c.remaining, 0);
    assert.equal(c.cooling, false);
    assert.equal(t.active(), 0);
  });

  it('novo success reinicia sem duplicar timer', () => {
    const t = fakeTimers();
    const c = createCooldownController({ ...t });
    c.success();
    t.tick(2);
    assert.equal(c.remaining, 2);
    c.success();
    assert.equal(c.remaining, 4);
    assert.equal(t.active(), 1);
  });

  it('dispose limpa timer e listeners', () => {
    const t = fakeTimers();
    const c = createCooldownController({ ...t });
    let calls = 0;
    c.subscribe(() => {
      calls++;
    });
    c.success();
    c.dispose();
    assert.equal(t.active(), 0);
    assert.equal(c.cooling, false);
    t.tick(5);
    assert.equal(calls, 1);
  });

  it('copyText resolve true no sucesso e lança na falha', async () => {
    let written = null;
    const ok = { writeText: async (v) => { written = v; } };
    assert.equal(await copyText('abc', ok), true);
    assert.equal(written, 'abc');
    const bad = { writeText: async () => { throw new Error('negado'); } };
    await assert.rejects(() => copyText('abc', bad), /negado/);
    await assert.rejects(() => copyText('abc', null), /indisponível/);
  });
});
