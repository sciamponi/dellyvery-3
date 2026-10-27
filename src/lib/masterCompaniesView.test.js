import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  companiesViewState,
  companyStatusMeta,
  subscriptionStatusMeta,
  billingCycleLabel,
  formatPlanPrice,
  masterCompaniesEmptyMessage,
  masterCompaniesLimitNote,
} from './masterCompaniesView.js';

describe('masterCompaniesView — estados e rótulos', () => {
  it('prioriza loading, depois erro, depois vazio e pronto', () => {
    assert.equal(companiesViewState({ loading: true, error: 'x', total: 0 }), 'loading');
    assert.equal(companiesViewState({ loading: false, error: 'x', total: 0 }), 'error');
    assert.equal(companiesViewState({ loading: false, error: '', total: 0 }), 'empty');
    assert.equal(companiesViewState({ loading: false, error: '', total: 2 }), 'ready');
  });

  it('rótulos usam apenas situações reais do schema', () => {
    assert.equal(companyStatusMeta(true).label, 'Ativa');
    assert.equal(companyStatusMeta(false).label, 'Inativa');
    assert.equal(subscriptionStatusMeta('trial').label, 'Trial');
    assert.equal(subscriptionStatusMeta('ativo').label, 'Ativo');
    assert.equal(subscriptionStatusMeta('pendente').label, 'Pendente');
    assert.equal(subscriptionStatusMeta('cancelado').label, 'Cancelado');
    assert.equal(subscriptionStatusMeta('suspenso').label, 'Suspenso');
    assert.equal(subscriptionStatusMeta('expirado').label, 'Expirado');
    assert.equal(subscriptionStatusMeta(null).label, 'Sem assinatura');
    assert.equal(subscriptionStatusMeta('desconhecido').label, 'desconhecido');
  });

  it('plano mostra preço e ciclo existentes', () => {
    assert.equal(billingCycleLabel('monthly'), 'Mensal');
    assert.equal(billingCycleLabel('yearly'), 'Anual');
    assert.equal(billingCycleLabel(null), '—');
    assert.match(formatPlanPrice({ price: 49.9, billing_cycle: 'monthly' }), /49,90\/mês$/);
    assert.match(formatPlanPrice({ price: 499, billing_cycle: 'yearly' }), /499,00\/ano$/);
    assert.match(formatPlanPrice({ price: 49.9, billingCycle: 'monthly' }), /49,90\/mês$/);
    assert.equal(formatPlanPrice(null), '—');
  });

  it('mensagens de vazio e limite refletem filtros e paginação futura', () => {
    assert.match(masterCompaniesEmptyMessage(), /Nenhuma empresa cadastrada/);
    assert.match(masterCompaniesEmptyMessage({ search: 'x' }), /filtros atuais/);
    assert.match(masterCompaniesEmptyMessage({ subscriptionStatus: 'none' }), /filtros atuais/);
    assert.match(masterCompaniesLimitNote({ hasMore: false }), /limitada a 200/);
    assert.match(masterCompaniesLimitNote({ hasMore: true }), /Há mais resultados/);
  });
});
