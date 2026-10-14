import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildGeocodeQuery, isValidLatLng, geocodeAddress, searchAddresses, getBrowserLocation } from './geocode.js';

describe('geocode — query e faixa', () => {
  it('monta consulta sem partes vazias', () => {
    assert.equal(buildGeocodeQuery({ address: 'Rua A', number: '10', neighborhood: '', city: 'São Paulo' }), 'Rua A, 10, São Paulo');
    assert.equal(buildGeocodeQuery({}), '');
  });

  it('faixa real (fail-closed)', () => {
    assert.equal(isValidLatLng(-23.5, -46.6), true);
    assert.equal(isValidLatLng(91, 0), false);
    assert.equal(isValidLatLng(0, 181), false);
    assert.equal(isValidLatLng('x', 0), false);
    assert.equal(isValidLatLng(null, null), false);
  });
});

describe('geocode — Nominatim (fetch injetado)', () => {
  const parts = { address: 'Av Paulista', number: '1000', city: 'São Paulo' };

  it('sucesso retorna lat/lng (lon -> lng)', async () => {
    const calls = [];
    const out = await geocodeAddress(parts, {
      fetchFn: async (url) => {
        calls.push(url);
        return { ok: true, json: async () => [{ lat: '-23.56', lon: '-46.65', display_name: 'Av Paulista, SP' }] };
      },
    });
    assert.deepEqual(out, { lat: -23.56, lng: -46.65, displayName: 'Av Paulista, SP' });
    assert.ok(calls[0].includes('countrycodes=br') && calls[0].includes('limit=1'));
  });

  it('nunca inventa coordenada: vazio, falha, inválido => null', async () => {
    assert.equal(await geocodeAddress({}), null);
    const fail = async () => { throw new Error('rede'); };
    assert.equal(await geocodeAddress(parts, { fetchFn: fail }), null);
    assert.equal(await geocodeAddress(parts, { fetchFn: async () => ({ ok: false }) }), null);
    assert.equal(await geocodeAddress(parts, { fetchFn: async () => ({ ok: true, json: async () => [] }) }), null);
    assert.equal(await geocodeAddress(parts, { fetchFn: async () => ({ ok: true, json: async () => [{ lat: 'x', lon: 'y' }] }) }), null);
    assert.equal(await geocodeAddress(parts, { fetchFn: async () => ({ ok: true, json: async () => { throw new Error('json'); } }) }), null);
  });
});

describe('geocode — GPS do navegador', () => {  it('resolve null sem geolocation, na negação ou com valor inválido', async () => {
    assert.equal(await getBrowserLocation({ geolocation: null }), null);
    assert.equal(
      await getBrowserLocation({ geolocation: { getCurrentPosition: (ok, err) => err({ code: 1 }) } }),
      null,
    );
    assert.equal(
      await getBrowserLocation({ geolocation: { getCurrentPosition: (ok) => ok({ coords: { latitude: 999, longitude: 0 } }) } }),
      null,
    );
    assert.deepEqual(
      await getBrowserLocation({ geolocation: { getCurrentPosition: (ok) => ok({ coords: { latitude: -23.5, longitude: -46.6 } }) } }),
      { lat: -23.5, lng: -46.6 },
    );
  });
});

describe('geocode — searchAddresses (candidatos para escolha)', () => {
  const parts = { address: 'Rua X', city: 'São Paulo' };
  const rows = [
    { lat: '-23.5', lon: '-46.6', display_name: 'Rua X, 10' },
    { lat: '-23.6', lon: '-46.7', display_name: 'Rua X, 20' },
    { lat: 'x', lon: 'y', display_name: 'lixo' },
  ];

  it('retorna só válidos, respeitando o limite', async () => {
    const calls = [];
    // Mock fiel: o limite é aplicado pelo servidor (aqui, pela URL).
    const server = async (url) => {
      calls.push(url);
      const n = Number(new URL(url).searchParams.get('limit')) || rows.length;
      return { ok: true, json: async () => rows.slice(0, n) };
    };
    const out = await searchAddresses(parts, { limit: 5, fetchFn: server });
    assert.equal(out.length, 2);
    assert.ok(calls[0].includes('limit=5'));
    const one = await searchAddresses(parts, { limit: 1, fetchFn: server });
    assert.equal(one.length, 1);
  });

  it('vazio, falha e ambíguo-sem-válido => [] (sem inventar)', async () => {
    assert.deepEqual(await searchAddresses({}), []);
    assert.deepEqual(await searchAddresses(parts, { fetchFn: async () => { throw new Error('rede'); } }), []);
    assert.deepEqual(await searchAddresses(parts, { fetchFn: async () => ({ ok: true, json: async () => [{ lat: 'x', lon: 'y' }] }) }), []);
  });
});
