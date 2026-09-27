import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatAddress,
  shortAddress,
  buildRouteUrl,
  buildEmbedUrl,
  shouldAutoOpen,
  formatOrigin,
  resolveAdvanceFlow,
} from './deliveryRoute.js';

const delivery = {
  order_type: 'delivery',
  customer_address: 'Estrada',
  customer_number: '2300',
  customer_complement: 's1',
  customer_neighborhood: 'Estância Parque de Atibaia',
  customer_city: 'Atibaia',
  customer_zip_code: '12900-000',
};

describe('deliveryRoute', () => {
  it('formatAddress organiza rua/número/complemento/bairro/cidade-CEP', () => {
    assert.equal(formatAddress(delivery), 'Estrada, 2300 — s1 — Estância Parque de Atibaia — Atibaia 12900-000');
  });

  it('formatAddress ignora ausentes sem inventar', () => {
    assert.equal(formatAddress({ order_type: 'delivery', customer_neighborhood: 'Centro' }), 'Centro');
    assert.equal(formatAddress({ order_type: 'delivery' }), '');
  });

  it('não formata retirada/mesa', () => {
    assert.equal(formatAddress({ order_type: 'retirada', customer_address: 'R' }), '');
    assert.equal(shortAddress({ order_type: 'mesa' }), '');
  });

  it('shortAddress prefere bairro', () => {
    assert.equal(shortAddress(delivery), 'Estância Parque de Atibaia');
    assert.equal(shortAddress({ order_type: 'delivery', customer_address: 'Estrada', customer_number: '2300' }), 'Estrada, 2300');
  });

  it('buildRouteUrl com encode correto', () => {
    const url = buildRouteUrl('Rua A, 1 — SP', 'Estrada, 2300 — Atibaia');
    assert.ok(url.startsWith('https://www.google.com/maps/dir/?api=1&origin='));
    assert.ok(url.includes('destination=Estrada%2C%202300%20%E2%80%94%20Atibaia'));
    assert.equal(buildRouteUrl('', 'X'), '');
    assert.equal(buildEmbedUrl('A', ''), '');
  });

  it('shouldAutoOpen: novo + janela + não-visto', () => {
    const now = Date.now();
    const fresh = { type: 'create', data: { id: '1', status: 'novo', created_date: new Date(now - 10000).toISOString() } };
    assert.equal(shouldAutoOpen(fresh, new Set(), now), true);
    assert.equal(shouldAutoOpen(fresh, new Set(['1']), now), false);
    const old = { type: 'create', data: { id: '2', status: 'novo', created_date: new Date(now - 200000).toISOString() } };
    assert.equal(shouldAutoOpen(old, new Set(), now), false);
    assert.equal(shouldAutoOpen({ type: 'update', data: { id: '3', status: 'novo' } }, new Set(), now), false);
    assert.equal(shouldAutoOpen({ type: 'create', data: { id: '4', status: 'confirmado' } }, new Set(), now), false);
  });

  it('formatOrigin usa endereço real da empresa', () => {
    assert.equal(formatOrigin({ address: 'Av B', city: 'SP', name: 'Loja' }), 'Av B — SP');
    assert.equal(formatOrigin({ name: 'Loja' }), 'Loja');
    assert.equal(formatOrigin(null), '');
  });

  it('resolveAdvanceFlow: direct/select/confirm', () => {
    assert.equal(resolveAdvanceFlow({ order_type: 'delivery', status: 'em_preparo' }, 'saiu_entrega'), 'select');
    assert.equal(
      resolveAdvanceFlow({ order_type: 'delivery', status: 'em_preparo', driver_id: 'd1' }, 'saiu_entrega'),
      'confirm',
    );
    assert.equal(resolveAdvanceFlow({ order_type: 'retirada', status: 'em_preparo' }, 'saiu_entrega'), 'direct');
    assert.equal(resolveAdvanceFlow({ order_type: 'mesa', status: 'em_preparo', driver_id: 'd1' }, 'aguardando_retirada'), 'direct');
    assert.equal(resolveAdvanceFlow({ order_type: 'delivery', status: 'finalizado', driver_id: 'd1' }, 'saiu_entrega'), 'direct');
    assert.equal(resolveAdvanceFlow({ order_type: 'delivery', status: 'novo' }, 'confirmado'), 'direct');
  });
});
