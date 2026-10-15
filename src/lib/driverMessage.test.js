import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatAddressLines, formatOrderItems,
  buildDriverDeliveryMessage, buildDriverDeliveryUrl,
  buildDriverMapsLink, buildMapsLink, fullAddressText, isCashPayment,
} from './driverMessage.js';

const order = {
  id: 'o1', order_number: 42, order_type: 'delivery',
  customer_name: 'Maria', customer_phone: '11999998888',
  delivery_address: { street: 'Rua A', number: '10', complement: 'ap 2', neighborhood: 'Centro', city: 'SP', zip_code: '01000-000' },
  items: [
    { name: 'X-Bacon', quantity: 2, complements: [{ option_name: 'Cheddar' }], notes: 'sem cebola' },
    { name: 'Coca', quantity: 1, complements: [] },
  ],
  notes: 'Portão azul',
  subtotal: 60, delivery_fee: 5, discount: 0, total: 65,
  payment_method: 'dinheiro', change_for: 100,
};
const driver = { id: 'd1', name: 'Zé', phone: '(11) 98888-7777' };

describe('driverMessage — montagem com dados reais', () => {
  it('endereço e itens formatados', () => {
    assert.deepEqual(formatAddressLines(order), {
      street: 'Rua A, 10',
      rest: 'ap 2 • Centro • SP • 01000-000',
    });
    assert.deepEqual(formatOrderItems(order), [
      '2x X-Bacon (Cheddar) [sem cebola]',
      '1x Coca',
    ]);
  });

  it('mensagem completa no template operacional', () => {
    const { to, text } = buildDriverDeliveryMessage(order, driver);
    assert.equal(to, '5511988887777');
    assert.ok(text.includes('Pedido #42'));
    assert.ok(text.includes('Maria'));
    assert.ok(text.includes('Rua A, 10'));
    assert.ok(text.includes('2x X-Bacon (Cheddar)'));
    assert.ok(text.includes('Portão azul'));
    assert.ok(text.includes('Pagamento: dinheiro'));
    assert.ok(text.includes('Troco para:'));
    assert.ok(text.includes('Confirme o recebimento'));
  });

  it('minimização de PII no link wa.me', () => {
    const { text } = buildDriverDeliveryMessage(
      { ...order, customer_name: 'Maria Silva Souza' },
      driver,
    );
    assert.ok(text.includes('Cliente: Maria'));
    assert.ok(!text.includes('Silva'));
    assert.ok(!text.includes('Referência:'));
    assert.ok(!text.includes('ap 2'));
    assert.ok(!text.includes('01000-000'));
    assert.ok(!text.includes('[sem cebola]'));
    assert.ok(text.includes('11999998888'));
    assert.ok(text.includes('Bairro: Centro'));
    assert.ok(text.includes('Total:'));
  });

  it('mapa na mensagem só com coordenadas explícitas', () => {
    const semCoords = buildDriverDeliveryMessage(order, driver);
    assert.ok(!semCoords.text.includes('Mapa:'));
    const comCoords = buildDriverDeliveryMessage(
      { ...order, lat: -23.55, lng: -46.63 },
      driver,
    );
    assert.ok(comCoords.text.includes('Mapa: https://www.google.com/maps/search/?api=1&query=-23.55,-46.63'));
    assert.equal(buildDriverMapsLink({ lat: 0, lng: 0 }), '');
    assert.equal(buildDriverMapsLink(null), '');
  });

  it('omite opcionais ausentes; exige pedido e telefone', () => {
    const bare = buildDriverDeliveryMessage(
      { id: 'o2', order_number: 7, items: [], total: 10 },
      { phone: '1133334444' },
    );
    assert.ok(!bare.text.includes('Referência:'));
    assert.ok(!bare.text.includes('Pagamento:'));
    assert.ok(!bare.text.includes('Troco para:'));
    assert.throws(() => buildDriverDeliveryMessage(null, driver), /Pedido/);
    assert.throws(() => buildDriverDeliveryMessage(order, { name: 'X' }), /telefone/);
  });

  it('URL wa.me codificada', () => {
    const url = buildDriverDeliveryUrl(order, driver);
    assert.ok(url.startsWith('https://wa.me/5511988887777?text='));
    assert.ok(url.includes(encodeURIComponent('Pedido #42').slice(0, 12)));
  });
});

describe('driverMessage — localização (sem coordenadas inventadas)', () => {
  it('coordenadas válidas viram link direto; (0,0) é tratado como ausente', () => {
    assert.equal(
      buildMapsLink({ lat: -23.55, lng: -46.63 }),
      'https://www.google.com/maps/search/?api=1&query=-23.55,-46.63',
    );
    assert.equal(buildMapsLink({ lat: 0, lng: 0 }), '');
    assert.equal(buildMapsLink({ lat: 91, lng: 0 }), '');
    assert.equal(buildMapsLink(null), '');
  });

  it('sem coordenadas, pesquisa pelo endereço codificado (ou omite)', () => {
    const url = buildMapsLink(order);
    assert.ok(url.startsWith('https://www.google.com/maps/search/?api=1&query='));
    assert.ok(url.includes(encodeURIComponent('Rua A, 10')));
    assert.equal(buildMapsLink({ id: 'x', items: [] }), '');
  });

  it('mensagem sem segredos; mapa textual removido (só coords explícitas)', () => {
    const { text } = buildDriverDeliveryMessage(order, driver);
    assert.ok(!/key=|token=|secret|password/i.test(text));
    assert.ok(!text.includes('Mapa:'));
  });
});

describe('driverMessage — troco só no dinheiro, com cálculo', () => {
  it('dinheiro mostra solicitado + calculado; Pix/cartão omitem', () => {
    const cash = buildDriverDeliveryMessage(order, driver);
    assert.ok(cash.text.includes('Troco para:'));
    assert.ok(cash.text.includes('Troco calculado:'));
    const pix = buildDriverDeliveryMessage(
      { ...order, payment_method: 'Pix (na entrega)', change_for: 100 },
      driver,
    );
    assert.ok(!pix.text.includes('Troco'));
    const card = buildDriverDeliveryMessage(
      { ...order, payment_method: 'Cartão (na entrega)' },
      driver,
    );
    assert.ok(!card.text.includes('Troco'));
  });

  it('isCashPayment só casa dinheiro (case-insensitive)', () => {
    assert.equal(isCashPayment('Dinheiro'), true);
    assert.equal(isCashPayment('DINHEIRO'), true);
    assert.equal(isCashPayment('Pix'), false);
    assert.equal(isCashPayment(''), false);
    assert.equal(isCashPayment(null), false);
  });
});
