import { base44 } from '@/api/base44Client';

/**
 * Fluxo centralizado de mudança de status de pedidos (frontend).
 *
 * Único ponto de entrada para alterar status pelo painel:
 * Kanban (drag-and-drop) e OrderModal (Aceitar/Avançar) passam por aqui.
 * O realtime apenas atualiza a UI — nunca dispara mudança de status.
 *
 * Efeitos colaterais externos (notificação persistente) acontecem no
 * backend (manageOrder), nunca na renderização.
 */

export const ORDER_STATUSES = [
  'novo',
  'confirmado',
  'em_preparo',
  'aguardando_retirada',
  'saiu_entrega',
  'finalizado',
  'cancelado',
];

export const STATUS_LABELS = {
  novo: 'Novo',
  confirmado: 'Confirmado',
  em_preparo: 'Em preparo',
  aguardando_retirada: 'Pronto',
  saiu_entrega: 'Saiu p/ entrega',
  finalizado: 'Finalizado',
  cancelado: 'Cancelado',
};

export const TERMINAL_STATUSES = ['finalizado', 'cancelado'];

export function isTerminalStatus(status) {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * Próximo status no fluxo. Respeita o tipo de pedido:
 * delivery pula "aguardando_retirada" e vai para "saiu_entrega".
 * Retorna null quando não há próxima etapa.
 */
export function getNextStatus(order) {
  if (!order) return null;
  switch (order.status) {
    case 'novo':
      return 'confirmado';
    case 'confirmado':
      return 'em_preparo';
    case 'em_preparo':
      return order.order_type === 'delivery' ? 'saiu_entrega' : 'aguardando_retirada';
    case 'aguardando_retirada':
    case 'saiu_entrega':
      return 'finalizado';
    default:
      return null;
  }
}

/**
 * Ações disponíveis no modal conforme o status atual.
 * Retorna [{ id: 'accept' | 'advance' | 'cancel', label, next? }]
 */
export function getAvailableActions(order) {
  if (!order || isTerminalStatus(order.status)) return [];
  const actions = [];
  const next = getNextStatus(order);
  if (order.status === 'novo') {
    actions.push({ id: 'accept', label: 'Aceitar pedido', next: 'confirmado' });
  } else if (next) {
    actions.push({ id: 'advance', label: `Avançar para ${STATUS_LABELS[next]}`, next });
  }
  actions.push({ id: 'cancel', label: 'Cancelar pedido' });
  return actions;
}

/**
 * Altera o status via backend. Lança erro com a mensagem do servidor
 * quando a operação falha. Não altera nada quando o status é igual
 * (o backend retorna o pedido sem criar histórico/notificação).
 */
export async function changeOrderStatus(orderId, newStatus) {
  const res = await base44.functions.invoke('manageOrder', {
    action: 'status',
    order_id: orderId,
    status: newStatus,
  });
  if (res.data?.error) {
    throw new Error(res.data.error);
  }
  return res.data.order;
}

/** Mensagem amigável ao cliente para cada status (pt-BR). */
export function getCustomerStatusMessage(orderNumber, status) {
  const tag = `pedido #${orderNumber ?? '—'}`;
  switch (status) {
    case 'confirmado':
      return `Seu ${tag} foi confirmado pelo restaurante.`;
    case 'em_preparo':
      return `Seu ${tag} está sendo preparado.`;
    case 'aguardando_retirada':
      return `Seu ${tag} está pronto para retirada.`;
    case 'saiu_entrega':
      return `Seu ${tag} saiu para entrega.`;
    case 'finalizado':
      return `Seu ${tag} foi finalizado. Obrigado!`;
    case 'cancelado':
      return `Seu ${tag} foi cancelado.`;
    default:
      return `Seu ${tag} foi atualizado.`;
  }
}

/** Link público de acompanhamento do pedido (reutiliza /acompanhar/:token). */
export function buildTrackingLink(trackingToken) {
  if (!trackingToken) return '';
  const base = typeof window !== 'undefined' ? window.location.origin : '';
  return `${base}/acompanhar/${trackingToken}`;
}
