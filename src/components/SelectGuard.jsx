import React, { useEffect, useRef } from 'react';
import { createHoldToSelect } from '@/lib/holdToSelect';

// Bloqueio de seleção/cópia acidental no painel autenticado.
//
// - Por padrão: user-select none + sem callout de toque no container.
// - Segurar 4s sobre conteúdo não-interativo: libera a seleção daquele
//   bloco até o próximo toque (que relocka e reinicia o ciclo).
// - Soltar/mover/cancelar antes: continua bloqueado.
// - Interativos (input, textarea, select, button, a, menus, dnd) e
//   contenteditable: intocados. Listeners passivos, sem preventDefault
//   (não quebra scroll, clique, drag do Kanban, modais ou formulários).

const INTERACTIVE_SELECTOR = [
  'input', 'textarea', 'select', 'button', 'a',
  '[contenteditable]', '[contenteditable="true"]',
  '[role="button"]', '[role="menu"]', '[role="menuitem"]',
  '[data-dnd]', '[data-no-select-guard]',
].join(',');

export default function SelectGuard({ children, className = '' }) {
  const ref = useRef(null);
  const unlockToken = useRef(0);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;

    const isInteractive = (target) => {
      if (!(target instanceof Element)) return false;
      return !!target.closest(INTERACTIVE_SELECTOR);
    };

    const clearUnlocked = () => {
      root.querySelectorAll('[data-hold-unlocked]').forEach((el) => {
        el.removeAttribute('data-hold-unlocked');
      });
    };

    const ctrl = createHoldToSelect({
      onUnlock: () => {
        const id = unlockToken.current;
        const anchor = root.querySelector(`[data-hold-anchor="${id}"]`);
        anchor?.removeAttribute('data-hold-anchor');
        if (anchor) anchor.setAttribute('data-hold-unlocked', 'true');
      },
    });

    const onPointerDown = (e) => {
      // Novo toque: relocka tudo e reinicia o ciclo.
      clearUnlocked();
      ctrl.press(e.clientX, e.clientY);
      if (isInteractive(e.target)) {
        // Interativo: não conta como pressão sobre conteúdo.
        ctrl.cancel();
        return;
      }
      const block = e.target instanceof Element
        ? (e.target.closest('p, h1, h2, h3, h4, li, td, span, div') || root)
        : root;
      unlockToken.current += 1;
      block.setAttribute('data-hold-anchor', String(unlockToken.current));
    };
    const onPointerMove = (e) => ctrl.move(e.clientX, e.clientY);
    const onPointerUp = () => ctrl.release();
    const onPointerCancel = () => ctrl.cancel();
    const onPointerLeave = () => ctrl.cancel();

    root.addEventListener('pointerdown', onPointerDown, { passive: true });
    root.addEventListener('pointermove', onPointerMove, { passive: true });
    root.addEventListener('pointerup', onPointerUp, { passive: true });
    root.addEventListener('pointercancel', onPointerCancel, { passive: true });
    root.addEventListener('pointerleave', onPointerLeave, { passive: true });
    return () => {
      ctrl.cancel();
      root.removeEventListener('pointerdown', onPointerDown);
      root.removeEventListener('pointermove', onPointerMove);
      root.removeEventListener('pointerup', onPointerUp);
      root.removeEventListener('pointercancel', onPointerCancel);
      root.removeEventListener('pointerleave', onPointerLeave);
    };
  }, []);

  return (
    <div ref={ref} className={`select-guard ${className}`}>
      <style>{`
        .select-guard { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
        .select-guard input, .select-guard textarea, .select-guard select, .select-guard [contenteditable] { -webkit-user-select: text; user-select: text; -webkit-touch-callout: default; }
        .select-guard [data-hold-unlocked] { -webkit-user-select: text; user-select: text; -webkit-touch-callout: default; }
      `}</style>
      {children}
    </div>
  );
}
