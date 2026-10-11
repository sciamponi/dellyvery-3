import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatBRL, formatOrderTotal, isMissingTotal } from './money.js';

describe('money — formatação com ausência explícita', () => {
  it('formatBRL formata reais (igual ao Intl do projeto)', () => {
    const expected = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(68);
    assert.equal(formatBRL(68), expected);
    assert.ok(formatBRL(68).startsWith('R$'));
    assert.ok(formatBRL(68).includes('68,00'));
  });

  it('total presente formata; ausente mostra R$ —', () => {
    assert.equal(formatOrderTotal(68), formatBRL(68));
    assert.equal(formatOrderTotal('68.5'), formatBRL(68.5));
    assert.equal(formatOrderTotal(0), formatBRL(0));
    assert.equal(formatOrderTotal(null), 'R$ —');
    assert.equal(formatOrderTotal(undefined), 'R$ —');
    assert.equal(formatOrderTotal(''), 'R$ —');
    assert.equal(formatOrderTotal('abc'), 'R$ —');
  });

  it('isMissingTotal distingue zero válido de ausente', () => {
    assert.equal(isMissingTotal(0), false);
    assert.equal(isMissingTotal(10), false);
    assert.equal(isMissingTotal(null), true);
    assert.equal(isMissingTotal(undefined), true);
    assert.equal(isMissingTotal(''), true);
    assert.equal(isMissingTotal('xx'), true);
  });
});
