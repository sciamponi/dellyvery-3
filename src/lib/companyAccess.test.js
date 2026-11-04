import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  COMPANY_ACCESS_STATUS,
  readCompanyActiveAccess,
  resolveCompanyAccess,
  shouldRenderCompanyPanel,
} from './companyAccess.js';

describe('companyAccess — destino do login por perfil', () => {
  it('mantém a empresa ativa no painel da empresa', () => {
    assert.equal(
      resolveCompanyAccess({ hasCompany: true, companyActive: true }),
      COMPANY_ACCESS_STATUS.ACTIVE,
    );
  });

  it('bloqueia empresa sem acesso ativo', () => {
    assert.equal(
      resolveCompanyAccess({ hasCompany: true, companyActive: false }),
      COMPANY_ACCESS_STATUS.EXPIRED,
    );
  });

  it('não prende Master/revendedor no acesso expirado da própria empresa', () => {
    assert.equal(
      resolveCompanyAccess({
        hasCompany: true,
        companyActive: false,
        adminStatus: 'allowed',
      }),
      COMPANY_ACCESS_STATUS.MASTER,
    );
    assert.equal(
      resolveCompanyAccess({
        hasCompany: true,
        companyActive: false,
        resellerStatus: 'allowed',
      }),
      COMPANY_ACCESS_STATUS.RESELLER,
    );
  });

  it('mantém a empresa ativa como destino mesmo para Master/revendedor', () => {
    assert.equal(
      resolveCompanyAccess({
        hasCompany: true,
        companyActive: true,
        adminStatus: 'allowed',
        resellerStatus: 'allowed',
      }),
      COMPANY_ACCESS_STATUS.ACTIVE,
    );
  });

  it('manda Master sem empresa para o painel Master', () => {
    assert.equal(
      resolveCompanyAccess({ adminStatus: 'allowed' }),
      COMPANY_ACCESS_STATUS.MASTER,
    );
  });

  it('manda revendedor ativo ou suspenso para o painel de revenda', () => {
    assert.equal(
      resolveCompanyAccess({ resellerStatus: 'allowed' }),
      COMPANY_ACCESS_STATUS.RESELLER,
    );
    assert.equal(
      resolveCompanyAccess({ resellerStatus: 'suspended' }),
      COMPANY_ACCESS_STATUS.RESELLER,
    );
  });

  it('mantém cliente pendente e expirado nos fluxos próprios', () => {
    assert.equal(
      resolveCompanyAccess({ clientStatus: 'pending' }),
      COMPANY_ACCESS_STATUS.PENDING,
    );
    assert.equal(
      resolveCompanyAccess({ clientStatus: 'expired' }),
      COMPANY_ACCESS_STATUS.EXPIRED,
    );
  });

  it('não confunde cliente ativo sem empresa carregada com novo cadastro', () => {
    assert.equal(
      resolveCompanyAccess({ clientStatus: 'active' }),
      COMPANY_ACCESS_STATUS.MISSING_COMPANY,
    );
  });

  it('só manda usuário sem vínculo para criar restaurante', () => {
    assert.equal(resolveCompanyAccess(), COMPANY_ACCESS_STATUS.NO_COMPANY);
  });

  it('expõe falha de consulta em vez de redirecionar por perfil', () => {
    assert.equal(
      resolveCompanyAccess({ adminStatus: 'network' }),
      COMPANY_ACCESS_STATUS.ACCESS_ERROR,
    );
    assert.equal(
      resolveCompanyAccess({ resellerStatus: 'network' }),
      COMPANY_ACCESS_STATUS.ACCESS_ERROR,
    );
  });
});

describe('companyAccess - checagem fail-closed da empresa', () => {
  it('confirma acesso ativo somente com true', async () => {
    assert.equal(await readCompanyActiveAccess(async () => true), true);
  });

  it('mantem acesso negado com false', async () => {
    assert.equal(await readCompanyActiveAccess(async () => false), false);
  });

  it('propaga rejeicao da RPC', async () => {
    await assert.rejects(
      readCompanyActiveAccess(async () => {
        throw new Error('falha da rpc');
      }),
      /falha da rpc/,
    );
  });

  it('trata timeout como erro', async () => {
    await assert.rejects(
      readCompanyActiveAccess(() => new Promise(() => {}), { timeoutMs: 5 }),
      /Tempo esgotado/,
    );
  });

  it('trata resposta invalida como erro', async () => {
    await assert.rejects(readCompanyActiveAccess(async () => 'true'), /Resposta invalida/);
    await assert.rejects(readCompanyActiveAccess(async () => null), /Resposta invalida/);
    await assert.rejects(readCompanyActiveAccess(async () => 1), /Resposta invalida/);
  });

  it('permite retry bem-sucedido apos falha', async () => {
    let calls = 0;
    const loader = async () => {
      calls += 1;
      if (calls === 1) throw new Error('falha temporaria');
      return true;
    };

    await assert.rejects(readCompanyActiveAccess(loader), /falha temporaria/);
    assert.equal(await readCompanyActiveAccess(loader), true);
    assert.equal(calls, 2);
  });

  it('nunca libera o painel em erro ou estado desconhecido', () => {
    assert.equal(shouldRenderCompanyPanel(COMPANY_ACCESS_STATUS.ACTIVE), true);
    for (const status of [
      COMPANY_ACCESS_STATUS.ACCESS_ERROR,
      COMPANY_ACCESS_STATUS.EXPIRED,
      COMPANY_ACCESS_STATUS.MASTER,
      COMPANY_ACCESS_STATUS.RESELLER,
      COMPANY_ACCESS_STATUS.PENDING,
      COMPANY_ACCESS_STATUS.MISSING_COMPANY,
      COMPANY_ACCESS_STATUS.NO_COMPANY,
      COMPANY_ACCESS_STATUS.NO_USER,
      'checking',
      'desconhecido',
    ]) {
      assert.equal(shouldRenderCompanyPanel(status), false, status);
    }
  });

  it('componente usa a checagem fail-closed e o guard final do painel', () => {
    const source = readFileSync(
      new URL('../components/CompanyAccessRoute.jsx', import.meta.url),
      'utf8',
    );
    assert.match(source, /readCompanyActiveAccess/);
    assert.doesNotMatch(source, /let active = true/);
    assert.match(source, /catch \{[\s\S]{0,160}COMPANY_ACCESS_STATUS\.ACCESS_ERROR/);
    assert.match(source, /if \(!shouldRenderCompanyPanel\(state\.status\)\)/);
  });
});
