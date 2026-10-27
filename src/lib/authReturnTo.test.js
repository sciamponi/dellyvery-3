import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { safeNextPath, safeReturnTo } from './authReturnTo.js';

function withSearch(search, fn) {
  const previous = globalThis.window;
  globalThis.window = { location: { origin: 'https://app.test', search } };
  try {
    return fn();
  } finally {
    globalThis.window = previous;
  }
}

describe('authReturnTo — next do link de acesso', () => {
  it('sem next usa o fallback; caminho interno é preservado', () => {
    assert.equal(withSearch('', () => safeNextPath('/login')), '/login');
    assert.equal(withSearch('?next=%2Frevenda', () => safeNextPath('/login')), '/revenda');
    assert.equal(withSearch('?next=%2Frevenda%3Ftab%3D1', () => safeNextPath('/login')), '/revenda?tab=1');
  });

  it('bloqueia open redirect e caminhos ambíguos', () => {
    assert.equal(withSearch('?next=https%3A%2F%2Fevil.test', () => safeNextPath('/revenda')), '/revenda');
    assert.equal(withSearch('?next=%2F%2Fevil.test', () => safeNextPath('/revenda')), '/revenda');
    assert.equal(withSearch('?next=%2F%5Cevil.test', () => safeNextPath('/revenda')), '/revenda');
    assert.equal(withSearch('?next=revenda', () => safeNextPath('/revenda')), '/revenda');
  });

  it('remove parâmetros de bootstrap que envenenariam a sessão', () => {
    const out = withSearch('?next=%2Frevenda%3Faccess_token%3Dx%26app_base_url%3Devil', () => safeNextPath('/login'));
    assert.equal(out, '/revenda');
    assert.ok(!out.includes('access_token'));
    assert.ok(!out.includes('app_base_url'));
  });

  it('returnTo continua aceitando apenas caminho same-origin', () => {
    assert.equal(withSearch('?returnTo=%2Fdashboard', () => safeReturnTo()), '/dashboard');
    assert.equal(withSearch('?returnTo=%2F%2Fevil.test', () => safeReturnTo()), '/');
  });
});
