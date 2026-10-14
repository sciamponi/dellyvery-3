import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { v2selFromItemConfig, legacySelFromComplements } from './cartEdit.js';

describe('cartEdit — v2selFromItemConfig', () => {
  it('reconstrói seleção por step/option com quantidades', () => {
    assert.deepEqual(
      v2selFromItemConfig({ steps: [{ step_id: 's', items: [{ option_id: 'o', quantity: 2 }] }] }),
      { s: { o: 2 } },
    );
  });

  it('tolerante a config ausente ou malformada', () => {
    assert.deepEqual(v2selFromItemConfig(null), {});
    assert.deepEqual(v2selFromItemConfig({}), {});
    assert.deepEqual(v2selFromItemConfig({ steps: [{ step_id: '', items: [] }] }), {});
  });
});

describe('cartEdit — legacySelFromComplements', () => {
  const product = {
    complements: [
      { name: 'Molhos', options: [{ name: 'Barbecue', price: 0 }, { name: 'Cheddar', price: 3 }] },
    ],
  };

  it('recasa grupo/opção pelos nomes do snapshot', () => {
    assert.deepEqual(
      legacySelFromComplements(product, [{ group_name: 'Molhos', option_name: 'Cheddar', price: 3, quantity: 1 }]),
      { '0_1': { group_name: 'Molhos', option_name: 'Cheddar', price: 3, quantity: 1 } },
    );
  });

  it('ignora itens sem correspondência no catálogo atual', () => {
    assert.deepEqual(legacySelFromComplements(product, [{ group_name: 'X', option_name: 'Y' }]), {});
    assert.deepEqual(legacySelFromComplements(null, [{ group_name: 'Molhos', option_name: 'Cheddar' }]), {});
    assert.deepEqual(legacySelFromComplements(product, null), {});
  });
});
