// DELLVERY 3 — Tecla Enter nos campos de vínculo (puro, testável).
// Regras (sem criar cliente, sem seleção arbitrária):
// - ocupado (busy) → none (sem duplo disparo);
// - cliente já destacado (custSelected válido) → confirm (validações do
//   fluxo existente: confirmação + linkOrderCustomer);
// - exatamente 1 resultado filtrado → select (só destaca, habilita o
//   Confirmar; NÃO salva sozinho);
// - 0 ou 2+ resultados → none (nunca escolhe arbitrariamente).
// O filtro é compartilhado com a lista (Enter e UI sempre concordam).
export function filterLinkCustomers(results, query) {
  const list = Array.isArray(results) ? results : [];
  const q = String(query ?? '').trim().toLowerCase();
  const filtered = q
    ? list.filter((c) => (c?.name || '').toLowerCase().includes(q) || (c?.phone || '').includes(q))
    : [...list];
  return filtered.slice(0, 8);
}

export function resolveCustomerEnter({ results, query, custSelected, busy }) {
  if (busy) return { action: 'none' };
  const filtered = filterLinkCustomers(results, query);
  if (custSelected && filtered.some((c) => c?.id === custSelected)) {
    return { action: 'confirm' };
  }
  if (filtered.length === 1 && filtered[0]?.id) {
    return { action: 'select', id: filtered[0].id };
  }
  return { action: 'none' };
}
