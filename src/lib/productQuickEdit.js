// DELLVERY 3 — Edição rápida do Cardápio em modo lista (puro, testável).
// Espelha as regras do diálogo de produto (nome obrigatório, preço > 0);
// category_id passa direto (a API valida a empresa). Falha de uma linha
// nunca toca nas outras (estado por id no componente).

export function validateQuickProductEdit({ name, price }) {
  if (String(name || '').trim() === '') return 'Nome do produto é obrigatório';
  const p = Number(price);
  if (price === '' || price === null || price === undefined || !Number.isFinite(p) || p <= 0) {
    return 'Preço deve ser maior que 0';
  }
  return null;
}

/** Monta o patch parcial só com campos presentes (nunca company_id). */
export function quickProductPatch(draft) {
  const patch = {};
  if (draft.name !== undefined) patch.name = String(draft.name).trim();
  if (draft.category_id !== undefined) patch.category_id = draft.category_id || null;
  if (draft.price !== undefined) patch.price = Number(draft.price);
  return patch;
}

/**
 * Monta os dados da cópia de um produto: novo id no banco (createProduct);
 * nunca leva id, histórico, vendas ou vínculos (passos/opções são por
 * produto e ficam só na origem). Nasce inativa e sem selos para revisão.
 */
export function buildProductDuplicate(p) {
  const src = p || {};
  return {
    name: `${String(src.name || 'Produto').trim()} (cópia)`,
    description: src.description || '',
    price: Number(src.price) || 0,
    promotional_price: src.promotional_price ?? null,
    category_id: src.category_id || null,
    image_url: src.image_url || '',
    available: false,
    is_featured: false,
    is_bestseller: false,
    is_made_to_order: !!src.is_made_to_order,
    use_category_steps: src.use_category_steps !== false,
  };
}
