// DELLVERY 3 — Helpers de rota/entrega (puros, FASE 5.4 UX)
// Sem dependência de mapa, key ou backend. Origem/destino são strings
// montadas só com dados reais do pedido/empresa — nunca inventados.

export function formatAddress(order) {
  if (!order || order.order_type !== 'delivery') return '';
  const parts = [];
  const street = [order.customer_address, order.customer_number].filter(Boolean).join(', ');
  if (street) parts.push(street);
  if (order.customer_complement) parts.push(order.customer_complement);
  if (order.customer_neighborhood) parts.push(order.customer_neighborhood);
  const city = [order.customer_city, order.customer_zip_code].filter(Boolean).join(' ');
  if (city) parts.push(city);
  return parts.join(' — ');
}

export function shortAddress(order) {
  if (!order || order.order_type !== 'delivery') return '';
  return order.customer_neighborhood
    || ([order.customer_address, order.customer_number].filter(Boolean).join(', '))
    || '';
}

export function buildRouteUrl(origin, destination) {
  if (!origin || !destination) return '';
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}`;
}

export function buildEmbedUrl(origin, destination) {
  if (!origin || !destination) return '';
  return `https://www.google.com/maps?q=${encodeURIComponent(`${origin} to ${destination}`)}&output=embed`;
}

// Janela de "pedido realmente novo": status novo + criado há <120s + não visto.
export function shouldAutoOpen(event, seenIds, now = Date.now()) {
  if (!event || event.type !== 'create') return false;
  const data = event.data || {};
  if (!data.id || data.status !== 'novo') return false;
  if (seenIds && seenIds.has(data.id)) return false;
  const createdAt = data.created_date || data.created_at;
  if (!createdAt) return false;
  return now - new Date(createdAt).getTime() < 120000;
}

export function formatOrigin(company) {
  if (!company) return '';
  return [company.address, company.city].filter(Boolean).join(' — ') || company.name || '';
}

// Decide o fluxo ao avançar para saiu_entrega (só delivery):
// 'direct' (mantém fluxo atual), 'select' (sem entregador),
// 'confirm' (já vinculado: perguntar antes).
export function resolveAdvanceFlow(order, next) {
  if (!order || order.order_type !== 'delivery' || next !== 'saiu_entrega') return 'direct';
  if (order.status === 'finalizado' || order.status === 'cancelado') return 'direct';
  return order.driver_id ? 'confirm' : 'select';
}
