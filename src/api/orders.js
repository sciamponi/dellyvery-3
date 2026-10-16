import { supabase as defaultClient } from './supabaseClient.js';
import { buildComandaPatch, normalizeComandaName } from '../lib/comanda.js';

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
    table_id: row.table_id || null,
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
// V2 (Gate 2): item com config {steps:[{step_id, items:[{option_id,
// quantity}]}]} segue junto; o servidor valida contra product_config_* e
// precifica com valores oficiais. Sem config => legado intacto.
export function sanitizeV2Config(config) {
  if (!config || typeof config !== 'object') return undefined;
  const steps = Array.isArray(config.steps) ? config.steps : [];
  const clean = steps
    .filter((s) => s && typeof s.step_id === 'string' && s.step_id)
    .map((s) => ({
      step_id: s.step_id,
      items: (Array.isArray(s.items) ? s.items : [])
        .filter((i) => i && typeof i.option_id === 'string' && i.option_id)
        .map((i) => ({ option_id: i.option_id, quantity: Math.max(1, Math.floor(Number(i.quantity) || 1)) })),
    }))
    .filter((s) => s.items.length > 0);
  if (clean.length === 0) return undefined;
  return { steps: clean };
}

export function buildCreateOrderItems(cartItems) {
  return (cartItems || []).map((i) => {
    const out = {
      product_id: i.product_id,
      quantity: i.quantity,
      complements: i.complements || [],
      notes: i.notes || '',
    };
    const config = sanitizeV2Config(i.config);
    if (config) out.config = config;
    return out;
  });
}

export async function createOrder(client, {
  companySlug, orderType = 'delivery', tableNumber = '', tableId = null, tableToken = null, items = [],
  customer = {}, deliveryZoneId = null, paymentMethod = '', notes = '',
  source = 'online', changeFor = null, latitude = null, longitude = null,
  discount = 0, idempotencyKey = null,
}) {
  const c = mustBeConfigured(client);
  if (!companySlug) throw new Error('Empresa não identificada');
  // Coordenadas (GPS/geocodificação, opcionais): o servidor resolve a zona
  // pelo polígono e recalcula a taxa — nunca confia em taxa do cliente.
  const lat = latitude === '' || latitude == null ? null : Number(latitude);
  const lng = longitude === '' || longitude == null ? null : Number(longitude);
  const { data, error } = await c.rpc('create_order', {
    p_company_slug: companySlug,
    p_order_type: orderType,
    p_table_number: tableNumber || null,
    p_table_id: tableId || null,
    // Fluxo público (QR): token validado no servidor; nunca table_id cru.
    p_table_token: tableToken || null,
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
    p_lat: lat,
    p_lng: lng,
    p_payment_method: paymentMethod || null,
    p_notes: notes || null,
    // FASE 2: origem do pedido. 'balcao' (PDV interno) nunca é bloqueado
    // por is_open no banco; 'online'/'whatsapp' são. Default = online.
    p_source: source || 'online',
    // Operação: troco (opcional; servidor valida > 0 e >= total).
    p_change_for: changeFor == null || changeFor === '' ? null : Number(changeFor),
    // Segurança (20261027): desconto atômico validado no servidor
    // (0 <= d <= subtotal) + chave de idempotência anti-duplicidade.
    p_discount: Number(discount) || 0,
    p_idempotency_key: idempotencyKey || null,
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
      ? items.map((i) => {
          const line = {
            product_id: i.product_id,
            quantity: i.quantity,
            complements: i.complements || [],
            notes: i.notes || '',
          };
          const config = sanitizeV2Config(i.config);
          if (config) line.config = config;
          return line;
        })
      : null,
    p_discount: discount !== undefined ? Number(discount) : null,
    p_address: address !== undefined ? address : null,
    p_notes: notes !== undefined ? notes : null,
  });
  if (error) rpcError(error);
  return fromSupabaseOrder(data);
}

// ---------- Histórico do cliente (selo primeiro pedido) ----------
// Conta pedidos anteriores do cliente na MESMA empresa, excluindo o pedido
// atual e excluindo cancelados (cancelado nunca concluiu negócio).
// Uma única consulta agregada (sem N+1): chamada só na chegada de pedido novo.
export async function countCustomerOrders(client, companyId, customerId, excludeOrderId = null) {
  const c = mustBeConfigured(client);
  const cid = requireCompanyId(companyId);
  if (!customerId) return 0;
  let q = c.from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', cid)
    .eq('customer_id', customerId)
    .neq('status', 'cancelado');
  if (excludeOrderId) q = q.neq('id', excludeOrderId);
  const { count, error } = await q;
  if (error) rpcError(error);
  return count || 0;
}

// Lote único para o selo (1 consulta para N pedidos, sem N+1):
// Map(customer_id => nº de pedidos não-cancelados). Inclui os próprios
// pedidos (o chamador subtrai 1 por pedido não-cancelado).
export async function countPriorOrders(client, companyId, customerIds) {
  const c = mustBeConfigured(client);
  const cid = requireCompanyId(companyId);
  const ids = [...new Set((Array.isArray(customerIds) ? customerIds : []).filter(Boolean))];
  const out = new Map();
  if (ids.length === 0) return out;
  const { data, error } = await c.from('orders')
    .select('id,customer_id')
    .eq('company_id', cid)
    .in('customer_id', ids)
    .neq('status', 'cancelado');
  if (error) rpcError(error);
  for (const row of data || []) {
    if (!row?.customer_id) continue;
    out.set(row.customer_id, (out.get(row.customer_id) || 0) + 1);
  }
  return out;
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
  const { error: updErr } = await c.from('orders').update({ driver_id: driverId || null }).eq('id', orderId).eq('company_id', cid);
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

// ---------- Vínculo de cliente/mesa em pedido de balcão ----------
async function logOrderLink(c, cid, order, action, label, metadata) {
  try {
    const { data: sess } = await c.auth.getSession();
    const uid = sess?.session?.user?.id || null;
    await c.from('order_status_history').insert({
      order_id: order.id, old_status: order.status, new_status: order.status,
      changed_by: uid, notes: label,
    });
    await c.from('audit_logs').insert({
      company_id: cid, user_id: uid, action,
      entity: 'order', entity_id: order.id, metadata,
    });
  } catch {
    // registro auxiliar nunca bloqueia o vínculo
  }
}

async function fetchOrderForLink(c, cid, orderId) {
  const { data: order, error: ordErr } = await c
    .from('orders')
    .select('id,company_id,status,order_type')
    .eq('id', orderId)
    .eq('company_id', cid)
    .maybeSingle();
  if (ordErr) rpcError(ordErr);
  if (!order) throw new Error('Pedido não encontrado ou sem permissão');
  if (TERMINAL_FOR_ASSIGN.includes(order.status)) {
    throw new Error('Pedido finalizado/cancelado não pode ser alterado');
  }
  return order;
}

// Vincula cliente existente ao pedido (sem recriar, sem mudar número/itens).
// Atualiza customer_id + snapshot customer_data (nome/telefone) para a UI
// refletir de imediato. Trigger trg_orders_company_refs é segunda barreira.
export async function linkOrderCustomer(client, orderId, companyId, customerId) {
  const c = mustBeConfigured(client);
  const cid = requireCompanyId(companyId);
  if (!customerId) throw new Error('Cliente não identificado');
  const order = await fetchOrderForLink(c, cid, orderId);
  const { data: cust, error: custErr } = await c
    .from('customers')
    .select('id,company_id,name,phone,email')
    .eq('id', customerId)
    .maybeSingle();
  if (custErr) rpcError(custErr);
  if (!cust || cust.company_id !== cid) throw new Error('Cliente pertence a outra empresa');
  const { error: updErr } = await c.from('orders').update({
    customer_id: cust.id,
    customer_data: { name: cust.name || '', phone: cust.phone || '', email: cust.email || '' },
  }).eq('id', orderId).eq('company_id', cid);
  if (updErr) rpcError(updErr);
  await logOrderLink(c, cid, order, 'link_customer', `Cliente vinculado: ${cust.name || 'sem nome'}`, {
    customer_id: cust.id,
  });
  return true;
}

// Vincula mesa válida (ativa, mesma empresa) a pedido de MESA.
// Não converte tipo: pedidos de entrega/retirada não aceitam mesa aqui.
export async function linkOrderTable(client, orderId, companyId, tableId) {
  const c = mustBeConfigured(client);
  const cid = requireCompanyId(companyId);
  if (!tableId) throw new Error('Mesa não identificada');
  const order = await fetchOrderForLink(c, cid, orderId);
  if (order.order_type !== 'mesa') {
    throw new Error('Somente pedidos de mesa aceitam vínculo de mesa');
  }
  const { data: table, error: tableErr } = await c
    .from('dining_tables')
    .select('id,company_id,name,active')
    .eq('id', tableId)
    .maybeSingle();
  if (tableErr) rpcError(tableErr);
  if (!table || table.company_id !== cid) throw new Error('Mesa pertence a outra empresa');
  if (table.active === false) throw new Error('Mesa inativa');
  const { error: updErr } = await c.from('orders').update({
    table_id: table.id, table_number: table.name || '',
  }).eq('id', orderId).eq('company_id', cid);
  if (updErr) rpcError(updErr);
  await logOrderLink(c, cid, order, 'link_table', `Mesa vinculada: ${table.name || ''}`, {
    table_id: table.id,
  });
  return true;
}

// ---------- Nome da comanda (balcão/retirada, sem cliente) ----------
// Salva texto livre no snapshot próprio do pedido (customer_data.name),
// SEMPRE com customer_id null: nenhum registro em customers é criado,
// nenhum cadastro é alterado. Vazio remove o nome (volta a "Avulso").
// Escopo rígido: só retirada sem cliente vinculado (delivery usa o
// cadastro; mesa tem identidade própria). Pedido terminal não muda.
export async function setComandaName(client, orderId, companyId, name) {
  const c = mustBeConfigured(client);
  const cid = requireCompanyId(companyId);
  if (!orderId) throw new Error('Pedido não identificado');
  const { data: order, error: ordErr } = await c
    .from('orders')
    .select('id,company_id,status,order_type,customer_id,customer_data')
    .eq('id', orderId)
    .eq('company_id', cid)
    .maybeSingle();
  if (ordErr) rpcError(ordErr);
  if (!order) throw new Error('Pedido não encontrado ou sem permissão');
  if (TERMINAL_FOR_ASSIGN.includes(order.status)) {
    throw new Error('Pedido finalizado/cancelado não pode ser alterado');
  }
  if (order.order_type !== 'retirada') {
    throw new Error('Nome da comanda só para pedidos de balcão/retirada');
  }
  if (order.customer_id) {
    throw new Error('Pedido com cliente vinculado usa o cadastro');
  }
  const clean = normalizeComandaName(name);
  const { error: updErr } = await c.from('orders').update({
    customer_data: buildComandaPatch(order.customer_data, clean),
  }).eq('id', orderId);
  if (updErr) rpcError(updErr);
  await logOrderLink(c, cid, order, 'set_comanda',
    clean ? `Nome da comanda: ${clean}` : 'Nome da comanda removido', {});
  return clean;
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

export async function markNotificationRead(client, companyId, notificationId) {
  const c = mustBeConfigured(client);
  const { error } = await c.from('notifications').update({ read: true }).eq('id', notificationId).eq('company_id', requireCompanyId(companyId));
  if (error) rpcError(error);
}

export async function listNovoNotifications(client, companyId, orderId) {
  const c = mustBeConfigured(client);
  const { data, error } = await c
    .from('notifications')
    .select('*')
    .eq('company_id', requireCompanyId(companyId))
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
