// DELLVERY 3 — Formatação monetária com estado de ausência explícito.
// fmtCurrency legado (v || 0) esconde nulo como R$ 0,00; para totais de
// pedido, ausência deve ser visível (R$ —), nunca silenciosa.

export function formatBRL(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);
}

// Total de pedido para cartões/filas: null/undefined/''/NaN → 'R$ —'
// (indisponível identificável); demais casos, valor formatado.
export function formatOrderTotal(value) {
  if (value == null || value === '') return 'R$ —';
  const n = Number(value);
  if (!Number.isFinite(n)) return 'R$ —';
  return formatBRL(n);
}

export function isMissingTotal(value) {
  if (value == null || value === '') return true;
  return !Number.isFinite(Number(value));
}
