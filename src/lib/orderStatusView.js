// DELLVERY 3 — Selo operacional do pedido (puro, testável).
// Fonte única de rótulo/cor por status (Kanban, Mesas, modal usam a mesma).
// Operacional (Novo…Concluído) — nunca confundir com o financeiro
// (paymentBadge.js). Status desconhecido => cinza com o próprio código.

import { STATUS_LABELS } from './orderStatusFlow.js';

const PILL_CLASSES = {
  novo: 'bg-blue-100 text-blue-700',
  confirmado: 'bg-yellow-100 text-yellow-700',
  em_preparo: 'bg-orange-100 text-orange-700',
  aguardando_retirada: 'bg-purple-100 text-purple-700',
  saiu_entrega: 'bg-indigo-100 text-indigo-700',
  finalizado: 'bg-green-100 text-green-700',
  cancelado: 'bg-red-100 text-red-700',
};

export function orderStatusView(status) {
  const key = status || '';
  return {
    key,
    label: STATUS_LABELS[key] || key || '—',
    className: PILL_CLASSES[key] || 'bg-muted text-muted-foreground',
  };
}

/** Pedido em andamento? Exclui cancelado e finalizado. */
export function isOpenOrder(order) {
  const s = order?.status;
  return !!s && s !== 'cancelado' && s !== 'finalizado';
}
