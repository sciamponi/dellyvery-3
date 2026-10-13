// DELLVERY 3 — Nome da comanda (balcão/retirada), puro e testável.
// Persistência: snapshot próprio do pedido (orders.customer_data.name),
// SEMPRE com customer_id null — nenhum registro em customers é criado.
// Delivery e pedidos com cliente vinculado seguem o fluxo de cadastro
// (intocados): a comanda só existe para retirada sem cliente.
export const COMANDA_MAX_LEN = 40;

// Normaliza texto livre ("André", "João", "Mesa 3"). Vazio permitido
// (remover o nome volta o pedido a "Avulso").
export function normalizeComandaName(value) {
  return String(value ?? '').trim().slice(0, COMANDA_MAX_LEN);
}

// Comanda editável? Só retirada sem cliente vinculado. Delivery usa o
// cadastro; mesa já tem identidade própria (table_number).
export function isComandaEditable(order) {
  return order?.order_type === 'retirada' && !order?.customer_id;
}

// Nome atual da comanda ('' = sem nome). Nunca lê cadastro de clientes:
// só o snapshot do pedido.
export function resolveComandaName(order) {
  if (!isComandaEditable(order)) return '';
  const cd = order?.customer_data && typeof order.customer_data === 'object'
    ? order.customer_data
    : {};
  return normalizeComandaName(order?.customer_name || cd.name || '');
}

// Patch de persistência: preserva phone/email do snapshot; mexe SÓ em
// customer_data.name. customer_id fica como está (null) — sem upsert,
// sem insert em customers.
export function buildComandaPatch(currentCustomerData, name) {
  const cd = currentCustomerData && typeof currentCustomerData === 'object'
    ? currentCustomerData
    : {};
  return {
    ...cd,
    name: normalizeComandaName(name),
  };
}

// Decisão de impressão (cupom de cozinha):
// - retirada sem cliente + nome → { kind: 'named', name } ("COMANDA: X").
// - retirada sem cliente sem nome → { kind: 'avulso' } ("Avulso").
// - demais casos (delivery, mesa, com cliente) → null (layout atual).
export function ticketComanda(detail) {
  if (!detail || detail.order_type !== 'retirada' || detail.customer_id) return null;
  const name = normalizeComandaName(detail.customer_name || detail?.customer_data?.name || '');
  if (name) return { kind: 'named', name };
  return { kind: 'avulso' };
}
