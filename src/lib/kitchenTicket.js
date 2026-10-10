// DELLVERY 3 — Dados do cupom de cozinha e etiqueta de pacote (puro, sem DOM).
// Fonte única para impressão: o pedido PERSISTIDO (getOrderDetail). Reimprimir
// é recarregar pelo mesmo id — nunca cria outro pedido.

export const TICKET_TYPE_LABELS = {
  mesa: 'Mesa/Comanda',
  retirada: 'Retirada (Balcão)',
  delivery: 'Entrega',
};

export function ticketTypeLabel(orderType) {
  return TICKET_TYPE_LABELS[orderType] || orderType || '—';
}

function complementNames(item) {
  const comps = item?.complements || item?.options || [];
  if (!Array.isArray(comps)) return [];
  return comps.map((c) => c?.option_name || c?.name).filter(Boolean);
}

function addressLine(order) {
  const da = order?.delivery_address && typeof order.delivery_address === 'object'
    ? order.delivery_address : {};
  return [da.street, da.number, da.complement, da.neighborhood, da.city, da.zip_code]
    .filter(Boolean).join(' • ');
}

// Cupom de produção: prioriza legibilidade (itens, complementos, obs.).
// Financeiro vai em seção separada ao final (a cozinha pode ignorá-la).
export function buildKitchenTicket(detail, company) {
  if (!detail?.id && detail?.order_number == null) throw new Error('Pedido não identificado');
  return {
    companyName: company?.name || detail?.company_name || 'Estabelecimento',
    orderNumber: detail.order_number,
    createdAt: detail.created_date || detail.created_at || null,
    typeLabel: ticketTypeLabel(detail.order_type),
    table: detail.table_number || '',
    customerName: detail.customer_name || '',
    customerPhone: detail.customer_phone || '',
    items: (detail.items || []).map((i) => ({
      quantity: i?.quantity || 1,
      name: i?.name || i?.product_name || 'Item',
      complements: complementNames(i),
      notes: String(i?.notes || '').trim(),
    })),
    orderNotes: String(detail.notes || '').trim(),
    address: detail.order_type === 'delivery' ? addressLine(detail) : '',
    payment: detail.payment_method || '',
    changeFor: detail.change_for ?? null,
    totals: {
      subtotal: detail.subtotal || 0,
      deliveryFee: detail.delivery_fee || 0,
      discount: detail.discount || 0,
      total: detail.total || 0,
    },
    status: detail.status || '',
  };
}

// Etiqueta de identificação do pacote (entrega): pedido + destino + resumo.
export function buildPackageLabel(detail) {
  if (!detail?.id && detail?.order_number == null) throw new Error('Pedido não identificado');
  return {
    orderNumber: detail.order_number,
    customer: detail.customer_name || '—',
    phone: detail.customer_phone || '—',
    address: addressLine(detail) || '—',
    itemsSummary: (detail.items || []).map((i) => `${i?.quantity || 1}x ${i?.name || i?.product_name || 'Item'}`),
    total: detail.total || 0,
    payment: detail.payment_method || '',
  };
}
