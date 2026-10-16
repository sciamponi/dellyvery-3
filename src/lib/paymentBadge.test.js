import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { paymentMethodIcon, paymentBadgeState, paymentBadgeClass } from './paymentBadge.js';

describe('paymentBadge — estados', () => {
  it('oficial primeiro: paid nunca vira outro estado', () => {
    assert.deepEqual(paymentBadgeState({ paymentStatus: 'paid', hasReceipt: true }), { key: 'paid', label: 'PAGO', icon: '🟢', tone: 'green' });
    assert.deepEqual(paymentBadgeState({ paymentStatus: 'paid' }).label, 'PAGO');
  });

  it('declaração sem quitação é estado distinto', () => {
    assert.deepEqual(paymentBadgeState({ paymentStatus: 'pending', hasReceipt: true }), { key: 'registered', label: 'REGISTRADO', icon: '🟡', tone: 'amber' });
    assert.deepEqual(paymentBadgeState({ paymentStatus: null, hasReceipt: false }).label, 'A RECEBER');
    assert.deepEqual(paymentBadgeState({}).label, 'A RECEBER');
  });

  it('falha e estorno têm rótulos próprios', () => {
    assert.deepEqual(paymentBadgeState({ paymentStatus: 'failed' }), { key: 'failed', label: 'PAGAMENTO FALHOU', icon: '❌', tone: 'red' });
    assert.deepEqual(paymentBadgeState({ paymentStatus: 'refunded' }), { key: 'refunded', label: 'ESTORNADO', icon: '↩️', tone: 'gray' });
  });

  it('ícones por método, sem excesso', () => {
    assert.equal(paymentMethodIcon('Pix (na entrega)'), '🟢');
    assert.equal(paymentMethodIcon('Cartão (na entrega)'), '💳');
    assert.equal(paymentMethodIcon('Dinheiro'), '💵');
    assert.equal(paymentMethodIcon(''), '');
    assert.equal(paymentMethodIcon('Boleto'), '');
    assert.equal(paymentBadgeClass({ tone: 'green' }), 'bg-green-600 text-white');
    assert.equal(paymentBadgeClass({ tone: 'x' }), 'bg-muted text-muted-foreground');
  });
});
