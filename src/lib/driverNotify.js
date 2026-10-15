// DELLVERY 3 — Quando notificar o entregador (puro, testável).
// Dispara SOMENTE na transição para 'saiu_entrega' de pedido delivery.
// Retirada/mesa nunca disparam. Sem entregador atribuído, não há envio
// (o chamador registra o motivo em vez disso). Repetir a transição não
// re-dispara: o registro é get-or-create por pedido+entregador.

export const DISPATCH_STATUS = 'saiu_entrega';

// Elegível a aviso: delivery rumo a saiu_entrega COM entregador.
// Retorna false para qualquer outro caso (sem exceção).
export function shouldQueueDriverNotify(order, newStatus) {
  if (!order || newStatus !== DISPATCH_STATUS) return false;
  if (order.order_type !== 'delivery') return false;
  if (!order.driver_id) return false;
  return true;
}

// Motivo registrado quando NÃO há para quem enviar (auditoria, sem envio).
// Retorna null quando há destinatário (fluxo normal segue).
export function missingDriverReason(order, newStatus) {
  if (!order || newStatus !== DISPATCH_STATUS) return null;
  if (order.order_type !== 'delivery') return null;
  if (order.driver_id) return null;
  return 'Sem entregador atribuído na saída para entrega';
}
