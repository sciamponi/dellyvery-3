import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validatePdvDraft } from './pdvValidation.js';

const items = [{ product_id: 'p', quantity: 1 }];

describe('pdvValidation — regras por modalidade', () => {
  it('retirada sem mesa e sem cliente passa (avulso)', () => {
    assert.equal(validatePdvDraft({ items, orderType: 'retirada' }), null);
    assert.equal(validatePdvDraft({ items, orderType: 'retirada', tableNumber: '' }), null);
  });

  it('mesa exige número; com número passa sem cliente', () => {
    assert.deepEqual(validatePdvDraft({ items, orderType: 'mesa', tableNumber: '' }), {
      title: 'Mesa obrigatória', description: 'Informe o número da mesa.',
    });
    assert.equal(validatePdvDraft({ items, orderType: 'mesa', tableNumber: '7' }), null);
  });

  it('delivery exige nome, telefone e endereço; nunca mesa', () => {
    assert.equal(validatePdvDraft({ items, orderType: 'delivery' }).title, 'Cliente obrigatório');
    assert.equal(
      validatePdvDraft({ items, orderType: 'delivery', customer: { name: 'Zé', phone: '' } }).title,
      'Cliente obrigatório',
    );
    assert.equal(
      validatePdvDraft({ items, orderType: 'delivery', customer: { name: 'Zé', phone: '119' } }).title,
      'Endereço obrigatório',
    );
    assert.equal(
      validatePdvDraft({
        items, orderType: 'delivery',
        customer: { name: 'Zé', phone: '119' }, address: 'Rua A, 1',
      }),
      null,
    );
  });

  it('pedido vazio barra antes de qualquer modalidade', () => {
    assert.equal(validatePdvDraft({ items: [], orderType: 'mesa', tableNumber: '1' }).title, 'Pedido vazio');
  });

  it('troco só validado para Dinheiro informado', () => {
    assert.equal(validatePdvDraft({ items, orderType: 'retirada' }), null);
    assert.equal(
      validatePdvDraft({ items, orderType: 'retirada', paymentMethod: 'Dinheiro', changeFor: '0' }).title,
      'Troco inválido',
    );
    assert.equal(
      validatePdvDraft({ items, orderType: 'retirada', paymentMethod: 'Dinheiro', changeFor: '50' }),
      null,
    );
    assert.equal(
      validatePdvDraft({ items, orderType: 'retirada', paymentMethod: 'Pix (na entrega)', changeFor: 'xx' }),
      null,
    );
  });

  it('um único erro por tentativa (primeiro da ordem)', () => {
    const err = validatePdvDraft({ items: [], orderType: 'mesa', tableNumber: '' });
    assert.equal(err.title, 'Pedido vazio');
  });
});
