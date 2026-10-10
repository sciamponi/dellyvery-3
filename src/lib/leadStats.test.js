import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeLeads } from './leadStats.js';

const leads = [
  { id: '1', service: 'dellyvery', billing_period: 'mensal', status: 'novo', created_at: '2026-10-03T10:00:00Z', full_name: 'A' },
  { id: '2', service: 'dellyvery', billing_period: 'anual', status: 'em_contato', created_at: '2026-10-04T10:00:00Z', full_name: 'B' },
  { id: '3', service: 'barberia', billing_period: null, status: 'novo', created_at: '2026-10-02T10:00:00Z', full_name: 'C' },
  { id: '4', service: 'dellyvery', billing_period: 'mensal', status: 'contratado', created_at: '2026-10-05T10:00:00Z', full_name: 'D' },
];

describe('leadStats — indicadores reais', () => {
  it('totais e novos', () => {
    const s = summarizeLeads(leads);
    assert.equal(s.total, 4);
    assert.equal(s.novos, 2);
  });

  it('distribuições ordenadas por volume', () => {
    const s = summarizeLeads(leads);
    assert.deepEqual(s.byService, [
      { label: 'dellyvery', count: 3 },
      { label: 'barberia', count: 1 },
    ]);
    const billing = Object.fromEntries(s.byBilling.map((x) => [x.label, x.count]));
    assert.deepEqual(billing, { mensal: 2, anual: 1, '—': 1 });
    assert.equal(s.byBilling[0].label, 'mensal');
    assert.equal(s.byStatus.find((x) => x.label === 'novo').count, 2);
  });

  it('recentes primeiro + lista vazia segura', () => {
    const s = summarizeLeads(leads, { recentLimit: 2 });
    assert.deepEqual(s.recent.map((l) => l.id), ['4', '2']);
    const empty = summarizeLeads([]);
    assert.equal(empty.total, 0);
    assert.deepEqual(empty.recent, []);
    assert.deepEqual(summarizeLeads(null).byService, []);
  });
});
