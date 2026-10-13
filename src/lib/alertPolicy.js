// DELLVERY 3 — Política de alerta de novo pedido (pura, testável).
// Centraliza as duas decisões que antes viviam duplicadas (Kanban +
// dashboard) e falhavam em silêncio:
//  - frescor: pedido "novo" só alerta se recém-criado; timestamps FUTUROS
//    (relógio local adiantado) confiam na chegada via realtime em vez de
//    suprimir o alerta sem nenhum sinal;
//  - som bloqueado: aviso honesto e único por sessão quando o navegador
//    recusa o play() por falta de gesto (NotAllowedError).

export const ALERT_FRESH_WINDOW_MS = 120000;

export function parseCreatedMs(createdDate) {
  if (!createdDate) return 0;
  const t = new Date(createdDate).getTime();
  return Number.isFinite(t) ? t : 0;
}

// Elegível ao alerta? Chegada realtime de pedido ainda não visto E
// criado há <120s OU com timestamp futuro (skew: confia na chegada).
export function isFreshForAlert(createdDate, nowMs = Date.now()) {
  const createdAt = parseCreatedMs(createdDate);
  if (!(createdAt > 0)) return false;
  if (createdAt > nowMs) return true;
  return (nowMs - createdAt) < ALERT_FRESH_WINDOW_MS;
}

// Portão "som bloqueado": marca quando o play() é recusado por gesto;
// consumeNotice() devolve true UMA vez por sessão (toast discreto).
export function createSoundBlockGate() {
  let blocked = false;
  let noticed = false;
  return {
    markBlocked() { blocked = true; },
    consumeNotice() {
      if (blocked && !noticed) {
        noticed = true;
        return true;
      }
      return false;
    },
    reset() { blocked = false; noticed = false; },
  };
}

export function isAutoplayRejection(err) {
  const name = err?.name || '';
  const msg = String(err?.message || '');
  // Interrupção por novo play() ("interrupted by a call to pause") NÃO é
  // bloqueio de gesto (o reagendamento de 800ms já trata) — não marca.
  return name === 'NotAllowedError' || /user gesture|not allowed.*user|require.*user activation/i.test(msg);
}
