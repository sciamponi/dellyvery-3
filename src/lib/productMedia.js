// DELLVERY 3 — Galeria do produto (puro, testável).
// Hoje o banco guarda 1 foto (products.image_url); `images` (jsonb) é a
// extensão opcional para várias (migration versionada, não aplicada).
// Sem fotos adicionais: só a principal (ou vazio = placeholder na UI).

function cleanUrl(v) {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
}

/** Lista final de fotos: principal + adicionais, sem vazias nem repetidas. */
export function getProductImages(product) {
  const first = cleanUrl(product?.image_url);
  const extra = Array.isArray(product?.images) ? product.images : [];
  const out = [];
  for (const u of [first, ...extra]) {
    const c = cleanUrl(u);
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}

/** Normaliza entrada do admin (URLs soltas) para o formato persistido. */
export function normalizeImageList(input) {
  const arr = Array.isArray(input) ? input : [input];
  const out = [];
  for (const u of arr) {
    const c = cleanUrl(u);
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}
