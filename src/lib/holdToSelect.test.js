import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HOLD_TO_SELECT_MS, HOLD_MOVE_TOLERANCE_PX, createHoldToSelect } from './holdToSelect.js';

// Timers falsos one-shot com tempo virtual.
function fakeTimers() {
  let now = 0;
  let next = 1;
  const timers = new Map();
  return {
    setTimeoutFn: (fn, ms) => {
      const id = next++;
      timers.set(id, { fn, at: now + (ms || 0) });
      return id;
    },
    clearTimeoutFn: (id) => {
      timers.delete(id);
    },
    advance: (ms) => {
      now += ms;
      for (const [id, t] of [...timers]) {
        if (t.at <= now) {
          timers.delete(id);
          t.fn();
        }
      }
    },
    active: () => timers.size,
  };
}

describe('holdToSelect', () => {
  it('constantes: 4s e tolerância de ~10px', () => {
    assert.equal(HOLD_TO_SELECT_MS, 4000);
    assert.equal(HOLD_MOVE_TOLERANCE_PX, 10);
  });

  it('soltar antes de 4s não libera', () => {
    const t = fakeTimers();
    let unlocked = 0;
    const c = createHoldToSelect({ ...t, onUnlock: () => { unlocked++; } });
    c.press(0, 0);
    t.advance(3999);
    c.release();
    t.advance(10000);
    assert.equal(unlocked, 0);
    assert.equal(c.unlocked, false);
  });

  it('mover além da tolerância cancela', () => {
    const t = fakeTimers();
    let unlocked = 0;
    const c = createHoldToSelect({ ...t, onUnlock: () => { unlocked++; } });
    c.press(0, 0);
    c.move(0, 11);
    t.advance(10000);
    assert.equal(unlocked, 0);
    assert.equal(t.active(), 0);
  });

  it('mover dentro da tolerância mantém o timer', () => {
    const t = fakeTimers();
    let unlocked = 0;
    const c = createHoldToSelect({ ...t, onUnlock: () => { unlocked++; } });
    c.press(0, 0);
    c.move(6, 8); // dist² = 100 = tolerância² (não excede)
    t.advance(4000);
    assert.equal(unlocked, 1);
  });

  it('4s libera uma única vez; soltar depois não relocka', () => {
    const t = fakeTimers();
    let unlocked = 0;
    const c = createHoldToSelect({ ...t, onUnlock: () => { unlocked++; } });
    c.press(0, 0);
    t.advance(4000);
    assert.equal(unlocked, 1);
    assert.equal(c.unlocked, true);
    c.release();
    assert.equal(c.unlocked, true);
    t.advance(10000);
    assert.equal(unlocked, 1);
  });

  it('próximo toque relocka e reinicia o ciclo', () => {
    const t = fakeTimers();
    let unlocked = 0;
    const c = createHoldToSelect({ ...t, onUnlock: () => { unlocked++; } });
    c.press(0, 0);
    t.advance(4000);
    assert.equal(c.unlocked, true);
    c.press(50, 50);
    assert.equal(c.unlocked, false);
    t.advance(3999);
    c.release();
    assert.equal(unlocked, 1);
  });

  it('cancel limpa o timer', () => {
    const t = fakeTimers();
    let unlocked = 0;
    const c = createHoldToSelect({ ...t, onUnlock: () => { unlocked++; } });
    c.press(0, 0);
    c.cancel();
    t.advance(10000);
    assert.equal(unlocked, 0);
    assert.equal(t.active(), 0);
  });

  it('sem superfície de tempo na API', () => {
    const c = createHoldToSelect({ onUnlock: () => {} });
    assert.deepEqual(Object.keys(c).sort(), ['cancel', 'move', 'press', 'release', 'unlocked']);
  });
});
