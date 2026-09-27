/**
 * Bloqueio de seleção com liberação por pressão prolongada.
 *
 * Estado: bloqueado por padrão. `press()` inicia um timer invisível
 * (HOLD_MS). `move()` além da tolerância, `release()` ou `cancel()` antes
 * do tempo cancelam. Ao completar, `onUnlock` é chamado UMA vez e o estado
 * fica liberado até o próximo `press()` (que relocka e reinicia o ciclo).
 * Sem contadores, sem superfície de tempo, sem UI.
 */

export const HOLD_TO_SELECT_MS = 4000;
export const HOLD_MOVE_TOLERANCE_PX = 10;

export function createHoldToSelect({
  holdMs = HOLD_TO_SELECT_MS,
  moveTolerancePx = HOLD_MOVE_TOLERANCE_PX,
  onUnlock,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
} = {}) {
  let timer = null;
  let pressing = false;
  let unlocked = false;
  let startX = 0;
  let startY = 0;

  const clear = () => {
    if (timer) {
      clearTimeoutFn(timer);
      timer = null;
    }
  };

  return {
    get unlocked() {
      return unlocked;
    },
    press(x = 0, y = 0) {
      // Novo toque: relocka e reinicia o ciclo.
      unlocked = false;
      pressing = true;
      startX = x;
      startY = y;
      clear();
      timer = setTimeoutFn(() => {
        timer = null;
        pressing = false;
        unlocked = true;
        onUnlock?.();
      }, holdMs);
    },
    move(x = 0, y = 0) {
      if (!pressing) return;
      const dx = x - startX;
      const dy = y - startY;
      if (dx * dx + dy * dy > moveTolerancePx * moveTolerancePx) {
        pressing = false;
        clear();
      }
    },
    release() {
      pressing = false;
      clear();
    },
    cancel() {
      pressing = false;
      clear();
    },
  };
}
