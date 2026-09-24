import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useCompany } from '@/hooks/useCompany';
import PageHeader from '@/components/PageHeader';
import { useToast } from '@/components/ui/use-toast';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { ShoppingBag, Clock, AlertTriangle, Smartphone, MessageSquare, Store } from 'lucide-react';
import OrderModal from '@/components/orders/OrderModal';
import CancelOrderDialog from '@/components/orders/CancelOrderDialog';
import NewOrderAlert from '@/components/orders/NewOrderAlert';
import NewOrdersQueue from '@/components/orders/NewOrdersQueue';
import { playNewOrderAlert, requestNotificationPermission, showOrderNotification } from '@/lib/orderSound';
import { getAlertPrefs } from '@/lib/alertPrefs';
import { changeOrderStatus, getAvailableActions, STATUS_LABELS } from '@/lib/orderStatusFlow';

const COLUMNS = [
  { id: 'novo', label: 'Novo', dot: 'bg-blue-500' },
  { id: 'confirmado', label: 'Confirmado', dot: 'bg-yellow-500' },
  { id: 'em_preparo', label: 'Em preparo', dot: 'bg-orange-500' },
  { id: 'aguardando_retirada', label: 'Pronto', dot: 'bg-purple-500' },
  { id: 'saiu_entrega', label: 'Saiu p/ entrega', dot: 'bg-indigo-500' },
  { id: 'finalizado', label: 'Finalizado', dot: 'bg-green-500' },
  { id: 'cancelado', label: 'Cancelado', dot: 'bg-red-500' },
];

const fmtCurrency = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);

const SOURCE_CONFIG = {
  online: { label: 'Online', icon: Smartphone },
  whatsapp: { label: 'WhatsApp', icon: MessageSquare },
  balcao: { label: 'Balcão', icon: Store },
};

function waitTime(dateStr) {
  if (!dateStr) return '--';
  const min = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  return `${h}h${min % 60}min`;
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-4 border-border border-t-primary rounded-full animate-spin" />
    </div>
  );
}

export default function Pedidos() {
  const { loading, company } = useCompany();
  const { toast } = useToast();
  const [orders, setOrders] = useState([]);
  const [dataLoading, setDataLoading] = useState(true);
  const companyIdRef = useRef(null);
  const [, setTick] = useState(0);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [cancelOrderData, setCancelOrderData] = useState(null);
  const [queueOpen, setQueueOpen] = useState(false);
  const [highlightId, setHighlightId] = useState(null);
  const [alertQueue, setAlertQueue] = useState([]);
  const initialLoadRef = useRef(true);
  const loadFinishedAtRef = useRef(0);
  const seenOrderIdsRef = useRef(new Set());
  const highlightTimerRef = useRef(null);
  const alertPrefsRef = useRef({ sound: true, visual: true });
  const pendingStatusRef = useRef(new Set());
  const [searchParams, setSearchParams] = useSearchParams();

  // Marca como lida a notificação de "novo" do pedido (best-effort).
  const markNovoNotificationRead = async (orderId) => {
    try {
      const list = await base44.entities.Notification.filter({ order_id: orderId, status: 'novo' });
      const unread = list.filter(n => !n.read);
      await Promise.all(unread.map(n => base44.entities.Notification.update(n.id, { read: true })));
    } catch (err) { /* ignore */ }
  };

  // Abre o pedido vindo do sino/alerta (busca na lista ou no banco).
  const openOrderById = async (orderId) => {
    if (!orderId) return;
    const local = orders.find(o => o.id === orderId);
    if (local) {
      setSelectedOrder(local);
      return;
    }
    try {
      const found = await base44.entities.Order.filter({ id: orderId, company_id: companyIdRef.current });
      if (found.length > 0) setSelectedOrder(found[0]);
    } catch (err) { /* ignore */ }
  };

  useEffect(() => {
    if (!company) return;
    companyIdRef.current = company.id;
    requestNotificationPermission();
    base44.auth.me().then(u => {
      if (u) alertPrefsRef.current = getAlertPrefs(company.id, u.id);
    }).catch(() => {});
    const load = async () => {
      try {
        const ords = await base44.entities.Order.filter({ company_id: company.id }, '-created_date', 100);
        setOrders(ords);
        ords.forEach(o => seenOrderIdsRef.current.add(o.id));
      } catch (err) { console.error(err); }
      finally {
        setDataLoading(false);
        initialLoadRef.current = false;
        loadFinishedAtRef.current = Date.now();
      }
    };
    load();

    const unsub = base44.entities.Order.subscribe((event) => {
      if (!companyIdRef.current) return;
      if (event.data?.company_id && event.data.company_id !== companyIdRef.current) return;
      if (event.type === 'create') {
        const isNew = !seenOrderIdsRef.current.has(event.data.id);
        seenOrderIdsRef.current.add(event.data.id);
        setOrders(prev => [event.data, ...prev.filter(o => o.id !== event.data.id)]);
        // Som + alerta + destaque SOMENTE na primeira vez que o pedido aparece.
        // Updates/realtime/re-renders/refresh do mesmo pedido não repetem.
        // Janela de graça: evento que chega durante o load inicial (ou até 10s
        // após) ainda alerta, desde que o pedido seja realmente recente
        // (created_date < 120s) — pedidos antigos nunca disparam.
        const createdAt = event.data.created_date ? new Date(event.data.created_date).getTime() : 0;
        const isFresh = createdAt > 0 && (Date.now() - createdAt) < 120000;
        const inGraceWindow = initialLoadRef.current || (Date.now() - loadFinishedAtRef.current) < 10000;
        if (isNew && inGraceWindow && isFresh) {
          const prefs = alertPrefsRef.current;
          if (prefs.sound) playNewOrderAlert();
          if (prefs.visual) {
            showOrderNotification(event.data);
            setAlertQueue(prev => prev.some(o => o.id === event.data.id) ? prev : [...prev, event.data]);
          }
          setHighlightId(event.data.id);
          if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
          highlightTimerRef.current = setTimeout(() => setHighlightId(null), 8000);
        }
      }
      else if (event.type === 'update') setOrders(prev => prev.map(o => o.id === event.data.id ? event.data : o));
      else if (event.type === 'delete') setOrders(prev => prev.filter(o => o.id !== event.id));
    });

    const timer = setInterval(() => setTick(t => t + 1), 30000);
    return () => {
      unsub?.();
      clearInterval(timer);
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    };
  }, [company]);

  // Abre pedido vindo do sino (?pedido=<id>) uma única vez por parâmetro.
  useEffect(() => {
    const pedidoId = searchParams.get('pedido');
    if (!pedidoId || dataLoading) return;
    openOrderById(pedidoId);
    markNovoNotificationRead(pedidoId);
    setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, dataLoading]);

  if (loading || (dataLoading && !company)) return <Spinner />;
  if (!company) return null;

  // Ação direta no card (reutiliza fluxo central + guarda anti-duplo do drag)
  const handleCardAction = async (order, action) => {
    if (pendingStatusRef.current.has(order.id)) return;
    pendingStatusRef.current.add(order.id);
    try {
      const updated = await changeOrderStatus(order.id, action.next);
      if (updated) {
        setOrders(prev => prev.map(o => o.id === updated.id ? updated : o));
        toast({ title: action.id === 'accept' ? 'Pedido confirmado!' : `Pedido: ${STATUS_LABELS[action.next]}` });
      }
    } catch (err) {
      toast({ title: 'Erro ao atualizar pedido', description: err?.message, variant: 'destructive' });
    } finally {
      pendingStatusRef.current.delete(order.id);
    }
  };

  const onDragEnd = async (result) => {    const { destination, source, draggableId } = result;
    if (!destination || destination.droppableId === source.droppableId) return;
    // Guarda contra duplo disparo (drop repetido antes da resposta)
    if (pendingStatusRef.current.has(draggableId)) return;
    pendingStatusRef.current.add(draggableId);
    const newStatus = destination.droppableId;
    setOrders(prev => prev.map(o => o.id === draggableId ? { ...o, status: newStatus } : o));
    try {
      const updated = await changeOrderStatus(draggableId, newStatus);
      if (updated) setOrders(prev => prev.map(o => o.id === draggableId ? updated : o));
    } catch (err) {
      toast({ title: 'Erro ao atualizar pedido', variant: 'destructive' });
      const ords = await base44.entities.Order.filter({ company_id: company.id }, '-created_date', 100);
      setOrders(ords);
    } finally {
      pendingStatusRef.current.delete(draggableId);
    }
  };

  const inQueue = orders.filter(o => ['novo', 'confirmado', 'em_preparo', 'aguardando_retirada', 'saiu_entrega'].includes(o.status));
  const delayed = inQueue.filter(o => {
    const min = (Date.now() - new Date(o.created_date).getTime()) / 60000;
    return min > 30;
  });
  const stats = [
    { icon: ShoppingBag, label: 'Na fila', value: inQueue.length, color: 'text-blue-600', bg: 'bg-blue-50' },
    { icon: AlertTriangle, label: 'Em atraso', value: delayed.length, color: 'text-red-600', bg: 'bg-red-50' },
  ];

  return (
    <div className="w-full max-w-full min-w-0 lg:h-full lg:min-h-0 lg:flex lg:flex-col">
      <div className="shrink-0">
        <PageHeader title="Fila de pedidos" description="Arraste os pedidos entre as colunas para atualizar o status" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 mb-6 shrink-0">
        {stats.map((s, i) => (
          <div key={i} className="rounded-2xl border border-border bg-card p-4">
            <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${s.bg} mb-2`}>
              <s.icon className={`h-5 w-5 ${s.color}`} />
            </div>
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className="font-heading text-xl font-bold text-foreground mt-0.5">{s.value}</p>
          </div>
        ))}
      </div>

      {orders.length === 0 ? (
        <div className="text-center py-20 rounded-2xl border border-border bg-card">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
            <ShoppingBag className="h-8 w-8 text-muted-foreground" />
          </div>
          <p className="font-medium text-foreground">Nenhum pedido recebido</p>
          <p className="text-sm text-muted-foreground mt-1">Os pedidos aparecerão aqui em tempo real.</p>
        </div>
      ) : (
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="flex gap-3 sm:gap-4 overflow-x-auto kanban-scroll pb-4 -mx-1 px-1 lg:flex-1 lg:min-h-0 lg:overflow-y-hidden lg:pb-2">
            {COLUMNS.map(col => {
              const colOrders = orders.filter(o => o.status === col.id);
              return (
                <Droppable key={col.id} droppableId={col.id}>
                  {(provided) => (
                    <div ref={provided.innerRef} {...provided.droppableProps} className="w-64 sm:w-72 shrink-0 min-w-0 max-h-[60dvh] lg:max-h-full overflow-y-auto lg:h-full rounded-xl">
                      {col.id === 'novo' ? (
                        <button
                          type="button"
                          onClick={() => setQueueOpen(true)}
                          aria-label={`Abrir fila de pedidos novos (${colOrders.length})`}
                          title="Abrir fila de novos"
                          className="sticky top-0 z-10 w-full bg-background/95 backdrop-blur-sm flex items-center justify-between mb-3 px-1 pt-1 pb-2 cursor-pointer rounded-md hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring text-left"
                        >
                          <div className="flex items-center gap-2">
                            <span className={`h-2.5 w-2.5 rounded-full ${col.dot}`} />
                            <span className="font-heading font-semibold text-sm text-foreground underline decoration-dotted underline-offset-4">{col.label}</span>
                          </div>
                          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{colOrders.length}</span>
                        </button>
                      ) : (
                        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm flex items-center justify-between mb-3 px-1 pt-1 pb-2">
                          <div className="flex items-center gap-2">
                            <span className={`h-2.5 w-2.5 rounded-full ${col.dot}`} />
                            <span className="font-heading font-semibold text-sm text-foreground">{col.label}</span>
                          </div>
                          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{colOrders.length}</span>
                        </div>
                      )}
                      <div className="space-y-2 min-h-[100px]">
                        {colOrders.map((order, index) => {
                          const src = SOURCE_CONFIG[order.source] || SOURCE_CONFIG.online;
                          const wt = waitTime(order.created_date);
                          const wtNum = parseInt(wt) || 0;
                          const isDelayed = wtNum > 30 && !['finalizado', 'cancelado'].includes(col.id);
                          const cardActions = getAvailableActions(order);
                          const cardPrimary = cardActions.find(a => a.id === 'accept' || a.id === 'advance');
                          const cardCancel = cardActions.find(a => a.id === 'cancel');
                          return (
                            <Draggable key={order.id} draggableId={order.id} index={index}>
                              {(prov, snapshot) => (
                                <div
                                  ref={prov.innerRef}
                                  {...prov.draggableProps}
                                  {...prov.dragHandleProps}
                                  role="button"
                                  tabIndex={0}
                                  className={`w-full min-w-0 rounded-xl border bg-card p-2.5 sm:p-3 text-left shadow-sm transition-shadow cursor-pointer hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${snapshot.isDragging ? 'shadow-lg border-primary' : 'border-border'} ${isDelayed ? 'border-l-4 border-l-red-500' : ''} ${highlightId === order.id ? 'ring-2 ring-primary border-primary' : ''}`}
                                  onClick={() => !snapshot.isDragging && setSelectedOrder(order)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                      e.preventDefault();
                                      setSelectedOrder(order);
                                    }
                                  }}
                                  aria-label={`Ver pedido ${order.order_number || ''} de ${order.customer_name}`}
                                >
                                  <div className="flex items-center justify-between gap-2 mb-2">
                                    <span className="flex items-center gap-1.5 min-w-0">
                                      <span className="font-heading font-bold text-sm text-foreground truncate">#{order.order_number || '—'}</span>
                                      {order.status === 'novo' && (
                                        <span className="flex shrink-0 items-center gap-1 rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold text-white">
                                          <span className="h-1.5 w-1.5 rounded-full bg-white" /> NOVO
                                        </span>
                                      )}
                                    </span>
                                    <span className={`flex shrink-0 items-center gap-1 text-xs whitespace-nowrap ${isDelayed ? 'text-red-600 font-medium' : 'text-muted-foreground'}`}>
                                      <Clock className="h-3 w-3" /> {wt}
                                    </span>
                                  </div>
                                  <div className="rounded-md bg-muted/60 px-2 py-0.5 text-[11px] font-semibold text-foreground truncate mb-1.5">{col.label}</div>
                                  <p className="font-medium text-sm text-foreground truncate">{order.customer_name}</p>
                                  {order.customer_phone && <p className="text-xs text-muted-foreground mt-0.5 truncate">{order.customer_phone}</p>}
                                  {(order.items?.length || 0) > 0 && (
                                    <div className="mt-2 rounded-lg bg-muted/40 px-2 py-1.5 space-y-0.5">
                                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Pedido</p>
                                      {order.items.slice(0, 3).map((item, i) => (
                                        <p key={i} className="text-sm font-semibold text-foreground truncate">
                                          {item.name} <span className="text-muted-foreground font-medium">× {item.quantity}</span>
                                          {item.complements?.length > 0 && <span className="text-muted-foreground font-normal"> +</span>}
                                        </p>
                                      ))}
                                      {order.items.length > 3 && (
                                        <p className="text-xs text-muted-foreground">+ {order.items.length - 3} {(order.items.length - 3) === 1 ? 'item' : 'itens'}</p>
                                      )}
                                    </div>
                                  )}
                                  <div className="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground min-w-0">
                                    <span className="flex shrink-0 items-center gap-1"><src.icon className="h-3 w-3" /> {src.label}</span>
                                    <span className="shrink-0">•</span>
                                    <span className="truncate">{order.items?.length || 0} {order.items?.length === 1 ? 'item' : 'itens'}</span>
                                  </div>
                                  {order.payment_method && <p className="text-xs text-muted-foreground mt-1 truncate">💳 {order.payment_method}</p>}
                                  {order.notes && <p className="text-xs text-muted-foreground mt-1 italic truncate">📝 {order.notes}</p>}
                                  <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-border">
                                    <span className="font-heading font-bold text-sm text-foreground truncate min-w-0">{fmtCurrency(order.total)}</span>
                                    {(cardPrimary || cardCancel) && (
                                      <span className="flex shrink-0 items-center justify-end gap-1.5">
                                        {cardCancel && (
                                          <button
                                            type="button"
                                            onClick={(e) => { e.stopPropagation(); setCancelOrderData(order); }}
                                            className="h-8 px-2.5 rounded-lg text-xs font-medium text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
                                          >
                                            Cancelar
                                          </button>
                                        )}
                                        {cardPrimary && (
                                          <button
                                            type="button"
                                            onClick={(e) => { e.stopPropagation(); handleCardAction(order, cardPrimary); }}
                                            className="h-8 px-2.5 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors whitespace-nowrap"
                                          >
                                            {cardPrimary.id === 'accept' ? 'Aceitar' : `→ ${STATUS_LABELS[cardPrimary.next] || 'Avançar'}`}
                                          </button>
                                        )}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              )}
                            </Draggable>
                          );
                        })}
                        {provided.placeholder}
                      </div>
                    </div>
                  )}
                </Droppable>
              );
            })}
          </div>
        </DragDropContext>
      )}

      {alertQueue.length > 0 && (
        <NewOrderAlert
          order={alertQueue[0]}
          open={alertQueue.length > 0}
          onView={() => {
            const current = alertQueue[0];
            setAlertQueue(prev => prev.slice(1));
            if (current) {
              markNovoNotificationRead(current.id);
              setSelectedOrder(current);
            }
          }}
          onClose={() => setAlertQueue(prev => prev.slice(1))}
        />
      )}
      {selectedOrder && (
        <OrderModal
          order={selectedOrder}
          isOpen={!!selectedOrder}
          onClose={() => setSelectedOrder(null)}
          onOrderUpdated={(updated) => {
            setOrders(prev => prev.map(o => o.id === updated.id ? updated : o));
            setSelectedOrder(updated);
          }}
          onCancel={() => setCancelOrderData(selectedOrder)}
          onSelectOrder={(o) => setSelectedOrder(o)}
        />
      )}
      {cancelOrderData && (
        <CancelOrderDialog
          order={cancelOrderData}
          isOpen={!!cancelOrderData}
          onClose={() => setCancelOrderData(null)}
          onCancelled={(updated) => {
            setOrders(prev => prev.map(o => o.id === updated.id ? updated : o));
            setSelectedOrder(null);
          }}
        />
      )}
      <NewOrdersQueue
        open={queueOpen}
        onClose={() => setQueueOpen(false)}
        orders={orders}
        onOrderUpdated={(updated) => {
          setOrders(prev => prev.map(o => o.id === updated.id ? updated : o));
        }}
      />
    </div>
  );
}