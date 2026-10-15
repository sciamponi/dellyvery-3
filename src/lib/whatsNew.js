// DELLVERY 3 — Modal "Novidades do Dellyvery": regras puras + persistência.
// Fonte única de conteúdo: src/data/updates.js (mesma da página Atualizações).
// Visto por usuário: mesma chave localStorage do PdvAnnouncement, mas com id
// de lote PRÓPRIO (WHATSNEW_PROJ_V1) — nunca conflita com anúncios anteriores
// e um lote novo volta a ser exibido. Sem tabelas novas, sem rede,
// sem dependências novas.
import { UPDATES } from '../data/updates.js';

export const SEEN_KEY = 'dellyvery:novidades:vistas';

// Lote atual: mesas com QR, impressão ao aceitar, aviso ao entregador,
// fechamento de repasses e entrega por região.
export const WHATSNEW_BATCH_V1 = 'WHATSNEW_PROJ_V1';

export const HIGHLIGHT_IDS = ['u31', 'u32', 'u33', 'u34', 'u35'];

/** Itens do lote atual, na ordem de destaque, vindos da fonte única. */
export function getWhatsNewHighlights() {
  const byId = new Map((UPDATES || []).map((u) => [u.id, u]));
  return HIGHLIGHT_IDS.map((id) => byId.get(id)).filter(Boolean);
}

function safeStore(store) {
  if (store) return store;
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch { /* ignore */ }
  return null;
}

function readSeen(store) {
  const s = safeStore(store);
  if (!s) return null;
  try {
    const raw = s.getItem(SEEN_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return null;
  }
}

function writeSeen(store, seen) {
  const s = safeStore(store);
  if (!s) return;
  try {
    s.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch { /* ignore */ }
}

const userKey = (userId) => userId || 'anon';

export function hasSeenWhatsNew(userId, store) {
  try {
    const seen = readSeen(store);
    if (!seen) return true;
    return (seen[userKey(userId)] || []).includes(WHATSNEW_BATCH_V1);
  } catch {
    return true;
  }
}

export function markWhatsNewSeen(userId, store) {
  try {
    const seen = readSeen(store);
    if (!seen) return;
    const key = userKey(userId);
    const list = seen[key] || [];
    if (!list.includes(WHATSNEW_BATCH_V1)) {
      seen[key] = [...list, WHATSNEW_BATCH_V1];
      writeSeen(store, seen);
    }
  } catch { /* ignore */ }
}
