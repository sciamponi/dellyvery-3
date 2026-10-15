// DELLVERY 3 — Seleção em massa (puro, testável).
// Regras: "todos" = só visíveis (filtrados); reconcilia removidos;
// falhas por registro (ok/falha), sem tocar nos demais.

/** Alterna um id no conjunto selecionado. Retorna novo array. */
export function toggleSelected(selected, id) {
  const set = new Set(selected || []);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  return [...set];
}

/** Marca/desmarca todos os visíveis. Retorna novo array. */
export function toggleAllVisible(selected, visibleIds, checked) {
  const set = new Set(selected || []);
  for (const id of visibleIds || []) {
    if (checked) set.add(id);
    else set.delete(id);
  }
  return [...set];
}

/** Remove da seleção ids que não existem mais (pós-delete/filtro). */
export function pruneSelected(selected, existingIds) {
  const alive = new Set(existingIds || []);
  return (selected || []).filter((id) => alive.has(id));
}

export function allVisibleSelected(selected, visibleIds) {
  const v = visibleIds || [];
  return v.length > 0 && v.every((id) => (selected || []).includes(id));
}

export function someVisibleSelected(selected, visibleIds) {
  return (visibleIds || []).some((id) => (selected || []).includes(id));
}

/**
 * Executa fn(item) sequencialmente; retorna { ok: [id], fail: [{ id, error }]}.
 * Uma falha nunca impede as demais; chamador decide toast/limpeza.
 */
export async function runBulk(items, fn) {
  const ok = [];
  const fail = [];
  for (const item of items || []) {
    try {
      await fn(item);
      ok.push(item?.id);
    } catch (e) {
      fail.push({ id: item?.id, error: e?.message || 'Erro' });
    }
  }
  return { ok, fail };
}
