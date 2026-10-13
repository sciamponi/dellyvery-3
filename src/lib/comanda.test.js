import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  COMANDA_MAX_LEN,
  normalizeComandaName,
  isComandaEditable,
  resolveComandaName,
  buildComandaPatch,
  ticketComanda,
} from './comanda.js';

describe('comanda — normalização', () => {
  it('texto livre com limite; vazio permitido', () => {
    assert.equal(normalizeComandaName('  André  '), 'André');
    assert.equal(normalizeComandaName('Mesa 3'), 'Mesa 3');
    assert.equal(normalizeComandaName(''), '');
    assert.equal(normalizeComandaName(null), '');
    assert.equal(normalizeComandaName('x'.repeat(100)).length, COMANDA_MAX_LEN);
  });
});

describe('comanda — escopo (só retirada sem cliente)', () => {
  it('editável apenas em retirada sem customer_id', () => {
    assert.equal(isComandaEditable({ order_type: 'retirada', customer_id: null }), true);
    assert.equal(isComandaEditable({ order_type: 'retirada', customer_id: 'c1' }), false);
    assert.equal(isComandaEditable({ order_type: 'delivery', customer_id: null }), false);
    assert.equal(isComandaEditable({ order_type: 'mesa', customer_id: null }), false);
    assert.equal(isComandaEditable(null), false);
  });

  it('resolve nome do snapshot, nunca de cadastro', () => {
    assert.equal(resolveComandaName({ order_type: 'retirada', customer_id: null, customer_name: 'João' }), 'João');
    assert.equal(
      resolveComandaName({ order_type: 'retirada', customer_id: null, customer_name: '', customer_data: { name: 'André' } }),
      'André',
    );
    assert.equal(resolveComandaName({ order_type: 'retirada', customer_id: null, customer_name: '' }), '');
    assert.equal(resolveComandaName({ order_type: 'delivery', customer_id: null, customer_name: 'Maria' }), '');
    assert.equal(resolveComandaName({ order_type: 'retirada', customer_id: 'c9', customer_name: 'Cadastrado' }), '');
  });
});

describe('comanda — patch preserva snapshot e customer_id', () => {
  it('mexe só em name; mantém phone/email', () => {
    assert.deepEqual(
      buildComandaPatch({ name: '', phone: '119', email: 'a@b.c' }, '  André '),
      { name: 'André', phone: '119', email: 'a@b.c' },
    );
    assert.deepEqual(buildComandaPatch(null, ''), { name: '' });
    assert.deepEqual(buildComandaPatch({ phone: '' }, 'Mesa 3'), { phone: '', name: 'Mesa 3' });
  });
});

describe('comanda — decisão de impressão', () => {
  it('named / avulso / null por tipo', () => {
    assert.deepEqual(
      ticketComanda({ order_type: 'retirada', customer_id: null, customer_name: 'André' }),
      { kind: 'named', name: 'André' },
    );
    assert.deepEqual(
      ticketComanda({ order_type: 'retirada', customer_id: null, customer_name: '' }),
      { kind: 'avulso' },
    );
    assert.equal(ticketComanda({ order_type: 'delivery', customer_id: null, customer_name: 'Maria' }), null);
    assert.equal(ticketComanda({ order_type: 'mesa', customer_id: null, customer_name: '', table_number: '5' }), null);
    assert.equal(ticketComanda({ order_type: 'retirada', customer_id: 'c1', customer_name: 'Cadastrado' }), null);
    assert.equal(ticketComanda(null), null);
  });
});
