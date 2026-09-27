/**
 * Divulgação do cardápio: URL pública, mensagem e link de compartilhamento.
 * Funções puras (testáveis); QR Code é gerado na tela via `qrcode`.
 */

export function normalizeSlug(slug) {
  return (slug || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function isValidSlug(slug) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug || '');
}

export function buildMenuUrl(base, slug) {
  const cleanBase = String(base || '').replace(/\/+$/, '');
  return `${cleanBase}/cardapio/${slug}`;
}

export function buildShareMessage(storeName, menuUrl) {
  return `🍔 Confira nosso cardápio online!\n${storeName}\nFaça seu pedido de forma rápida e fácil:\n🔗 ${menuUrl}`;
}

export function buildWhatsAppUrl(message) {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}
