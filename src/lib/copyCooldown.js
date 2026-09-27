import { useEffect, useMemo, useState } from 'react';

// Cooldown de "Copiar": após sucesso no clipboard, bloqueia nova cópia por
// COOLDOWN_SECONDS (botão disabled + contagem 4..1). Falha no clipboard NÃO
// inicia cooldown. Escopo por instância (sem bloqueio global); timers
// limpos no unmount; sem timers duplicados.

export const COOLDOWN_SECONDS = 4;

export function createCooldownController({
  seconds = COOLDOWN_SECONDS,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
} = {}) {
  let remaining = 0;
  let timer = null;
  const listeners = new Set();
  const emit = () => listeners.forEach((fn) => fn(remaining));

  return {
    get remaining() {
      return remaining;
    },
    get cooling() {
      return remaining > 0;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    // Chamar SOMENTE após writeText resolver com sucesso.
    success() {
      if (timer) {
        clearIntervalFn(timer);
        timer = null;
      }
      remaining = seconds;
      emit();
      timer = setIntervalFn(() => {
        remaining -= 1;
        if (remaining <= 0) {
          remaining = 0;
          clearIntervalFn(timer);
          timer = null;
        }
        emit();
      }, 1000);
    },
    dispose() {
      if (timer) {
        clearIntervalFn(timer);
        timer = null;
      }
      listeners.clear();
      remaining = 0;
    },
  };
}

export async function copyText(text, clipboard) {
  const target = clipboard || (typeof navigator !== 'undefined' ? navigator.clipboard : null);
  if (!target?.writeText) throw new Error('Clipboard indisponível');
  await target.writeText(text);
  return true;
}

// Uso no botão:
//   const { copy, cooling, remaining } = useCopyCooldown();
//   <Button disabled={cooling} onClick={() => copy(texto)}>
//     {cooling ? `Aguarde ${remaining}s` : copiado ? 'Copiado' : 'Copiar'}
//   </Button>
export function useCopyCooldown({ seconds = COOLDOWN_SECONDS } = {}) {
  const controller = useMemo(() => createCooldownController({ seconds }), [seconds]);
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    const unsub = controller.subscribe(setRemaining);
    return () => {
      unsub();
      controller.dispose();
    };
  }, [controller]);

  const copy = async (text, clipboard) => {
    if (controller.cooling) return false;
    await copyText(text, clipboard);
    controller.success();
    return true;
  };

  return { copy, cooling: remaining > 0, remaining };
}
