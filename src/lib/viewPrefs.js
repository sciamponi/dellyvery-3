// DELLVERY 3 — Preferência de visualização por área (puro + storage).
// Cada seção mantém sua escolha (cards|lista) entre navegações e reloads
// via localStorage. Falha de storage => default, nunca quebra a tela.

export const VIEW_MODES = ['cards', 'lista'];

export function viewKey(area) {
  return `dellyvery:view:${area || 'geral'}`;
}

function safeStore(store) {
  if (store) return store;
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch { /* ignore */ }
  return null;
}

export function getViewMode(area, store) {
  try {
    const v = safeStore(store)?.getItem(viewKey(area));
    return VIEW_MODES.includes(v) ? v : 'cards';
  } catch {
    return 'cards';
  }
}

export function setViewMode(area, mode, store) {
  try {
    if (!VIEW_MODES.includes(mode)) return false;
    safeStore(store)?.setItem(viewKey(area), mode);
    return true;
  } catch {
    return false;
  }
}
