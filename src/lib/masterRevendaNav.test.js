import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MASTER_REVENDA_PATHS,
  masterRevendaTabFromPath,
} from './masterRevendaNav.js';

describe('masterRevendaNav - rotas da secao Revenda', () => {
  it('identifica as rotas canonicas', () => {
    assert.equal(masterRevendaTabFromPath(MASTER_REVENDA_PATHS.gestao), 'gestao');
    assert.equal(masterRevendaTabFromPath(MASTER_REVENDA_PATHS.creditos), 'creditos');
    assert.equal(masterRevendaTabFromPath(MASTER_REVENDA_PATHS.compras), 'compras');
  });

  it('mantem a rota legada de compras no contexto de compras', () => {
    assert.equal(masterRevendaTabFromPath('/master/compras'), 'compras');
  });

  it('aceita subrotas e barra final', () => {
    assert.equal(masterRevendaTabFromPath('/master/revenda/creditos/'), 'creditos');
    assert.equal(masterRevendaTabFromPath('/master/revenda/compras/historico'), 'compras');
  });

  it('nao classifica rotas fora da revenda', () => {
    assert.equal(masterRevendaTabFromPath('/master'), null);
    assert.equal(masterRevendaTabFromPath('/master/revenda-clientes'), null);
    assert.equal(masterRevendaTabFromPath(null), null);
  });
});
