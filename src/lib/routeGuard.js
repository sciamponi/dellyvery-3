// DELLVERY 3 — Decisão do gate de rotas protegidas (lógica pura, FASE 5.1)
// Bloqueia não autenticado; aceita sessão Base44 OU Supabase (transição).
export function shouldAllowProtected({ base44Authenticated, sbConfigured, sbUser }) {
  if (base44Authenticated) return true;
  if (sbConfigured && sbUser) return true;
  return false;
}
