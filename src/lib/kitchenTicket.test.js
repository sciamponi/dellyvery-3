import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ticketTypeLabel, buildKitchenTicket, buildPackageLabel } from './kitchenTicket.js';

const detail = {
  id: 'o1', order_number: 12, order_type: 'delivery', status: 'novo',
  table_number: '', customer_name: 'Maria', customer_phone: '11999998888',
  delivery_address: { street: 'Rua A', number: '10', neighborhood: 'Centro', city: 'SP', zip_code: '' },
  items: [
    { name: 'X-Bacon', quantity: 2, complements: [{ option_name: 'Cheddar' }], notes: 'sem cebola' },
    { name: 'Coca', quantity: 1, complements: [] },
  ],
  notes: 'Portão azul', subtotal: 60, delivery_fee: 5, discount: 0, total: 65,
  payment_method: 'dinheiro', change_for: 100, created_date: 't',
};
const company = { name: 'Lanchonete X' };

describe('kitchenTicket — cupom de produção', () => {
  it('rótulos de atendimento', () => {
    assert.equal(ticketTypeLabel('mesa'), 'Mesa/Comanda');
    assert.equal(ticketTypeLabel('retirada'), 'Retirada (Balcão)');
    assert.equal(ticketTypeLabel('delivery'), 'Entrega');
  });

  it('seções do cupom com dados persistidos', () => {
    const t = buildKitchenTicket(detail, company);
    assert.equal(t.companyName, 'Lanchonete X');
    assert.equal(t.orderNumber, 12);
    assert.equal(t.typeLabel, 'Entrega');
    assert.equal(t.items.length, 2);
    assert.deepEqual(t.items[0], {
      quantity: 2, name: 'X-Bacon', complements: ['Cheddar'], notes: 'sem cebola',
    });
    assert.equal(t.orderNotes, 'Portão azul');
    assert.ok(t.address.includes('Rua A'));
    assert.equal(t.changeFor, 100);
    assert.equal(t.totals.total, 65);
    assert.throws(() => buildKitchenTicket(null, company), /Pedido/);
  });

  it('mesa sem endereço; etiqueta do pacote resumida', () => {
    const mesa = buildKitchenTicket({ ...detail, order_type: 'mesa', table_number: '7' }, company);
    assert.equal(mesa.typeLabel, 'Mesa/Comanda');
    assert.equal(mesa.table, '7');
    assert.equal(mesa.address, '');
    assert.equal(mesa.comanda, null);
    const label = buildPackageLabel(detail);
    assert.equal(label.orderNumber, 12);
    assert.equal(label.customer, 'Maria');
    assert.deepEqual(label.itemsSummary, ['2x X-Bacon', '1x Coca']);
  });

  it('retirada com nome imprime COMANDA; sem nome, avulso', () => {
    const comNome = buildKitchenTicket(
      { ...detail, order_type: 'retirada', customer_id: null, customer_name: 'André', customer_phone: '' },
      company,
    );
    assert.deepEqual(comNome.comanda, { kind: 'named', name: 'André' });
    assert.equal(comNome.address, '');
    const semNome = buildKitchenTicket(
      { ...detail, order_type: 'retirada', customer_id: null, customer_name: '', customer_phone: '' },
      company,
    );
    assert.deepEqual(semNome.comanda, { kind: 'avulso' });
  });

  it('delivery com cadastro ignora comanda (fluxo intacto)', () => {
    const t = buildKitchenTicket(detail, company);
    assert.equal(t.comanda, null);
    assert.equal(t.customerName, 'Maria');
    assert.equal(t.firstOrder, false);
    const comCliente = buildKitchenTicket(
      { ...detail, order_type: 'retirada', customer_id: 'c9', customer_name: 'Cadastrado' },
      company,
    );
    assert.equal(comCliente.comanda, null);
  });

  it('selo de primeira compra vai ao cupom quando anexado', () => {
    const t = buildKitchenTicket({ ...detail, isFirstOrder: true }, company);
    assert.equal(t.firstOrder, true);
  });
});
