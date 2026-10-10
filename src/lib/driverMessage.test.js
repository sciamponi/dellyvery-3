import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatAddressLines, formatOrderItems,
  buildDriverDeliveryMessage, buildDriverDeliveryUrl,
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
    assert.ok(text.includes('2x X-Bacon (Cheddar) [sem cebola]'));
    assert.ok(text.includes('Portão azul'));
    assert.ok(text.includes('Pagamento: dinheiro'));
    assert.ok(text.includes('Troco para:'));
    assert.ok(text.includes('Confirme o recebimento'));
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
