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

function finiteNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Pagamento em dinheiro? Só então o troco se aplica.
export function isCashPayment(paymentMethod) {
  return /dinheiro/i.test(String(paymentMethod || ''));
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
//
// Minimização de PII (20261029): o texto leva só o necessário à entrega —
// primeiro nome, telefone operacional (contato na chegada), rua/número/
// bairro, itens (sem notas internas de produção), valores e observações
// de entrega. Complemento/cidade/CEP/e-mail NÃO entram no link wa.me
// (ficam no painel). Mapa somente com coordenadas explícitas válidas:
// busca textual pode apontar para o endereço errado.
export function firstName(full) {
  return String(full || '').trim().split(/\s+/)[0] || '';
}

function formatDriverAddress(order) {
  const da = order?.delivery_address && typeof order.delivery_address === 'object'
    ? order.delivery_address : {};
  return {
    street: [da.street, da.number].filter(Boolean).join(', '),
    hood: da.neighborhood || '',
  };
}

function formatDriverItems(order) {
  return (order?.items || []).map((i) => {
    const name = i?.name || i?.product_name || 'Item';
    const qty = i?.quantity || 1;
    let line = `${qty}x ${name}`;
    const comps = i?.complements || i?.options || [];
    if (Array.isArray(comps) && comps.length > 0) {
      const parts = comps.map((c) => c?.option_name || c?.name).filter(Boolean);
      if (parts.length > 0) line += ` (${parts.join(', ')})`;
    }
    return line;
  });
}

function coordsOf(order) {
  const lat = finiteNum(order?.lat ?? order?.latitude);
  const lng = finiteNum(order?.lng ?? order?.longitude ?? order?.lon);
  if (lat === null || lng === null) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null;
  return { lat, lng };
}

export function buildDriverMapsLink(order) {
  const c = coordsOf(order);
  if (!c) return '';
  return `https://www.google.com/maps/search/?api=1&query=${c.lat},${c.lng}`;
}

export function buildDriverDeliveryMessage(order, driver) {
  if (!order?.id && !order?.order_number) throw new Error('Pedido não identificado');
  const to = toDriverWaNumber(driver?.phone);
  if (!to) throw new Error('Entregador sem telefone válido');
  const { street, hood } = formatDriverAddress(order);
  const lines = [
    `🚚 NOVA ENTREGA — Pedido #${order.order_number ?? '—'}`,
    '',
    `Cliente: ${firstName(order.customer_name) || '—'}`,
    `Telefone: ${order.customer_phone || '—'}`,
    `Endereço: ${street || '—'}`,
  ];
  if (hood) lines.push(`Bairro: ${hood}`);
  const mapsUrl = buildDriverMapsLink(order);
  if (mapsUrl) lines.push(`Mapa: ${mapsUrl}`);
  lines.push('', 'PEDIDO:');
  const items = formatDriverItems(order);
  lines.push(...(items.length > 0 ? items : ['(sem itens)']));
  if (order.notes) lines.push('', `Observações: ${order.notes}`);
  lines.push(`Total: ${fmtCurrency(order.total)}`);
  if (order.delivery_fee > 0) lines.push(`Taxa de entrega: ${fmtCurrency(order.delivery_fee)}`);
  if (order.payment_method) lines.push(`Pagamento: ${order.payment_method}`);
  // Troco só para dinheiro com valor solicitado (Pix/cartão nunca mostram).
  if (isCashPayment(order.payment_method) && order.change_for != null) {
    lines.push(`Troco para: ${fmtCurrency(order.change_for)}`);
    const change = Number(order.change_for) - Number(order.total || 0);
    if (Number.isFinite(change)) lines.push(`Troco calculado: ${fmtCurrency(change)}`);
  }
  lines.push('', 'Confirme o recebimento deste pedido e avise a operação em caso de qualquer dificuldade.');
  return { to, text: lines.join('\n') };
}

export function buildDriverDeliveryUrl(order, driver) {
  const { to, text } = buildDriverDeliveryMessage(order, driver);
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
}
