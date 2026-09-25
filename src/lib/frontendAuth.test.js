import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCurrentCompany, companyStorageKey, loadSavedCompanyId, saveCompanyId } from './companySelection.js';
import { shouldAllowProtected } from './routeGuard.js';

const m = (id, role = 'OWNER') => ({ companyId: id, role, company: { id, name: `C ${id}`, slug: id } });

describe('companySelection', () => {
  it('sem memberships retorna null (usuário sem empresa)', () => {
    assert.equal(resolveCurrentCompany([], null), null);
    assert.equal(resolveCurrentCompany(null, null), null);
  });

  it('uma única empresa é selecionada automaticamente', () => {
    assert.deepEqual(resolveCurrentCompany([m('c1')], null), m('c1'));
    assert.deepEqual(resolveCurrentCompany([m('c1')], 'outro-id'), m('c1'));
  });

  it('múltiplas empresas respeitam a seleção salva válida', () => {
    const list = [m('c1'), m('c2', 'ADMIN')];
    assert.deepEqual(resolveCurrentCompany(list, 'c2'), m('c2', 'ADMIN'));
  });

  it('múltiplas empresas com seleção inválida retornam null (UI pede escolha)', () => {
    assert.equal(resolveCurrentCompany([m('c1'), m('c2')], 'c9'), null);
    assert.equal(resolveCurrentCompany([m('c1'), m('c2')], null), null);
  });

  it('storage helpers persistem por usuário', () => {
    const store = new Map();
    const storage = {
      getItem: (k) => store.get(k) || null,
      setItem: (k, v) => store.set(k, v),
      removeItem: (k) => store.delete(k),
    };
    assert.ok(companyStorageKey('u1').includes('u1'));
    assert.equal(loadSavedCompanyId(storage, 'u1'), null);
    saveCompanyId(storage, 'u1', 'c1');
    assert.equal(loadSavedCompanyId(storage, 'u1'), 'c1');
  });
});

describe('routeGuard', () => {
  it('não autenticado bloqueia', () => {
    assert.equal(shouldAllowProtected({ base44Authenticated: false, sbConfigured: false, sbUser: null }), false);
    assert.equal(shouldAllowProtected({ base44Authenticated: false, sbConfigured: true, sbUser: null }), false);
  });

  it('sessão Base44 permite (legado intacto)', () => {
    assert.equal(shouldAllowProtected({ base44Authenticated: true, sbConfigured: false, sbUser: null }), true);
  });

  it('sessão Supabase permite', () => {
    assert.equal(shouldAllowProtected({ base44Authenticated: false, sbConfigured: true, sbUser: { id: 'u1' } }), true);
  });
});
