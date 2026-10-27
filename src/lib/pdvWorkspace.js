// DELLVERY 3 — Preferências e mesas do PDV (puro, sem React/rede).
// A mesa cadastrada é identificada por table_id; pedidos antigos sem vínculo
// continuam visíveis pelo nome (table_number) sem duplicar comandas.

import { comandaSummary, isActiveComanda, normalizeTable } from './tableComandas.js';

export const PDV_VIEWS = ['produtos', 'mesas'];
export const PDV_ASSEMBLY_MODES = ['lista', 'auto'];
export const DEFAULT_PDV_VIEW = 'produtos';
export const DEFAULT_PDV_ASSEMBLY = 'auto';

const PREF_PREFIX = 'dellyvery:pdv';

function safeStore(store) {
  if (store) return store;
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch { /* ignore */ }
  return null;
}

function readPref(key, allowed, fallback, store) {
  try {
    const value = safeStore(store)?.getItem(key);
    return allowed.includes(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function writePref(key, value, allowed, store) {
  try {
    if (!allowed.includes(value)) return false;
    safeStore(store)?.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function getPdvView(store) {
  return readPref(`${PREF_PREFIX}:view`, PDV_VIEWS, DEFAULT_PDV_VIEW, store);
}

export function setPdvView(view, store) {
  return writePref(`${PREF_PREFIX}:view`, view, PDV_VIEWS, store);
}

export function getPdvAssemblyMode(store) {
  return readPref(`${PREF_PREFIX}:assembly`, PDV_ASSEMBLY_MODES, DEFAULT_PDV_ASSEMBLY, store);
}

export function setPdvAssemblyMode(mode, store) {
  return writePref(`${PREF_PREFIX}:assembly`, mode, PDV_ASSEMBLY_MODES, store);
}

function cardTotal(comandas) {
  return comandas.reduce((sum, c) => sum + (Number(c.total) || 0), 0);
}

function cardItemCount(comandas) {
  return comandas.reduce((sum, c) => sum + (Number(c.itemCount) || 0), 0);
}

function finalizeCard(card) {
  const comandas = [...card.comandas].sort((a, b) => (a.order_number || 0) - (b.order_number || 0));
  return {
    ...card,
    comandas,
    total: cardTotal(comandas),
    itemCount: cardItemCount(comandas),
    status: comandas.length === 0 ? 'livre' : comandas.length > 1 ? 'multipla' : 'ocupada',
  };
}

/**
 * Monta os cartões de mesa do PDV.
 * - Mesa cadastrada: agrupa por orders.table_id (referência principal).
 * - Pedido antigo sem table_id: cai no nome normalizado, sem criar outro cartão
 *   para a mesma mesa cadastrada.
 * - Pedido com table_id desconhecido (mesa inativa/removida) ou sem mesa
 *   cadastrada: vira cartão próprio para não sumir da operação.
 */
export function buildTableCards({ tables = [], orders = [], companyId = null } = {}) {
  const cards = new Map();
  const keyByTableId = new Map();
  const keyByName = new Map();

  const ensureCard = ({ key, tableId = null, name = '', code = '', notes = '', active = true }) => {
    if (cards.has(key)) return cards.get(key);
    const card = {
      key,
      tableId,
      name: normalizeTable(name),
      code: code || '',
      notes: notes || '',
      active: active !== false,
      legacyCount: 0,
      comandas: [],
    };
    cards.set(key, card);
    if (tableId) keyByTableId.set(tableId, key);
    if (card.name) keyByName.set(card.name, key);
    return card;
  };

  for (const t of tables || []) {
    if (!t?.id) continue;
    ensureCard({
      key: `table:${t.id}`,
      tableId: t.id,
      name: t.name,
      code: t.code,
      notes: t.notes,
      active: t.active !== false,
    });
  }

  for (const order of orders || []) {
    if (!isActiveComanda(order)) continue;
    if (companyId && order.company_id && order.company_id !== companyId) continue;

    let card = null;
    if (order.table_id) {
      const key = keyByTableId.get(order.table_id) || `table:${order.table_id}`;
      card = ensureCard({
        key,
        tableId: order.table_id,
        name: order.table_number || 'Mesa',
      });
    } else {
      const name = normalizeTable(order.table_number);
      if (name) {
        const key = keyByName.get(name) || `legacy:${name}`;
        card = ensureCard({ key, name });
        card.legacyCount += 1;
      } else {
        card = ensureCard({ key: 'sem-mesa', name: 'Sem mesa' });
      }
    }
    card.comandas.push(comandaSummary(order));
  }

  return [...cards.values()]
    .map(finalizeCard)
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }));
}

// Pedidos ativos da mesa selecionada. Prioriza table_id; pedidos antigos sem
// vínculo entram apenas pelo nome para manter compatibilidade.
export function comandasForTable(orders = [], tableId = null, tableName = '', companyId = null) {
  const name = normalizeTable(tableName);
  return (orders || []).filter((order) => {
    if (!isActiveComanda(order)) return false;
    if (companyId && order.company_id && order.company_id !== companyId) return false;
    if (tableId) {
      return order.table_id === tableId
        || (!order.table_id && !!name && normalizeTable(order.table_number) === name);
    }
    return !!name && normalizeTable(order.table_number) === name;
  });
}

export function findTableCard(cards = [], { tableId = null, tableName = '' } = {}) {
  if (tableId) {
    const byId = cards.find((c) => c.tableId === tableId);
    if (byId) return byId;
  }
  const name = normalizeTable(tableName);
  if (!name) return null;
  return cards.find((c) => c.name === name) || null;
}

function comandaTimestamp(comanda) {
  const raw = comanda?.created_date ?? comanda?.created_at ?? '';
  if (!raw) return 0;
  const value = Date.parse(raw);
  return Number.isFinite(value) ? value : 0;
}

function comandaNumber(comanda) {
  const value = Number(comanda?.order_number);
  return Number.isFinite(value) ? value : 0;
}

// Ordem estavel por criacao real (created_date do adapter = orders.created_at),
// desempatando por numero e id. Datas invalidas/ausentes caem em 0 e nunca
// dependem da ordem em que o array chegou.
export function compareComandasByRecency(a, b) {
  const byDate = comandaTimestamp(a) - comandaTimestamp(b);
  if (byDate !== 0) return byDate;
  const byNumber = comandaNumber(a) - comandaNumber(b);
  if (byNumber !== 0) return byNumber;
  return String(a?.id ?? '').localeCompare(String(b?.id ?? ''), 'en');
}

export function sortComandasByRecency(comandas = []) {
  return [...(comandas || [])].sort(compareComandasByRecency);
}

export function pickLatestComanda(comandas = []) {
  const sorted = sortComandasByRecency(comandas);
  return sorted[sorted.length - 1] || null;
}

// Linhas persistidas sao somente leitura no PDV local. Qualquer item novo
// (inclusive igual a um ja enviado) permanece em uma linha separada.
export function hasLocalDraftItems(items = []) {
  return (items || []).some((item) => !item?.persisted);
}

export function localDraftItemsOnly(items = []) {
  return (items || []).filter((item) => !item?.persisted);
}
