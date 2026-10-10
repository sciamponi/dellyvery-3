import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MASTER_EMAIL_ALIASES,
  resolveMasterIdentifier,
  classifyMasterAuthError,
  masterAuthMessage,
} from './masterAuth.js';

describe('masterAuth — identificador', () => {
  it('e-mail passa direto (normalizado)', () => {
    assert.equal(resolveMasterIdentifier('Admin@X.com'), 'admin@x.com');
    assert.equal(resolveMasterIdentifier('  a@b.com  '), 'a@b.com');
  });

  it('apelido resolve para o e-mail; desconhecido vira vazio', () => {
    assert.equal(resolveMasterIdentifier('sciamponi'), MASTER_EMAIL_ALIASES.sciamponi);
    assert.equal(resolveMasterIdentifier('SCIAMPONI'), MASTER_EMAIL_ALIASES.sciamponi);
    assert.equal(resolveMasterIdentifier('fulano'), '');
    assert.equal(resolveMasterIdentifier(''), '');
  });
});

describe('masterAuth — classificação de erros', () => {
  it('credencial inválida', () => {
    assert.equal(classifyMasterAuthError({ code: 'invalid_credentials' }), 'invalid');
    assert.equal(classifyMasterAuthError(new Error('Invalid login credentials')), 'invalid');
  });

  it('rede (Failed to fetch)', () => {
    assert.equal(classifyMasterAuthError(new TypeError('Failed to fetch')), 'network');
    assert.equal(classifyMasterAuthError({ message: 'fetch failed' }), 'network');
  });

  it('não confirmado / negado / desconhecido', () => {
    assert.equal(classifyMasterAuthError({ code: 'email_not_confirmed' }), 'unconfirmed');
    assert.equal(classifyMasterAuthError(new Error('Acesso restrito')), 'denied');
    assert.equal(classifyMasterAuthError(new Error('boom')), 'unknown');
    assert.equal(classifyMasterAuthError(null), 'unknown');
  });

  it('mensagens distintas por código', () => {
    assert.ok(masterAuthMessage({ code: 'invalid_credentials' }).includes('inválidos'));
    assert.ok(masterAuthMessage(new TypeError('Failed to fetch')).includes('Supabase local'));
    assert.notEqual(
      masterAuthMessage({ code: 'invalid_credentials' }),
      masterAuthMessage(new TypeError('Failed to fetch')),
    );
  });
});
