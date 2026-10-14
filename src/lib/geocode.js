// DELLVERY 3 — Geocodificação sem chave (puro, testável).
// Provedor: Nominatim (OpenStreetMap) — sem API key, CORS aberto, limite
// de 1 req/s (uso sob demanda no checkout, nunca em lote). Alternativa
// precisa sem chave: Geolocation API do navegador (GPS, getCurrentPosition).
// Regra de segurança: falha/ambiguidade NUNCA gera coordenada inventada —
// retorna null e o fluxo cai no modo manual (zona escolhida) ou pede retry.
// É obrigatório creditar o OSM onde o resultado for usado (ver Checkout).
// Limites conhecidos: cobertura varia por região; sem rede não funciona;
// alternativa futura (fora deste escopo): geocodificar no servidor.

export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

export function buildGeocodeQuery({ address = '', number = '', neighborhood = '', city = '' } = {}) {
  return [address, number, neighborhood, city]
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .join(', ');
}

// Valida faixa real (fail-closed: fora da faixa = dado inválido).
export function isValidLatLng(lat, lng) {
  if (lat === null || lat === undefined || lng === null || lng === undefined) return false;
  if (lat === '' || lng === '') return false;
  const la = Number(lat);
  const lo = Number(lng);
  return Number.isFinite(la) && Number.isFinite(lo)
    && la >= -90 && la <= 90 && lo >= -180 && lo <= 180;
}

// Geocodifica via Nominatim. fetchFn injetável para testes.
// Retorna { lat, lng, displayName } ou null (sem resultado/falha).
// Nunca lança por falha de rede/servidor: quem chama decide o fallback.
export async function geocodeAddress(parts, { fetchFn = fetch, countrycodes = 'br' } = {}) {
  const found = await searchAddresses(parts, { fetchFn, countrycodes, limit: 1 });
  return found.length > 0 ? found[0] : null;
}

// Pesquisa com até `limit` candidatos (para escolha inequívoca no admin).
// Retorna somente resultados com coordenadas válidas ([] se nenhum).
export async function searchAddresses(parts, { fetchFn = fetch, countrycodes = 'br', limit = 5 } = {}) {
  const q = buildGeocodeQuery(parts || {});
  if (!q) return [];
  const n = Math.max(1, Math.min(Number(limit) || 5, 10));
  const url = `${NOMINATIM_URL}?${new URLSearchParams({
    format: 'jsonv2',
    q,
    countrycodes,
    addressdetails: '0',
    limit: String(n),
    'accept-language': 'pt-BR',
  }).toString()}`;
  let res;
  try {
    res = await fetchFn(url, { headers: { Accept: 'application/json' } });
  } catch {
    return [];
  }
  if (!res || !res.ok) return [];
  let rows;
  try {
    rows = await res.json();
  } catch {
    return [];
  }
  if (!Array.isArray(rows)) return [];
  return rows
    .map((r) => {
      const lat = Number(r?.lat);
      const lng = Number(r?.lon);
      if (!isValidLatLng(lat, lng)) return null;
      return { lat, lng, displayName: String(r?.display_name || '') };
    })
    .filter(Boolean);
}

// GPS do navegador (preciso, sem chave). Rejeição/erro => null.
export function getBrowserLocation({ geolocation, timeoutMs = 10000 } = {}) {
  const geo = geolocation || (typeof navigator !== 'undefined' ? navigator.geolocation : null);
  if (!geo || typeof geo.getCurrentPosition !== 'function') {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      geo.getCurrentPosition(
        (pos) => {
          const lat = pos?.coords?.latitude;
          const lng = pos?.coords?.longitude;
          resolve(isValidLatLng(lat, lng) ? { lat: Number(lat), lng: Number(lng) } : null);
        },
        () => resolve(null),
        { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60000 },
      );
    } catch {
      resolve(null);
    }
  });
}
