// DELLVERY 3 — Operações puras da montagem V2 (testável, sem rede).
// Duplicar gera novo id no banco (createOption); aqui só montamos dados.
// Reordenar troca sort_order com o vizinho (updateOption aceita sort_order).

import { validateConfigOption } from './configEditor.js';

/**
 * Monta os dados da cópia de uma opção no MESMO grupo: novo nome com
 * "(cópia)", mesma origem (ingredient_id XOR product_id, sem levar outros
 * vínculos), preço oficial, inativa para revisão, ao final da ordem.
 * Retorna { data } ou { error } (validação do modelo).
 */
export function buildDuplicateOption(opt, siblings) {
  const o = opt || {};
  const maxSort = (siblings || []).reduce((m, s) => Math.max(m, Number(s?.sort_order) || 0), 0);
  const data = {
    step_id: o.step_id || null,
    ingredient_id: o.ingredient_id || null,
    product_id: o.product_id || null,
    name: `${o.name || 'Opção'} (cópia)`,
    description: o.description || '',
    price: Number(o.price) || 0,
    active: false,
    sort_order: maxSort + 1,
  };
  const error = validateConfigOption(data);
  if (error) return { error };
  return { data };
}

/**
 * Calcula a troca de sort_order com o vizinho (dir -1|+1).
 * Retorna [{ id, sort_order }, { id, sort_order }] ou null nos limites.
 */
export function neighborSwapTargets(siblings, index, dir) {
  const list = Array.isArray(siblings) ? siblings : [];
  const j = index + dir;
  if (index < 0 || j < 0 || j >= list.length) return null;
  const a = list[index];
  const b = list[j];
  if (!a?.id || !b?.id) return null;
  const sa = Number(a.sort_order) || 0;
  const sb = Number(b.sort_order) || 0;
  return [
    { id: a.id, sort_order: sb === sa ? sa + dir : sb },
    { id: b.id, sort_order: sa },
  ];
}
