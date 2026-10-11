// DELLVERY 3 — Configuração de impressão por empresa (puro, testável).
// Persistência: company_settings.settings.print = { mode, stages, width }.
//   mode: 'manual' | 'confirm' | 'auto' (padrão: manual).
//   stages: ids de stages (displayStages[].id) que disparam; vazio = nenhuma.
//   width: '58' | '80' (largura do cupom; padrão 80).
// Etapas usam os IDS reais do Kanban configurável (sem nomes fixos).
// Limitações documentadas (ver PrintPromptModal/Impressao):
// - window.print SEMPRE abre o diálogo do navegador; impressão silenciosa
//   automática NÃO é garantida (desktop ou celular) sem agente/bridge local,
//   que este projeto NÃO instala. No modo 'auto', abrimos a rota de impressão
//   em nova aba para UM clique confirmar — nunca alegamos impressão muda.

export const PRINT_MODES = [
  { id: 'manual', label: 'Manual' },
  { id: 'confirm', label: 'Confirmar antes de imprimir' },
  { id: 'auto', label: 'Automática' },
];

export const PRINT_WIDTHS = ['58', '80'];

export function normalizePrintSettings(raw) {
  const p = (raw && typeof raw === 'object' ? raw : {});
  const mode = PRINT_MODES.some((m) => m.id === p.mode) ? p.mode : 'manual';
  const stages = Array.isArray(p.stages) ? p.stages.filter((s) => typeof s === 'string') : [];
  const width = PRINT_WIDTHS.includes(p.width) ? p.width : '80';
  return { mode, stages, width };
}

export function printModeLabel(mode) {
  return PRINT_MODES.find((m) => m.id === mode)?.label || mode || 'Manual';
}

// Decide o que fazer quando um pedido CHEGA na etapa `toStageId`
// (transição from→to já persistida). Retorna 'none' | 'prompt' | 'auto'.
// `isFallbackTarget`: quando o avanço usou o fluxo legado (etapa inativa),
// usa-se o mapsTo legado para casar com a configuração.
export function resolvePrintTrigger({ settings, toStageId, toMapsTo, displayStages = [] }) {
  const cfg = normalizePrintSettings(settings);
  if (cfg.mode === 'manual' || cfg.stages.length === 0) return 'none';
  const byId = new Map((displayStages || []).map((s) => [s.id, s]));
  const hit = cfg.stages.some((id) => {
    if (id === toStageId) return true;
    const s = byId.get(id);
    return !!s && !!toMapsTo && s.mapsTo === toMapsTo;
  });
  if (!hit) return 'none';
  return cfg.mode === 'auto' ? 'auto' : 'prompt';
}

// Registro anti-duplicidade: uma transição (pedido + etapa + direção)
// imprime no máximo uma vez, mesmo com rerender/refresh/reconnect.
// Reimpressão manual NÃO usa este registro (sempre permitida).
export function printLogKey(orderId, toStageId) {
  return `dellyvery:print:${orderId || ''}:${toStageId || ''}`;
}

function storage() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch { /* ambiente sem storage */ }
  return null;
}

export function wasPrinted(orderId, toStageId, store) {
  try {
    const s = store || storage();
    if (!s) return false;
    return s.getItem(printLogKey(orderId, toStageId)) === '1';
  } catch {
    return false;
  }
}

export function markPrinted(orderId, toStageId, store) {
  try {
    const s = store || storage();
    if (!s) return false;
    s.setItem(printLogKey(orderId, toStageId), '1');
    return true;
  } catch {
    return false;
  }
}
