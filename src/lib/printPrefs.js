// DELLVERY 3 — Preferência "não mostrar mais" do aviso de impressão
// (puro + storage). Por empresa: um opt-out nunca silencia outra empresa.
// Falha de storage => sem opt-out, nunca quebra a impressão.

export function printSkipKey(companyId) {
  return `dellyvery:print:skip:${companyId || 'geral'}`;
}

function safeStore(store) {
  if (store) return store;
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch { /* ignore */ }
  return null;
}

export function getSkipPrintPrompt(store, companyId) {
  try {
    return safeStore(store)?.getItem(printSkipKey(companyId)) === '1';
  } catch {
    return false;
  }
}

export function setSkipPrintPrompt(store, companyId, skip) {
  try {
    const s = safeStore(store);
    if (!s) return false;
    if (skip) s.setItem(printSkipKey(companyId), '1');
    else s.removeItem(printSkipKey(companyId));
    return true;
  } catch {
    return false;
  }
}
