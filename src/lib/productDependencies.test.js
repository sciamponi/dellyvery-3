import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkCartDependencies, rulesForProducts, buildDepRulesFromProducts, buildDepModesFromProducts } from './productDependencies.js';

const BATATA = 'batata';
const BURGUER = 'lanche';
const COMBO = 'combo';
const COCA = 'coca';

const rules = [
  { product_id: BATATA, product_name: 'Batata frita', requires_product_id: BURGUER, requires_name: 'Lanche', active: true },
  { product_id: BATATA, product_name: 'Batata frita', requires_product_id: COMBO, requires_name: 'Combo', active: true },
  { product_id: COCA, product_name: 'Coca', requires_product_id: BURGUER, requires_name: 'Lanche', active: false },
];

describe('productDependencies — checkCartDependencies', () => {
  it('sem regra: tudo passa; carrinho vazio passa', () => {
    assert.deepEqual(checkCartDependencies([{ product_id: BATATA, quantity: 1 }], []), []);
    assert.deepEqual(checkCartDependencies([], rules), []);
  });

  it('dependente sozinho falha com mensagem OR', () => {
    const errs = checkCartDependencies([{ product_id: BATATA, quantity: 1 }], rules);
    assert.equal(errs.length, 1);
    assert.equal(errs[0].message, 'Batata frita exige Lanche ou Combo no pedido');
  });

  it('qualquer exigido satisfaz (OR); múltiplas linhas geram 1 erro', () => {
    assert.deepEqual(checkCartDependencies([
      { product_id: BATATA, quantity: 1 }, { product_id: COMBO, quantity: 1 },
    ], rules), []);
    assert.deepEqual(checkCartDependencies([
      { product_id: BATATA, quantity: 2 }, { product_id: BATATA, quantity: 1 },
    ], rules).length, 1);
  });

  it('regra inativa ignora; quantidade zero ignora', () => {
    assert.deepEqual(checkCartDependencies([{ product_id: COCA, quantity: 1 }], rules), []);
    assert.deepEqual(checkCartDependencies([{ product_id: BATATA, quantity: 0 }], rules), []);
  });

  it('duplicadas colapsam; sem nome usa genérico', () => {
    const dup = [...rules, { ...rules[0] }];
    assert.equal(checkCartDependencies([{ product_id: BATATA, quantity: 1 }], dup).length, 1);
    const anon = [{ product_id: BATATA, requires_product_id: BURGUER, active: true }];
    assert.equal(checkCartDependencies([{ product_id: BATATA, quantity: 1 }], anon)[0].message, 'Produto exige outro item no pedido');
  });
});

describe('productDependencies — rulesForProducts', () => {
  it('filtra ativas do conjunto', () => {
    assert.equal(rulesForProducts(rules, [BATATA, COCA]).length, 2);
    assert.equal(rulesForProducts(rules, [COCA]).length, 0);
    assert.deepEqual(rulesForProducts(null, [BATATA]), []);
  });
});

describe('productDependencies — buildDepRulesFromProducts (storefront)', () => {
  it('converte requires em regras; sem requires não gera regra', () => {
    const products = [
      { id: BATATA, name: 'Batata frita', requires: [{ id: BURGUER, name: 'Lanche' }, { id: COMBO, name: 'Combo' }] },
      { id: COCA, name: 'Coca' },
      { id: COMBO, name: 'Combo', requires: [] },
    ];
    const out = buildDepRulesFromProducts(products);
    assert.equal(out.length, 2);
    assert.deepEqual(out[0], {
      product_id: BATATA, product_name: 'Batata frita',
      requires_product_id: BURGUER, requires_name: 'Lanche', active: true,
    });
    assert.deepEqual(checkCartDependencies([{ product_id: BATATA, quantity: 1 }], out).length, 1);
    assert.deepEqual(
      checkCartDependencies([{ product_id: BATATA, quantity: 1 }, { product_id: COMBO, quantity: 1 }], out),
      [],
    );
  });

  it('tolerante a entrada ausente; produto sem requires vende sozinho', () => {
    assert.deepEqual(buildDepRulesFromProducts(null), []);
    assert.deepEqual(buildDepRulesFromProducts(undefined), []);
    assert.deepEqual(buildDepRulesFromProducts([{ id: COCA, name: 'Coca' }]), []);
    assert.deepEqual(checkCartDependencies([{ product_id: COCA, quantity: 3 }], []), []);
  });
});

describe('productDependencies — montagem do pedido (Gate 3)', () => {
  it('remoção do exigido durante a montagem gera erro (sem alterar itens)', () => {
    const cart = [
      { product_id: BATATA, quantity: 1 },
      { product_id: BURGUER, quantity: 1 },
    ];
    assert.deepEqual(checkCartDependencies(cart, rules), []);
    const snapshot = JSON.parse(JSON.stringify(cart));
    // Cliente remove o lanche: dependente fica órfão.
    const afterRemove = [cart[0]];
    const errs = checkCartDependencies(afterRemove, rules);
    assert.equal(errs.length, 1);
    assert.match(errs[0].message, /Batata frita exige/);
    // Nada foi removido/alterado silenciosamente pela validação.
    assert.deepEqual(cart, snapshot);
    assert.deepEqual(afterRemove, [{ product_id: BATATA, quantity: 1 }]);
  });

  it('exigido com quantidade zerada não satisfaz; repetidos contam por presença', () => {
    assert.equal(
      checkCartDependencies(
        [{ product_id: BATATA, quantity: 1 }, { product_id: BURGUER, quantity: 0 }],
        rules,
      ).length,
      1,
    );
    assert.deepEqual(
      checkCartDependencies(
        [{ product_id: BATATA, quantity: 1 }, { product_id: BURGUER, quantity: 1 }, { product_id: BURGUER, quantity: 2 }],
        rules,
      ),
      [],
    );
  });

  it('regra de um produto não afeta outro (isolamento por produto)', () => {
    // Coca não tem regra ativa: vende sozinha mesmo com regra da batata.
    assert.deepEqual(checkCartDependencies([{ product_id: COCA, quantity: 1 }], rules), []);
    // Batata + coca (sem lanche/combo): batata continua inválida.
    assert.equal(
      checkCartDependencies(
        [{ product_id: BATATA, quantity: 1 }, { product_id: COCA, quantity: 1 }],
        rules,
      ).length,
      1,
    );
  });

  it('múltiplos dependentes geram um erro por produto', () => {
    const multi = [
      ...rules,
      { product_id: 'sobremesa', product_name: 'Pudim', requires_product_id: BURGUER, requires_name: 'Lanche', active: true },
    ];
    const errs = checkCartDependencies(
      [{ product_id: BATATA, quantity: 1 }, { product_id: 'sobremesa', quantity: 1 }],
      multi,
    );
    assert.equal(errs.length, 2);
    // Adicionar o lanche resolve ambos de uma vez.
    assert.deepEqual(
      checkCartDependencies(
        [{ product_id: BATATA, quantity: 1 }, { product_id: 'sobremesa', quantity: 1 }, { product_id: BURGUER, quantity: 1 }],
        multi,
      ),
      [],
    );
  });
});

describe('productDependencies — modo all (combos)', () => {
  const comboRules = [
    { product_id: 'combo', product_name: 'Combo Hambúrguer', requires_product_id: BURGUER, requires_name: 'Lanche', active: true },
    { product_id: 'combo', product_name: 'Combo Hambúrguer', requires_product_id: 'bebida', requires_name: 'Bebida', active: true },
  ];
  const cart1 = [{ product_id: 'combo', quantity: 1 }, { product_id: BURGUER, quantity: 1 }];

  it('any (padrão): um exigido basta; all: faltando um falha', () => {
    assert.deepEqual(checkCartDependencies(cart1, comboRules), []);
    assert.deepEqual(checkCartDependencies(cart1, comboRules, {}), []);
    const errs = checkCartDependencies(cart1, comboRules, { combo: 'all' });
    assert.equal(errs.length, 1);
    assert.equal(errs[0].mode, 'all');
    assert.match(errs[0].message, /Combo Hambúrguer exige Bebida no pedido/);
  });

  it('all satisfeito quando todos presentes; mensagem lista faltantes', () => {
    const full = [...cart1, { product_id: 'bebida', quantity: 1 }];
    assert.deepEqual(checkCartDependencies(full, comboRules, { combo: 'all' }), []);
    const none = checkCartDependencies([{ product_id: 'combo', quantity: 1 }], comboRules, { combo: 'all' });
    assert.match(none[0].message, /Lanche, Bebida/);
  });

  it('buildDepModesFromProducts: só all explícito entra no mapa', () => {
    assert.deepEqual(buildDepModesFromProducts(null), {});
    assert.deepEqual(
      buildDepModesFromProducts([
        { id: 'combo', dependency_mode: 'all' },
        { id: BATATA, dependency_mode: 'any' },
        { id: COCA },
      ]),
      { combo: 'all' },
    );
  });
});
