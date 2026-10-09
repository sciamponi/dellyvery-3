// Retomada de pedido no cardápio público (sem login).
// Persiste o tracking_token por loja; o pedido em si continua vindo da
// RPC get_order_by_token. Falha de storage nunca bloqueia o fluxo.

export const ACTIVE_RESUME_STATUSES = [
  'novo',
  'confirmado',
  'em_preparo',
  'aguardando_retirada',
  'saiu_entrega',
];

export function resumeKey(slug) {
  return `dellyvery:pedido:${slug || ''}`;
}

export function isActiveOrderStatus(status) {
  return ACTIVE_RESUME_STATUSES.includes(status);
}

function storage() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch { /* ambiente sem storage */ }
  return null;
}

export function saveResume(slug, token) {
  try {
    const store = storage();
    if (!store || !slug || !token) return false;
    store.setItem(resumeKey(slug), JSON.stringify({ token, createdAt: Date.now() }));
    return true;
  } catch {
    return false;
  }
}

export function loadResume(slug) {
  try {
    const store = storage();
    if (!store || !slug) return null;
    const raw = store.getItem(resumeKey(slug));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.token !== 'string' || !parsed.token) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearResume(slug) {
  try {
    const store = storage();
    if (!store || !slug) return;
    store.removeItem(resumeKey(slug));
  } catch { /* ignore */ }
}
