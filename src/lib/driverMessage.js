// DELLVERY 3 — Mensagem de entrega ao entregador (pura, sem rede).
// Usa SOMENTE dados reais persistidos no pedido. Nunca inventa endereço,
// valor, entregador ou pagamento. Envio é manual via wa.me (sem integração
// automática validada no projeto — ver u17 em breve).

export function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

// Telefone do entregador para wa.me: 10/11 dígitos ganham DDI 55;
// com DDI (12/13 iniciando com 55), preserva. Mesmo padrão do leads.
export function toDriverWaNumber(phone) {
  const d = onlyDigits(phone);
  if (d.length === 10 || d.length === 11) return `55${d}`;
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return d;
  return '';
}

export function formatAddressLines(order) {
  const da = order?.delivery_address && typeof order.delivery_address === 'object'
    ? order.delivery_address : {};
  const street = [da.street, da.number].filter(Boolean).join(', ');
  const rest = [da.complement, da.neighborhood, da.city, da.zip_code].filter(Boolean).join(' • ');
  return { street, rest };
}

export function formatOrderItems(order) {
  return (order?.items || []).map((i) => {
    const name = i?.name || i?.product_name || 'Item';
    const qty = i?.quantity || 1;
    let line = `${qty}x ${name}`;
    const comps = i?.complements || i?.options || [];
    if (Array.isArray(comps) && comps.length > 0) {
      const parts = comps.map((c) => c?.option_name || c?.name).filter(Boolean);
      if (parts.length > 0) line += ` (${parts.join(', ')})`;
    }
    const notes = String(i?.notes || '').trim();
    if (notes) line += ` [${notes}]`;
    return line;
  });
}

const fmtCurrency = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);

// Monta a mensagem de entrega a partir do pedido persistido + entregador.
// Retorna { to, text }: telefone do entregador (só dígitos) e texto pronto.
export function buildDriverDeliveryMessage(order, driver) {
  if (!order?.id && !order?.order_number) throw new Error('Pedido não identificado');
  const to = toDriverWaNumber(driver?.phone);
  if (!to) throw new Error('Entregador sem telefone válido');
  const { street, rest } = formatAddressLines(order);
  const lines = [
    `🚚 NOVA ENTREGA — Pedido #${order.order_number ?? '—'}`,
    '',
    `Cliente: ${order.customer_name || '—'}`,
    `Telefone: ${order.customer_phone || '—'}`,
    `Endereço: ${street || '—'}`,
  ];
  if (rest) lines.push(`Referência: ${rest}`);
  lines.push('', 'PEDIDO:');
  const items = formatOrderItems(order);
  lines.push(...(items.length > 0 ? items : ['(sem itens)']));
  if (order.notes) lines.push('', `Observações: ${order.notes}`);
  lines.push(`Total: ${fmtCurrency(order.total)}`);
  if (order.delivery_fee > 0) lines.push(`Taxa de entrega: ${fmtCurrency(order.delivery_fee)}`);
  if (order.payment_method) lines.push(`Pagamento: ${order.payment_method}`);
  if (order.change_for != null) lines.push(`Troco para: ${fmtCurrency(order.change_for)}`);
  lines.push('', 'Confirme o recebimento deste pedido e avise a operação em caso de qualquer dificuldade.');
  return { to, text: lines.join('\n') };
}

export function buildDriverDeliveryUrl(order, driver) {
  const { to, text } = buildDriverDeliveryMessage(order, driver);
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
}
