// DELLVERY 3 — Regras puras dos modais de fila do Dashboard (testável).
// Espelha 1:1 a seleção de lista/título por kind; o componente só renderiza.

export function getDashboardModal(queueModal, parts) {
  const p = parts || {};
  switch (queueModal) {
    case 'atraso':
      return { title: 'Pedidos em atraso', orders: p.delayed || [] };
    case 'novos':
      return { title: 'Novos pedidos aguardando', orders: p.novos || [] };
    case 'hoje':
      return { title: 'Pedidos de hoje', orders: p.ordersToday || [] };
    case 'andamento':
      return { title: 'Em andamento', orders: p.inProgress || [] };
    case 'finalizados':
      return { title: 'Finalizados', orders: p.finished || [] };
    case 'cancelados':
      return { title: 'Cancelados', orders: p.canceled || [] };
    case 'finDelivery':
      return { title: 'Entregas finalizadas', orders: p.finDeliveryFiltered || [] };
    case 'finRetirada':
      return { title: 'Retiradas finalizadas', orders: p.finRetirada || [] };
    case 'finMesa':
      return { title: 'Mesas finalizadas', orders: p.finMesa || [] };
    default:
      return { title: 'Pedidos na fila', orders: p.inQueue || [] };
  }
}

// Destaque de alerta: só o card "Novos pedidos", só com novo aguardando.
export function isNovosAlertCard(hasNovo, label) {
  return !!hasNovo && label === 'Novos pedidos';
}

// Filtro do card/modal: aguardando aceitação (sem tocar em status).
export function filterNovosOrders(orders) {
  return (orders || []).filter(o => o?.status === 'novo');
}
