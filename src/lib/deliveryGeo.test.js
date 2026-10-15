import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateRing, closeRing, toGeoJSON, fromGeoJSON,
  pointInPolygon, zoneContainsPoint, resolveZoneForPoint, bboxCenter,
  displayDeliveryFee,
} from './deliveryGeo.js';

const square = [
  { lng: 0, lat: 0 }, { lng: 10, lat: 0 }, { lng: 10, lat: 10 }, { lng: 0, lat: 10 },
];

describe('deliveryGeo — anel e GeoJSON', () => {
  it('exige 3 pontos, válidos e sem duplicar', () => {
    assert.match(validateRing([{ lng: 0, lat: 0 }]), /3 pontos/);
    assert.match(validateRing([{ lng: 0, lat: 0 }, { lng: 0, lat: 0 }, { lng: 1, lat: 1 }]), /duplicados/);
    assert.match(validateRing([{ lng: 999, lat: 0 }, { lng: 1, lat: 1 }, { lng: 2, lat: 2 }]), /inválido/);
    assert.equal(validateRing(square), null);
  });

  it('fecha o anel e converte [lat,lng] <-> GeoJSON [lng,lat]', () => {
    const geo = toGeoJSON(square);
    assert.equal(geo.type, 'Polygon');
    assert.deepEqual(geo.coordinates[0][0], [0, 0]);
    assert.deepEqual(geo.coordinates[0][geo.coordinates[0].length - 1], [0, 0]);
    const back = fromGeoJSON(geo);
    assert.equal(back.length, 4);
    assert.deepEqual(back[0], { lng: 0, lat: 0 });
    assert.deepEqual(fromGeoJSON(null), []);
    assert.deepEqual(fromGeoJSON({ type: 'Point' }), []);
    assert.throws(() => toGeoJSON([{ lng: 0, lat: 0 }]), /3 pontos/);
  });
});

describe('deliveryGeo — ponto no polígono', () => {
  const ring = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];

  it('dentro/fora/borda tolerante', () => {
    assert.equal(pointInPolygon({ lng: 5, lat: 5 }, ring), true);
    assert.equal(pointInPolygon({ lng: 50, lat: 5 }, ring), false);
    assert.equal(pointInPolygon(null, ring), false);
    assert.equal(pointInPolygon({ lng: 5, lat: 5 }, []), false);
  });

  it('zona inativa ou sem polígono nunca contém', () => {
    const zone = { id: 'z', active: true, polygon: { type: 'Polygon', coordinates: [ring] } };
    assert.equal(zoneContainsPoint(zone, { lng: 5, lat: 5 }), true);
    assert.equal(zoneContainsPoint({ ...zone, active: false }, { lng: 5, lat: 5 }), false);
    assert.equal(zoneContainsPoint({ id: 'z' }, { lng: 5, lat: 5 }), false);
  });
});

describe('deliveryGeo — resolveZoneForPoint', () => {
  const zA = { id: 'a', name: 'Zona A', fee: 8, active: true, polygon: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] } };
  const zB = { id: 'b', name: 'Zona B', fee: 5, active: true, polygon: { type: 'Polygon', coordinates: [[[5, 5], [15, 5], [15, 15], [5, 15], [5, 5]]] } };

  it('sem zonas, sem coords, fora: motivos explícitos (nunca aprova)', () => {
    assert.equal(resolveZoneForPoint([], { lng: 1, lat: 1 }).reason, 'NO_ZONES');
    assert.equal(resolveZoneForPoint([zA], null).reason, 'NO_COORDS');
    assert.equal(resolveZoneForPoint([zA], { lng: 99, lat: 99 }).reason, 'OUTSIDE');
    assert.equal(resolveZoneForPoint([zA], { lng: 99, lat: 99 }).zone, null);
  });

  it('dentro retorna a zona; sobreposição: menor taxa (paridade servidor)', () => {
    assert.equal(resolveZoneForPoint([zA], { lng: 1, lat: 1 }).zone.id, 'a');
    const r = resolveZoneForPoint([zA, zB], { lng: 7, lat: 7 });
    assert.deepEqual(r.matches.map((z) => z.id), ['a', 'b']);
    assert.equal(r.zone.id, 'b');
    // Ordem de entrada não importa para a escolha.
    assert.equal(resolveZoneForPoint([zB, zA], { lng: 7, lat: 7 }).zone.id, 'b');
  });
});

describe('deliveryGeo — bboxCenter', () => {
  it('centro do envelope; fallback São Paulo sem pontos', () => {
    assert.deepEqual(bboxCenter(square), { lat: 5, lng: 5 });
    const fb = bboxCenter([]);
    assert.equal(fb.lat, -23.5505);
  });
});

describe('deliveryGeo — displayDeliveryFee (estimativa honesta)', () => {
  it('retirada/mesa zeram; zona manual é exata', () => {
    assert.deepEqual(displayDeliveryFee({ orderType: 'retirada' }), { fee: 0, isEstimate: false });
    assert.deepEqual(
      displayDeliveryFee({ orderType: 'delivery', zoneFee: 7 }),
      { fee: 7, isEstimate: false },
    );
  });

  it('auto (polígonos + coords, sem zona manual): estimativa com taxa padrão', () => {
    assert.deepEqual(
      displayDeliveryFee({ orderType: 'delivery', hasPolygonZones: true, hasCoords: true, defaultFee: 5 }),
      { fee: 5, isEstimate: true },
    );
  });

  it('legado (sem polígonos): taxa padrão exata como antes', () => {
    assert.deepEqual(
      displayDeliveryFee({ orderType: 'delivery', hasPolygonZones: false, hasCoords: false, defaultFee: 5 }),
      { fee: 5, isEstimate: false },
    );
  });
});
