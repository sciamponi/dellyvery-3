import { supabase as defaultClient } from './supabaseClient.js';

// DELLVERY 3 — Adapter Supabase Orders (FASE 5.4 ETAPA B4)
// Escrita SEMPRE via RPCs server-side (preços/totais nunca do frontend).
// Leitura direta só autenticada (RLS por membership); tracking público via RPC.
// Mapeamentos Base44 <-> Supabase (auditoria validada):
//   created_date <-> created_at | customer_* planos <-> customer_data/delivery_address
//   items[] <-> order_items | status_history[] <-> order_status_history
//   delivery_zone (string) <-> delivery_zone_id | table_number/cancel_reason (B1)

const withClient = (client) => client || defaultClient;

function mustBeConfigured(client) {
  const c = withClient(client);
  if (!c) throw new Error('Supabase não configurado (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)');
  return c;
}

function requireCompanyId(companyId) {
  if (!companyId) throw new Error('Empresa atual não definida');
  return companyId;
}

function rpcError(error) {
  const msg = error?.message || 'Erro na operação';
  throw new Error(msg);
}

// ---------- Mapeamento ----------

export function fromSupabaseOrder(row) {
  if (!row) return row;
  const cd = row.customer_data && typeof row.customer_data === 'object' ? row.customer_data : {};
  const da = row.delivery_address && typeof row.delivery_address === 'object' ? row.delivery_address : {};
  return {
    id: row.id,
    company_id: row.company_id,
    order_number: row.order_number,
    tracking_token: row.tracking_token,
    customer_id: row.customer_id,
    delivery_zone_id: row.delivery_zone_id,
    driver_id: row.driver_id,
    order_type: row.order_type,
    table_number: row.table_number || '',
    status: row.status,
    payment_method: row.payment_method || '',
    payment_status: row.payment_status,
    subtotal: Number(row.subtotal) || 0,
    delivery_fee: Number(row.delivery_fee) || 0,
    discount: Number(row.discount) || 0,
    total: Number(row.total) || 0,
    change_for: row.change_for == null || row.change_for === '' ? null : Number(row.change_for),
    customer_data: cd,
    customer_name: cd.name || '',
    customer_phone: cd.phone || '',
    customer_email: cd.email || '',
    delivery_address: da,
    customer_address: da.street || '',
    customer_number: da.number || '',
    customer_complement: da.complement || '',
    customer_neighborhood: da.neighborhood || '',
    customer_city: da.city || '',
    customer_zip_code: da.zip_code || '',
    notes: row.notes || '',
    source: row.source,
    cancel_reason: row.cancel_reason || '',
    created_date: row.created_at,
    items: [],
    status_history: [],
  };
}

export function fromSupabaseOrderItem(row) {
  if (!row) return row;
  return {
    id: row.id,
    product_id: row.product_id,
    name: row.product_name,
    product_name: row.product_name,
    quantity: row.quantity,
    unit_price: Number(row.unit_price) || 0,
    price: Number(row.total) || 0,
    total: Number(row.total) || 0,
    complements: Array.isArray(row.options) ? row.options : [],
    options: Array.isArray(row.options) ? row.options : [],
    notes: row.notes || '',
  };
}

export function fromSupabaseHistory(row) {
  if (!row) return row;
  return {
    status: row.new_status,
    new_status: row.new_status,
    old_status: row.old_status,
    timestamp: row.created_at,
    created_at: row.created_at,
  };
}

// ---------- Leitura (autenticada, RLS) ----------

export async function listOrders(client, companyId, limit = 100) {
  const c = mustBeConfigured(client);
  const { data, error } = await c
    .from('orders')
    .select('*')
    .eq('company_id', requireCompanyId(companyId))
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) rpcError(error);
  return (data || []).map(fromSupabaseOrder);
}

export async function getOrder(client, companyId, orderId) {
  const c = mustBeConfigured(client);
  const { data, error } = await c
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .eq('company_id', requireCompanyId(companyId))
    .maybeSingle();
  if (error) rpcError(error);
  if (!data) return null;
  return fromSupabaseOrder(data);
}

export async function getOrderDetail(client, companyId, orderId) {
  const order = await getOrder(client, companyId, orderId);
  if (!order) return null;
  const c = mustBeConfigured(client);
  const [{ data: items, error: itemsErr }, { data: history, error: histErr }] = await Promise.all([
    c.from('order_items').select('*').eq('order_id', orderId).order('created_at', { ascending: true }),
    c.from('order_status_history').select('*').eq('order_id', orderId).order('created_at', { ascending: true }),
  ]);
  if (itemsErr) rpcError(itemsErr);
  if (histErr) rpcError(histErr);
  return {
    ...order,
    items: (items || []).map(fromSupabaseOrderItem),
    status_history: (history || []).map(fromSupabaseHistory),
  };
}

// Lista com itens + histórico anexados (Kanban/modal precisam sem N+1).
export async function listOrdersWithItems(client, companyId, limit = 100) {
  const orders = await listOrders(client, companyId, limit);
  if (orders.length === 0) return orders;
  const c = mustBeConfigured(client);
  const ids = orders.map((o) => o.id);
  const [{ data: items, error: itemsErr }, { data: history, error: histErr }] = await Promise.all([
    c.from('order_items').select('*').in('order_id', ids).order('created_at', { ascending: true }),
    c.from('order_status_history').select('*').in('order_id', ids).order('created_at', { ascending: true }),
  ]);
  if (itemsErr) rpcError(itemsErr);
  if (histErr) rpcError(histErr);
  const itemsBy = {};
  (items || []).forEach((i) => {
    (itemsBy[i.order_id] = itemsBy[i.order_id] || []).push(fromSupabaseOrderItem(i));
  });
  const histBy = {};
  (history || []).forEach((h) => {
    (histBy[h.order_id] = histBy[h.order_id] || []).push(fromSupabaseHistory(h));
  });
  return orders.map((o) => ({ ...o, items: itemsBy[o.id] || [], status_history: histBy[o.id] || [] }));
}

// ---------- Escrita via RPC ----------

// Mapeamento puro carrinho → payload da RPC (preserva quantidade,
// complementos, observações e ids de TODAS as linhas; sem totais do cliente).
// Mesma função usada pelo Checkout público e pelo PDV: o que o backend
// valida e persiste é exatamente o que estava no carrinho.
export function buildCreateOrderItems(cartItems) {
  return (cartItems || []).map((i) => ({
    product_id: i.product_id,
    quantity: i.quantity,
    complements: i.complements || [],
    notes: i.notes || '',
  }));
}

export async function createOrder(client, {
  companySlug, orderType = 'delivery', tableNumber = '', items = [],
  customer = {}, deliveryZoneId = null, paymentMethod = '', notes = '',
  source = 'online', changeFor = null,
}) {
  const c = mustBeConfigured(client);
  if (!companySlug) throw new Error('Empresa não identificada');
  const { data, error } = await c.rpc('create_order', {
    p_company_slug: companySlug,
    p_order_type: orderType,
    p_table_number: tableNumber || null,
    p_items: buildCreateOrderItems(items),
    p_customer: {
      name: customer.name || '',
      phone: customer.phone || '',
      email: customer.email || '',
      address: customer.address || '',
      number: customer.number || '',
      complement: customer.complement || '',
      neighborhood: customer.neighborhood || '',
      city: customer.city || '',
      zip_code: customer.zip_code || '',
    },
    p_delivery_zone_id: deliveryZoneId || null,
    p_payment_method: paymentMethod || null,
    p_notes: notes || null,
    // FASE 2: origem do pedido. 'balcao' (PDV interno) nunca é bloqueado
    // por is_open no banco; 'online'/'whatsapp' são. Default = online.
    p_source: source || 'online',
    // Operação: troco (opcional; servidor valida > 0 e >= total).
    p_change_for: changeFor == null || changeFor === '' ? null : Number(changeFor),
  });
  if (error) rpcError(error);
  return data; // { order_id, order_number, tracking_token }
}

// FASE 2: erro controlado da RPC quando a loja está fechada (online).
// Usado para mensagens amigáveis (ex.: race condition no Checkout).
export function isRestaurantClosedError(error) {
  const msg = error?.message || String(error || '');
  return /fechad/i.test(msg);
}

export async function changeOrderStatus(client, orderId, newStatus) {
  const c = mustBeConfigured(client);
  const { data, error } = await c.rpc('manage_order', {
    p_order_id: orderId, p_action: 'status', p_status: newStatus,
  });
  if (error) rpcError(error);
  return fromSupabaseOrder(data);
}

export async function cancelOrder(client, orderId, cancelReason) {
  const c = mustBeConfigured(client);
  if (!cancelReason?.trim()) throw new Error('Motivo do cancelamento é obrigatório');
  const { data, error } = await c.rpc('manage_order', {
    p_order_id: orderId, p_action: 'cancel', p_cancel_reason: cancelReason,
  });
  if (error) rpcError(error);
  return fromSupabaseOrder(data);
}

export async function editOrder(client, orderId, { items, discount, address, notes }) {
  const c = mustBeConfigured(client);
  const { data, error } = await c.rpc('manage_order', {
    p_order_id: orderId,
    p_action: 'edit',
    p_items: items !== undefined
      ? items.map((i) => ({
        product_id: i.product_id,
        quantity: i.quantity,
        complements: i.complements || [],
        notes: i.notes || '',
      }))
      : null,
    p_discount: discount !== undefined ? Number(discount) : null,
    p_address: address !== undefined ? address : null,
    p_notes: notes !== undefined ? notes : null,
  });
  if (error) rpcError(error);
  return fromSupabaseOrder(data);
}

// ---------- Atribuição de entregador (FASE 5.5-B3) ----------
// Sem migration/RPC nova: UPDATE direto (RLS membros) + trigger
// trg_orders_company_refs como segunda barreira. Valida tudo no adapter
// antes: mesma empresa, entregador ativo, pedido não-terminal.
// Gera history (old=new=status atual; oculto na timeline por
// collapseConsecutiveStatuses) + audit. NÃO gera notification ao cliente.
const TERMINAL_FOR_ASSIGN = ['finalizado', 'cancelado'];

export async function assignDriver(client, orderId, companyId, driverId) {
  const c = mustBeConfigured(client);
  const cid = requireCompanyId(companyId);
  const { data: order, error: ordErr } = await c
    .from('orders')
    .select('id,company_id,status')
    .eq('id', orderId)
    .eq('company_id', cid)
    .maybeSingle();
  if (ordErr) rpcError(ordErr);
  if (!order) throw new Error('Pedido não encontrado ou sem permissão');
  if (TERMINAL_FOR_ASSIGN.includes(order.status)) {
    throw new Error('Pedido finalizado/cancelado não pode receber entregador');
  }
  if (driverId) {
    const { data: drv, error: drvErr } = await c
      .from('delivery_drivers')
      .select('id,company_id,status,name')
      .eq('id', driverId)
      .maybeSingle();
    if (drvErr) rpcError(drvErr);
    if (!drv || drv.company_id !== cid) throw new Error('Entregador pertence a outra empresa');
    if (drv.status !== 'ativo') throw new Error('Entregador inativo');
  }
  const { error: updErr } = await c.from('orders').update({ driver_id: driverId || null }).eq('id', orderId);
  if (updErr) rpcError(updErr);
  // history + audit (best-effort; nunca notification ao cliente)
  try {
    const { data: sess } = await c.auth.getSession();
    const uid = sess?.session?.user?.id || null;
    const label = driverId ? `Entregador atribuído` : `Entregador removido`;
    await c.from('order_status_history').insert({
      order_id: orderId, old_status: order.status, new_status: order.status,
      changed_by: uid, notes: label,
    });
    await c.from('audit_logs').insert({
      company_id: cid, user_id: uid, action: 'assign_driver',
      entity: 'order', entity_id: orderId,
      metadata: { driver_id: driverId || null, detail: label },
    });
  } catch {
    // registro auxiliar nunca bloqueia a atribuição
  }
  return true;
}

// ---------- Tracking público (anon via RPC; nunca SELECT direto) ----------

export async function getOrderByToken(client, trackingToken) {
  const c = mustBeConfigured(client);
  if (!trackingToken) throw new Error('Token não fornecido');
  const { data, error } = await c.rpc('get_order_by_token', { p_token: trackingToken });
  if (error) rpcError(error);
  return data;
}

// ---------- Notifications (painel autenticado) ----------

export async function listNotifications(client, companyId, limit = 30) {
  const c = mustBeConfigured(client);
  const { data, error } = await c
    .from('notifications')
    .select('*')
    .eq('company_id', requireCompanyId(companyId))
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) rpcError(error);
  return (data || []).map((n) => ({
    ...n,
    // title derivado (sem coluna duplicada): igual ao gerado nas RPCs
    title: n.status === 'novo'
      ? `Novo pedido #${n.order_number ?? '—'}`
      : `Pedido #${n.order_number ?? '—'}`,
    created_date: n.created_at,
  }));
}

export async function markNotificationRead(client, notificationId) {
  const c = mustBeConfigured(client);
  const { error } = await c.from('notifications').update({ read: true }).eq('id', notificationId);
  if (error) rpcError(error);
}

export async function listNovoNotifications(client, orderId) {
  const c = mustBeConfigured(client);
  const { data, error } = await c
    .from('notifications')
    .select('*')
    .eq('order_id', orderId)
    .eq('status', 'novo');
  if (error) rpcError(error);
  return data || [];
}

// ---------- Realtime (postgres_changes filtrado por empresa) ----------

// QA realtime duplicado: supabase-js devolve a MESMA instância de channel
// para o mesmo tópico. Chamar .on('postgres_changes') duas vezes na mesma
// instância lança "cannot add 'postgres_changes' callbacks" e quebra a árvore
// React (ex.: dois NotificationBell montados + re-run do useEffect quando
// sbActive vira true). Registro idempotente por tópico com refcount:
// um único binding ventila para N listeners; cleanup remove o channel
// somente quando o último listener sai. Sem try/catch mascarando erro.
const channelRegistry = new Map();

export function subscribeCompanyTable(client, table, companyId, onEvent) {
  const c = mustBeConfigured(client);
  if (!companyId) throw new Error('Empresa atual não definida');
  const topic = `dellyvery3-${table}-${companyId}`;
  let entry = channelRegistry.get(topic);
  if (!entry) {
    const listeners = new Set();
    const channel = c
      .channel(topic)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `company_id=eq.${companyId}` },
        (payload) => {
          // postgres_changes entrega INSERT/UPDATE/DELETE; o frontend usa o
          // vocabulário create/update/delete (igual ao subscribe Base44).
          const raw = (payload.eventType || '').toLowerCase();
          const event = {
            type: raw === 'insert' ? 'create' : raw,
            data: payload.new || {},
            id: payload.new?.id || payload.old?.id,
          };
          listeners.forEach((fn) => fn(event));
        },
      )
      .subscribe();
    entry = { channel, listeners, client: c };
    channelRegistry.set(topic, entry);
  }
  entry.listeners.add(onEvent);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const current = channelRegistry.get(topic);
    if (!current) return;
    current.listeners.delete(onEvent);
    if (current.listeners.size === 0) {
      channelRegistry.delete(topic);
      current.client.removeChannel(current.channel);
    }
  };
}

// Exportado para testes: quantos tópicos ativos existem.
export function __activeChannelCount() {
  return channelRegistry.size;
}
