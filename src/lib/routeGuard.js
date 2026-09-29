// DELLVERY 3 — Decisão do gate de rotas protegidas (lógica pura).
// Bloqueia não autenticado; aceita sessão Supabase.
export function shouldAllowProtected({ sbConfigured, sbUser }) {
  if (sbConfigured && sbUser) return true;
  return false;
}
