// DELLVERY 3 — Decisão de impressão pós-aceite (puro, testável).
// Centraliza a regra antes espalhada só no Kanban (Pedidos.jsx): dada a
// configuração da empresa + a transição persistida, decide entre:
//   'none'   — nada automático (modo manual, sem etapas ou já impresso).
//   'prompt' — pedir confirmação (PrintPromptModal) antes de abrir o cupom.
//   'auto'   — abrir a rota de impressão em nova aba (1 clique confirma;
//              silenciosa nunca garantida — ver printSettings.js).
// Chamado SOMENTE após sucesso confirmado do aceite/status. Nunca altera
// status, nunca duplica pedido. Reimpressão manual (rota /impressao) não
// passa por aqui e nunca usa o dedupe.
import {
  resolvePrintTrigger,
  wasPrinted,
} from './printSettings.js';
import {
  LEGACY_STAGE_SEED,
  displayStages as buildDisplayStages,
  stageForStatus,
} from '../api/orderStages.js';

// Fallback legado (mesmo do Kanban): sem stages configuráveis, as colunas
// espelham o seed — pedido nunca fica sem etapa natural para a decisão.
export function legacyFallbackDisplayStages() {
  return buildDisplayStages(LEGACY_STAGE_SEED.map((s) => ({
    id: `legacy-${s.key}`,
    company_id: null,
    key: s.key,
    mapsTo: s.mapsTo,
    name: s.name,
    color: s.color,
    position: s.position,
    isInitial: s.isInitial,
    isFinal: s.isFinal,
    active: true,
  })));
}

// Etapas para a decisão: configuradas quando houver, senão o fallback.
// `stages` cru (lista da empresa) ou já-resolvido via `displayStages`.
export function resolveDisplayStages(stages, displayStages) {
  if (Array.isArray(displayStages) && displayStages.length > 0) return displayStages;
  if (Array.isArray(stages) && stages.length > 0) return buildDisplayStages(stages);
  return legacyFallbackDisplayStages();
}

// URL do cupom de cozinha na rota dedicada.
export function printUrl(orderId, stageName) {
  return `/impressao/${orderId}?modo=cozinha${stageName ? `&etapa=${encodeURIComponent(stageName)}` : ''}`;
}

// Decisão completa pós-transição persistida. Retorna:
//   { kind: 'none' } ou { kind: 'prompt'|'auto', url, stageId, stageName }.
// `store` opcional (testes); sem ele usa localStorage quando disponível.
// Dedupe (wasPrinted) bloqueia só a repetição automática; a primeira
// impressão de uma transição sempre passa (registro ainda ausente).
export function decidePrintTrigger({ printCfg, stages, displayStages, toStatus, orderId, store }) {
  if (!printCfg || printCfg.mode === 'manual') return { kind: 'none' };
  const resolved = resolveDisplayStages(stages, displayStages);
  const stage = stageForStatus(resolved, toStatus);
  const key = stage?.id || toStatus;
  if (!key || wasPrinted(orderId, key, store)) return { kind: 'none' };
  const how = resolvePrintTrigger({
    settings: printCfg,
    toStageId: stage?.id,
    toMapsTo: toStatus,
    displayStages: resolved,
  });
  if (how === 'none') return { kind: 'none' };
  const stageName = stage?.name || toStatus;
  return { kind: how, url: printUrl(orderId, stageName), stageId: key, stageName };
}

// Abre a rota de impressão em nova aba. NÃO confia só no retorno de
// window.open: referência nula/undefined, aba já fechada, exceção ou
// window.open indisponível contam como falha detectável (bloqueio de
// popup, erro de navegação). Falha NA PÁGINA de impressão (após abrir)
// não é observável pelo opener — limitação documentada: o botão de
// nova tentativa permanece disponível e nunca re-aceita o pedido.
export function openPrintWindow(url) {
  try {
    if (typeof window === 'undefined' || typeof window.open !== 'function') {
      return { ok: false, reason: 'unavailable' };
    }
    const w = window.open(url, '_blank', 'noopener');
    if (!w) return { ok: false, reason: 'blocked' };
    let closed = false;
    try {
      closed = !!w.closed;
    } catch {
      closed = false;
    }
    if (closed) return { ok: false, reason: 'blocked' };
    return { ok: true };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

export const PRINT_FAILURE_MESSAGE = {
  blocked: 'Janela bloqueada — permita pop-ups ou use o botão Imprimir.',
  unavailable: 'Impressão indisponível neste navegador — use o botão Imprimir.',
  error: 'Falha ao abrir a impressão — tente novamente pelo botão Imprimir.',
};
