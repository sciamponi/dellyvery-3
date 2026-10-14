// DELLVERY 3 — Etapa opcional "Que tal completar seu pedido?" (puro, testável).
// Após adicionar um LANCHE, oferece acompanhamentos e bebidas sem obrigar
// e sem adicionar nada sozinho. Regras anti-loop e de escopo:
// - dispara só para produto cuja categoria tem slug 'lanches';
// - nunca para bebida/acompanhamento/sobremesa (sem repetição infinita);
// - lista só itens das categorias da oferta, da MESMA empresa (o cardápio
//   público já vem filtrado por empresa, ativos e com estoque no storefront);
// - indisponíveis nunca entram (não estão na lista de origem);
// - itens cuja dependência não é atendida pelo carrinho atual são ocultados
//   DAS OFERTAS (o cardápio completo continua exibindo tudo).
// Dependências continuam por ID exato (Gate 3, servidor é a autoridade);
// aqui só se decide exibir ou ocultar a oferta.

import { checkCartDependencies } from './productDependencies.js';

export const OFFER_CATEGORY_SLUGS = ['acompanhamentos', 'bebidas'];

export function categorySlugOf(product, categories) {
  if (!product) return null;
  const cat = (Array.isArray(categories) ? categories : [])
    .find((c) => c && c.id === product.category_id);
  return (cat && cat.slug) || null;
}

export function shouldSuggestSideDish(product, categories) {
  return categorySlugOf(product, categories) === 'lanches';
}

export function listSideDishes(products, categories) {
  const acc = new Set(
    (Array.isArray(categories) ? categories : [])
      .filter((c) => c && c.slug === 'acompanhamentos')
      .map((c) => c.id),
  );
  if (acc.size === 0) return [];
  return (Array.isArray(products) ? products : [])
    .filter((p) => p && acc.has(p.category_id));
}

// Oferta completa: acompanhamentos + bebidas (sem inventar nada: só
// reordena e filtra o que já veio do storefront).
export function listOfferItems(products, categories) {
  const acc = new Set(
    (Array.isArray(categories) ? categories : [])
      .filter((c) => c && OFFER_CATEGORY_SLUGS.includes(c.slug))
      .map((c) => c.id),
  );
  if (acc.size === 0) return [];
  return (Array.isArray(products) ? products : [])
    .filter((p) => p && acc.has(p.category_id));
}

function normName(v) {
  return String(v ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Prioriza batata frita e refrigerante quando cadastrados (só reordena;
// sem inventar produtos, preços ou descontos).
export function prioritizeOfferItems(items) {
  const score = (p) => {
    const n = normName(p?.name);
    if (n.includes('batata')) return 0;
    if (n.includes('refrigerante')) return 1;
    return 2;
  };
  return [...(Array.isArray(items) ? items : [])]
    .map((p, i) => ({ p, i }))
    .sort((a, b) => (score(a.p) - score(b.p)) || (a.i - b.i))
    .map((x) => x.p);
}

// Oculta das OFERTAS o candidato que ficaria inválido se adicionado
// (ex.: batata sem o lanche exigido). O cardápio completo não é filtrado.
// Um candidato que RESOLVE a pendência (ex.: o lanche) continua visível.
export function filterOfferByCart(candidates, cartItems, depRules, modes) {
  const base = Array.isArray(cartItems) ? cartItems : [];
  return (Array.isArray(candidates) ? candidates : []).filter((c) => {
    if (!c || !c.id) return false;
    const errs = checkCartDependencies(
      [...base, { product_id: c.id, quantity: 1 }],
      depRules,
      modes,
    );
    return !errs.some((e) => e && e.productId === c.id);
  });
}

// Tem personalização (modal faz sentido)? Mesmo critério dos selos do card.
export function productHasOptions(product) {
  const steps = Array.isArray(product?.config) ? product.config : product?.config?.steps;
  return (Array.isArray(steps) && steps.length > 0)
    || (Array.isArray(product?.complements) && product.complements.length > 0);
}
