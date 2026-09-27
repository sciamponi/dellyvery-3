/**
 * Atribuição automática do motoboy padrão na chegada do pedido.
 *
 * Regra (matriz):
 * - sem padrão / auto desligado → manual (null);
 * - pedido não-delivery → nunca (null);
 * - pedido já com driver → nunca sobrescreve (null);
 * - padrão inativo/inexistente → null;
 * - delivery + auto + padrão ativo (+ outros ativos ou não) → driver id.
 *
 * A UI decide pré-seleção/troca; aqui só a decisão pura.
 */

export function getAutoAssignDriverId({ order, settings, drivers }) {
  if (!order || order.order_type !== 'delivery') return null;
  if (order.driver_id) return null;
  const s = settings || {};
  if (!s.auto_assign_delivery || !s.default_driver_id) return null;
  const list = Array.isArray(drivers) ? drivers : [];
  const found = list.find((d) => d.id === s.default_driver_id);
  if (!found) return null;
  if ((found.status || 'ativo') !== 'ativo') return null;
  return found.id;
}

export function isDefaultDriver(driverId, settings) {
  return !!driverId && !!settings?.default_driver_id && driverId === settings.default_driver_id;
}
