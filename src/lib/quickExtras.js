// DELLVERY 3 — Seleção rápida de extras por produto (puro, testável).
// Um grupo "Extras" por produto concentra as associações feitas por
// checkbox; regras finas (obrigatório/min/max/preço) continuam no grupo,
// editáveis na Montagem. Ativação é por associação (option), logo
// independente por produto: marcar alface no X-Burguer não afeta outros.

export const QUICK_GROUP_TITLE = 'Extras';

export function normalizeTitle(v) {
  return String(v ?? '').trim().toLowerCase();
}

// Encontra o grupo rápido entre os passos do produto (ou null).
export function findQuickStep(steps) {
  return (Array.isArray(steps) ? steps : []).find(
    (s) => s && normalizeTitle(s.title) === normalizeTitle(QUICK_GROUP_TITLE),
  ) || null;
}

// Monta as linhas da seleção: cada ingrediente ativo + sua associação
// (option com ingredient_id) dentro do grupo rápido, se houver.
export function buildQuickRows(ingredients, quickOptions) {
  const opts = Array.isArray(quickOptions) ? quickOptions : [];
  return (Array.isArray(ingredients) ? ingredients : [])
    .filter((i) => i && i.id && i.active !== false)
    .map((ingredient) => ({
      ingredient,
      option: opts.find((o) => o && o.ingredient_id === ingredient.id) || null,
    }));
}
