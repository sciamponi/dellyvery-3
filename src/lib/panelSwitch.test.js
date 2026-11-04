import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  availablePanels,
  currentPanelFromPath,
} from './panelSwitch.js';

describe('panelSwitch - contextos disponiveis', () => {
  it('cliente sem vinculo ve apenas o painel cliente', () => {
    assert.deepEqual(availablePanels(), ['client']);
    assert.deepEqual(
      availablePanels({ isAdmin: false, isReseller: false }),
      ['client'],
    );
  });

  it('revendedor autorizado ve cliente e revenda, sem master', () => {
    assert.deepEqual(
      availablePanels({ isReseller: true }),
      ['client', 'reseller'],
    );
  });

  it('master autorizado ve cliente e master, sem revenda automatica', () => {
    assert.deepEqual(
      availablePanels({ isAdmin: true }),
      ['client', 'master'],
    );
  });

  it('mesma identidade com ambos os vinculos ve os tres contextos', () => {
    assert.deepEqual(
      availablePanels({ isAdmin: true, isReseller: true }),
      ['client', 'master', 'reseller'],
    );
  });

  it('mantem o contexto atual mesmo antes da checagem paralela terminar', () => {
    assert.deepEqual(
      availablePanels({ currentPanel: 'master' }),
      ['client', 'master'],
    );
    assert.deepEqual(
      availablePanels({ currentPanel: 'reseller' }),
      ['client', 'reseller'],
    );
  });
});

describe('panelSwitch - rota atual', () => {
  it('distingue revenda administrativa de revenda operacional', () => {
    assert.equal(currentPanelFromPath('/master/revenda'), 'master');
    assert.equal(currentPanelFromPath('/master/revenda/creditos'), 'master');
    assert.equal(currentPanelFromPath('/revenda'), 'reseller');
    assert.equal(currentPanelFromPath('/revenda/creditos'), 'reseller');
  });

  it('usa cliente como contexto padrao', () => {
    assert.equal(currentPanelFromPath('/dashboard'), 'client');
    assert.equal(currentPanelFromPath('/pedidos'), 'client');
    assert.equal(currentPanelFromPath('/masterful'), 'client');
    assert.equal(currentPanelFromPath(null), 'client');
  });
});
