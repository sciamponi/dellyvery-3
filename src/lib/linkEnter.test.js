import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { filterLinkCustomers, resolveCustomerEnter } from './linkEnter.js';

const results = [
  { id: 'c1', name: 'Zap Alerta', phone: '11999990058' },
  { id: 'c2', name: 'André Silva', phone: '11988887777' },
  { id: 'c3', name: 'Maria', phone: '11977776666' },
];

describe('linkEnter — filtro compartilhado', () => {
  it('nome parcial e telefone; vazio lista tudo (limite 8)', () => {
    assert.deepEqual(filterLinkCustomers(results, 'andré').map((c) => c.id), ['c2']);
    assert.deepEqual(filterLinkCustomers(results, '9999900').map((c) => c.id), ['c1']);
    assert.equal(filterLinkCustomers(results, '').length, 3);
    assert.equal(filterLinkCustomers(null, 'x').length, 0);
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `k${i}`, name: `N${i}` }));
    assert.equal(filterLinkCustomers(many, '').length, 8);
  });
});

describe('linkEnter — Enter na busca de cliente', () => {
  it('destacado válido confirma (com validações do fluxo)', () => {
    assert.deepEqual(
      resolveCustomerEnter({ results, query: 'andré', custSelected: 'c2', busy: false }),
      { action: 'confirm' },
    );
  });

  it('único resultado seleciona sem salvar sozinho', () => {
    assert.deepEqual(
      resolveCustomerEnter({ results, query: 'maria', custSelected: '', busy: false }),
      { action: 'select', id: 'c3' },
    );
  });

  it('vários resultados nunca selecionam arbitrariamente', () => {
    assert.deepEqual(
      resolveCustomerEnter({ results, query: '', custSelected: '', busy: false }),
      { action: 'none' },
    );
    assert.deepEqual(
      resolveCustomerEnter({ results, query: 'a', custSelected: '', busy: false }),
      { action: 'none' },
    );
  });

  it('sem texto e sem destaque não faz nada; busy bloqueia tudo', () => {
    assert.deepEqual(
      resolveCustomerEnter({ results: [], query: '', custSelected: '', busy: false }),
      { action: 'none' },
    );
    assert.deepEqual(
      resolveCustomerEnter({ results, query: 'maria', custSelected: '', busy: true }),
      { action: 'none' },
    );
    assert.deepEqual(
      resolveCustomerEnter({ results, query: 'andré', custSelected: 'c2', busy: true }),
      { action: 'none' },
    );
  });

  it('destaque obsoleto não confirma; único visível vence', () => {
    // Destaque inexistente + vários visíveis → nada.
    assert.deepEqual(
      resolveCustomerEnter({ results, query: '', custSelected: 'c9', busy: false }),
      { action: 'none' },
    );
    // Destaque fora da lista filtrada + um único visível → seleciona o visível.
    assert.deepEqual(
      resolveCustomerEnter({ results, query: 'maria', custSelected: 'c1', busy: false }),
      { action: 'select', id: 'c3' },
    );
  });
});
