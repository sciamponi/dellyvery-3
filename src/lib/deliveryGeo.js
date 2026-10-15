// DELLVERY 3 — Geometria das áreas de entrega (puro, testável).
// Formato persistido: GeoJSON Polygon com anel em [lng, lat]
//   { type: 'Polygon', coordinates: [ [ [lng,lat], ...fechado ] ] }
// O editor (Leaflet) trabalha em [lat, lng]; a conversão acontece na
// borda (toGeoJSON/fromGeoJSON). Nada aqui toca em rede ou banco.
// Sem geocodificação neste módulo: o checkout ainda não possui
// coordenadas (endereço é texto livre) — ver resolveZoneForPoint.

export const SAO_PAULO_CENTER = { lat: -23.5505, lng: -46.6333 };

function isFiniteNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

export function isValidLngLat(p) {
  return !!p && isFiniteNum(p.lng) && isFiniteNum(p.lat)
    && p.lng >= -180 && p.lng <= 180 && p.lat >= -90 && p.lat <= 90;
}

// Valida um anel aberto (vértices clicados). Retorna null se válido ou
// a mensagem do primeiro problema (para exibir antes de salvar).
export function validateRing(path) {
  const pts = Array.isArray(path) ? path : [];
  if (pts.length < 3) return 'Adicione ao menos 3 pontos para fechar a região';
  for (const p of pts) {
    if (!isValidLngLat(p)) return 'Há ponto inválido na região';
  }
  const seen = new Set();
  for (const p of pts) {
    const k = `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`;
    if (seen.has(k)) return 'Há pontos duplicados na região';
    seen.add(k);
  }
  return null;
}

export function closeRing(path) {
  const pts = (Array.isArray(path) ? path : []).map((p) => ({ lng: p.lng, lat: p.lat }));
  if (pts.length === 0) return pts;
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (first.lng !== last.lng || first.lat !== last.lat) pts.push({ ...first });
  return pts;
}

export function toGeoJSON(path) {
  const err = validateRing(path);
  if (err) throw new Error(err);
  return {
    type: 'Polygon',
    coordinates: [closeRing(path).map((p) => [p.lng, p.lat])],
  };
}

// Aceita GeoJSON Polygon ou { ring } legado; retorna vértices [lat,lng]
// (formato do editor) ou [] quando ausente/inválido (sem lançar).
export function fromGeoJSON(geo) {
  try {
    const ring = geo && geo.type === 'Polygon'
      ? geo.coordinates && geo.coordinates[0]
      : geo && Array.isArray(geo.ring) ? geo.ring : null;
    if (!Array.isArray(ring)) return [];
    const pts = ring.map((c) => {
      if (Array.isArray(c)) return { lng: Number(c[0]), lat: Number(c[1]) };
      return { lng: Number(c?.lng), lat: Number(c?.lat) };
    }).filter(isValidLngLat);
    // Remove o fechamento duplicado (o editor fecha sozinho).
    if (pts.length > 1) {
      const f = pts[0];
      const l = pts[pts.length - 1];
      if (f.lng === l.lng && f.lat === l.lat) pts.pop();
    }
    return pts;
  } catch {
    return [];
  }
}

// Ray casting sobre anel GeoJSON [lng,lat] (fechado ou não).
export function pointInPolygon(point, ring) {
  if (!point || !isFiniteNum(point.lng) || !isFiniteNum(point.lat)) return false;
  const vs = Array.isArray(ring) ? ring : [];
  if (vs.length < 3) return false;
  const { lng: x, lat: y } = point;
  let inside = false;
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const xi = vs[i][0]; const yi = vs[i][1];
    const xj = vs[j][0]; const yj = vs[j][1];
    if (!isFiniteNum(xi) || !isFiniteNum(yi) || !isFiniteNum(xj) || !isFiniteNum(yj)) continue;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function zoneContainsPoint(zone, point) {
  if (!zone || zone.active === false) return false;
  const poly = zone.polygon || zone.boundary;
  if (!poly || poly.type !== 'Polygon' || !Array.isArray(poly.coordinates)) return false;
  return pointInPolygon(point, poly.coordinates[0]);
}

// Resolve a zona para um ponto geocodificado {lng, lat}.
// Retorna { zone, matches } ou { zone: null, reason, matches }:
// - 'NO_COORDS': ponto ausente (endereço sem geocodificação — nunca aprova);
// - 'OUTSIDE': fora de todas as ativas; - 'NO_ZONES': nada configurado.
// Sobreposição explícita: matches lista todas; zone é a de MENOR taxa
// (desempate nome/id) — mesma regra do servidor (resolve_delivery_zone).
export function resolveZoneForPoint(zones, point) {
  const list = (Array.isArray(zones) ? zones : []).filter((z) => z && z.active !== false);
  if (list.length === 0) return { zone: null, reason: 'NO_ZONES', matches: [] };
  if (!point || !isFiniteNum(point.lng) || !isFiniteNum(point.lat)) {
    return { zone: null, reason: 'NO_COORDS', matches: [] };
  }
  const matches = list.filter((z) => zoneContainsPoint(z, point));
  if (matches.length === 0) return { zone: null, reason: 'OUTSIDE', matches: [] };
  const byFee = [...matches].sort(
    (a, b) => (Number(a.fee) || 0) - (Number(b.fee) || 0)
      || String(a.name || '').localeCompare(String(b.name || ''))
      || String(a.id || '').localeCompare(String(b.id || '')),
  );
  return { zone: byFee[0], reason: null, matches };
}

export function bboxCenter(path) {
  const pts = (Array.isArray(path) ? path : []).filter(isValidLngLat);
  if (pts.length === 0) return { ...SAO_PAULO_CENTER };
  let minLng = Infinity; let maxLng = -Infinity;
  let minLat = Infinity; let maxLat = -Infinity;
  for (const p of pts) {
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
  }
  return { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 };
}

// Taxa exibida no checkout ANTES do envio (pura, testável).
// Com áreas desenhadas + localização, o valor exato só existe no servidor:
// exibe a taxa padrão como ESTIMATIVA honesta. Com zona manual, exibe o
// valor da zona (o servidor cobra exatamente esse, se elegível).
// Retorna { fee, isEstimate }. Retirada/mesa sempre zeram aqui.
export function displayDeliveryFee({ orderType, hasPolygonZones, hasCoords, zoneFee, defaultFee }) {
  if (orderType !== 'delivery') return { fee: 0, isEstimate: false };
  if (zoneFee !== null && zoneFee !== undefined) {
    return { fee: Number(zoneFee) || 0, isEstimate: false };
  }
  if (hasPolygonZones && hasCoords) {
    return { fee: Number(defaultFee) || 0, isEstimate: true };
  }
  return { fee: Number(defaultFee) || 0, isEstimate: false };
}
