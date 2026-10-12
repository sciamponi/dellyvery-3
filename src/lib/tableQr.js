// DELLVERY 3 — QR Code de mesa (puro, sem rede).
// URL pública: /cardapio/{slug}?mesa={token}. Token: 12 hex gerados no
// banco, únicos, estáveis (edição de nome/código não invalida).

export function isValidTableToken(token) {
  return /^[0-9a-f]{12}$/.test(String(token || '').trim());
}

export function buildTableQrUrl(origin, slug, token) {
  if (!origin) throw new Error('Origem inválida');
  if (!slug) throw new Error('Loja não identificada');
  if (!isValidTableToken(token)) throw new Error('Token de mesa inválido');
  const base = String(origin).replace(/\/+$/, '');
  return `${base}/cardapio/${slug}?mesa=${token.trim()}`;
}

// Base pública para QR Codes (teste mobile).
// - VITE_PUBLIC_URL (ex.: http://192.168.0.10:5173) tem prioridade: permite
//   leitura por celular na rede local em desenvolvimento.
// - Sem ela, usa a origem atual. NUNCA toca a URL de produção: a VPS usa o
//   próprio .env, intocado por este código.
export function resolvePublicBaseUrl(fallbackOrigin = '') {
  const viteEnv = (typeof import.meta !== 'undefined' && import.meta.env) || {};
  const configured = String(viteEnv.VITE_PUBLIC_URL || '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  return String(fallbackOrigin || '').replace(/\/+$/, '');
}
