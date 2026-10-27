// DELLVERY 3 — Regras puras da saída para entrega e da baixa (testável).
// Sem rede, sem transição: só decide O QUE exigir e COMO validar.
// Atribuição financeira NÃO é automática aqui: o repasse continua sendo
// o fechamento manual (delivery_fee por pedido finalizado); a conclusão
// registra o responsável via audit_logs/history da transição (manage_order).

/** Saída exige modal de confirmação? Só delivery rumo a saiu_entrega. */
export function shouldConfirmDispatch(order, next) {
  if (!order || order.order_type !== 'delivery' || next !== 'saiu_entrega') return false;
  if (order.status === 'finalizado' || order.status === 'cancelado') return false;
  return true;
}

// Baixa exige conferência? Só delivery vindo de saiu_entrega rumo a
// finalizado. Retirada/mesa nunca exigem entregador (mesmo que um pedido
// antigo esteja em saiu_entrega); terminais não reabrem a conferência.
export function shouldConferenceConclusion(order, next) {
  if (!order || next !== 'finalizado') return false;
  if (order.order_type !== 'delivery') return false;
  if (order.status === 'finalizado' || order.status === 'cancelado') return false;
  return order.status === 'saiu_entrega';
}

/** Confirmação da saída: sem entregador válido não avança. */
export function validateDispatchConfirm({ driverId }) {
  if (!driverId) {
    return { ok: false, reason: 'Selecione um entregador para confirmar a saída' };
  }
  return { ok: true, reason: '' };
}

/** Baixa: resolve o responsável (selecionado ou o já vinculado). */
export function resolveConclusionDriver({ orderDriverId, selectedDriverId }) {
  const driverId = selectedDriverId || orderDriverId || null;
  if (!driverId) return { driverId: null, changed: false, ok: false };
  return { driverId, changed: !!selectedDriverId && selectedDriverId !== orderDriverId, ok: true };
}
