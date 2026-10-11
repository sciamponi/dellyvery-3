import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase, isSupabaseConfigured } from '@/api/supabaseClient';
import { useSupabaseAuth } from '@/lib/SupabaseAuthContext';
import {
  listOrdersWithItems, getOrder as sbGetOrder, getOrderDetail as sbGetOrderDetail,
  listNovoNotifications, markNotificationRead as sbMarkRead, subscribeCompanyTable,
  fromSupabaseOrder,
} from '@/api/orders';
import { listDrivers as sbListDrivers } from '@/api/team';
import { useCompany } from '@/hooks/useCompany';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { ShoppingBag, Clock, Smartphone, MessageSquare, Store, ChevronLeft, ChevronRight, SlidersHorizontal } from 'lucide-react';
import OrderModal from '@/components/orders/OrderModal';
import CancelOrderDialog from '@/components/orders/CancelOrderDialog';
import NewOrderAlert from '@/components/orders/NewOrderAlert';
import NewOrdersQueue from '@/components/orders/NewOrdersQueue';
import { playNewOrderAlert, requestNotificationPermission, showOrderNotification } from '@/lib/orderSound';
import { getAlertPrefs } from '@/lib/alertPrefs';
import { createAutoAssignRunner } from '@/lib/autoAssignRealtime';
import { changeOrderStatus, getAvailableActions, STATUS_LABELS } from '@/lib/orderStatusFlow';
import { formatOrderTotal, isMissingTotal } from '@/lib/money';
import {
  LEGACY_STAGE_SEED,
  listStages as sbListStages,
  displayStages as buildDisplayStages,
  stageForStatus,
  resolveCardPrimary,
  assertSingleStep,
} from '@/api/orderStages';
import StageManagerDialog from '@/components/orders/StageManagerDialog';
import ConfirmDialog from '@/components/ConfirmDialog';
import { shortAddress } from '@/lib/deliveryRoute';

// Colunas legadas (fallback quando as stages configuráveis ainda não
// carregaram ou a migration ainda não foi aplicada). Espelham o seed.
const LEGACY_FALLBACK_STAGES = LEGACY_STAGE_SEED.map((s) => ({
  id: `legacy-${s.key}`,
  company_id: null,
  key: s.key,
  mapsTo: s.mapsTo,
  name: s.name,
  color: s.color,
  position: s.position,
  isInitial: s.isInitial,
  isFinal: s.isFinal,
  active: true,
}));

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
  const { loading } = useCompany();
  const { toast } = useToast();
  // FASE 5.4: com sessão Supabase + empresa atual, pedidos via Supabase.
  const { user: sbUser, currentCompany: sbCompany } = useSupabaseAuth();
  const sbActive = isSupabaseConfigured() && !!sbUser && !!sbCompany;
  const company = sbActive ? { id: sbCompany.id, ...sbCompany } : null;
  // Deps estáveis do efeito realtime: o objeto `company` acima é recriado a
  // cada render; usar o id primitivo evita resubscribe (e refetch) em loop,
  // que derrubava o canal realtime.
  const companyId = company?.id || null;
  const sbUserId = sbUser?.id || null;

  // RPC de status retorna a linha sem items/history; preserva os já carregados.
  const mergeUpdated = (prev, updated) => prev.map(o => {
    if (o.id !== updated.id) return o;
    return {
      ...o,
      ...updated,
      items: updated.items && updated.items.length > 0 ? updated.items : (o.items || []),
      status_history: updated.status_history && updated.status_history.length > 0
        ? updated.status_history
        : (o.status_history || []),
    };
  });
  const [orders, setOrders] = useState([]);
  const [driversById, setDriversById] = useState({});
  const [dataLoading, setDataLoading] = useState(true);
  const companyIdRef = useRef(null);
  const [, setTick] = useState(0);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [cancelOrderData, setCancelOrderData] = useState(null);
  // Baixa de entrega: pede confirmação antes de finalizar (evita toque acidental).
  const [finishOrderData, setFinishOrderData] = useState(null);
  const [queueOpen, setQueueOpen] = useState(false);
  const [highlightId, setHighlightId] = useState(null);
  const [alertQueue, setAlertQueue] = useState([]);
  // FASE 1: stages configuráveis por empresa (null = ainda carregando ou
  // migration ausente -> Kanban usa o fallback legado, sem quebrar).
  const [stages, setStages] = useState(null);
  const [stageDialogOpen, setStageDialogOpen] = useState(false);
  // Colunas: visíveis + terminais (Finalizado/Cancelado) mesmo inativas, para
  // pedidos terminais nunca caírem pelo fallback em outra coluna.
  const displayStages = buildDisplayStages(
    stages && stages.length > 0 ? stages : LEGACY_FALLBACK_STAGES,
  );
  const stageById = React.useMemo(
    () => Object.fromEntries(displayStages.map((s) => [s.id, s])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stages],
  );

  const seenOrderIdsRef = useRef(new Set());
  const highlightTimerRef = useRef(null);
  const alertPrefsRef = useRef({ sound: true, visual: true });
  const autoAssignRunner = useRef(null);
  const pendingStatusRef = useRef(new Set());
  const kanbanRef = useRef(null);
  const [searchParams, setSearchParams] = useSearchParams();

  // UX: setas levam direto ao início/fim, com scroll imediato.
  const scrollKanban = (dir) => {
    const el = kanbanRef.current;
    if (!el) return;
    el.scrollTo({ left: dir > 0 ? el.scrollWidth : 0, behavior: 'auto' });
  };

  // Marca como lida a notificação de "novo" do pedido (best-effort).
  const markNovoNotificationRead = async (orderId) => {
    try {
      const list = await listNovoNotifications(supabase, orderId);
      await Promise.all(list.filter(n => !n.read).map(n => sbMarkRead(supabase, n.id)));
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
      const found = await sbGetOrder(supabase, companyIdRef.current, orderId);
      if (found) setSelectedOrder(found);
    } catch (err) { /* ignore */ }
  };

  useEffect(() => {
    if (!companyId) return;
    companyIdRef.current = companyId;
    if (sbActive) {
      autoAssignRunner.current = createAutoAssignRunner({
        client: supabase,
        getCompanyId: () => companyIdRef.current,
      });
    } else {
      autoAssignRunner.current = null;
    }
    requestNotificationPermission();
    if (sbActive && sbUserId) {
      alertPrefsRef.current = getAlertPrefs(companyId, sbUserId);
    }
    const load = async () => {
      try {
        const ords = await listOrdersWithItems(supabase, companyId, 100);
        setOrders(ords);
        ords.forEach(o => seenOrderIdsRef.current.add(o.id));
        // FASE 5.5-B3: mapa de entregadores para a linha 🛵 do card.
        if (sbActive) {
          sbListDrivers(supabase, companyId)
            .then(list => setDriversById(Object.fromEntries((list || []).map(d => [d.id, d]))))
            .catch(() => {});
        }
      } catch (err) { console.error(err); }
      finally {
        setDataLoading(false);
      }
    };
    load();

    const handleRealtimeEvent = (event) => {
      if (!companyIdRef.current) return;
      if (event.data?.company_id && event.data.company_id !== companyIdRef.current) return;
      if (event.type === 'create') {
        const isNew = !seenOrderIdsRef.current.has(event.data.id);
        seenOrderIdsRef.current.add(event.data.id);
        setOrders(prev => [event.data, ...prev.filter(o => o.id !== event.data.id)]);
        // Som + alerta + destaque SOMENTE na primeira vez que o pedido aparece
        // (seenOrderIds). Updates/realtime/re-renders/refresh do mesmo pedido
        // não repetem; pedidos antigos nunca disparam (created_date < 120s).
        // Sem janela de tempo: painel aberto há horas também deve alertar.
        const createdAt = event.data.created_date ? new Date(event.data.created_date).getTime() : 0;
        const isFresh = createdAt > 0 && (Date.now() - createdAt) < 120000;
        if (isNew && isFresh) {
          const prefs = alertPrefsRef.current;
          if (prefs.sound) playNewOrderAlert();
          if (prefs.visual) {
            showOrderNotification(event.data);
            setAlertQueue(prev => prev.some(o => o.id === event.data.id) ? prev : [...prev, event.data]);
          }
          setHighlightId(event.data.id);
          if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
          highlightTimerRef.current = setTimeout(() => setHighlightId(null), 8000);
          // Motoboy padrão: atribui na chegada (somente delivery novo, sem driver).
          if (sbActive) void autoAssignRunner.current?.maybeAssign(event.data);
        }
      }
      else if (event.type === 'update') setOrders(prev => mergeUpdated(prev, event.data));
      else if (event.type === 'delete') setOrders(prev => prev.filter(o => o.id !== event.id));
    };

    // Realtime via postgres_changes (com detalhe no create).
    // Deps estáveis (companyId/sbActive/sbUserId): o objeto `company` muda a
    // cada render e NÃO pode ser dep (causava resubscribe em loop, que
    // derrubava o canal realtime).
    let unsub;
    let retryTimer = null;
    const doSubscribe = () => {
      return subscribeCompanyTable(supabase, 'orders', companyId, async (event) => {
        if (event.type === 'create' && event.data?.id) {
          try {
            const detail = await sbGetOrderDetail(supabase, companyId, event.data.id);
            handleRealtimeEvent({ type: 'create', data: detail || fromSupabaseOrder(event.data) });
          } catch {
            handleRealtimeEvent({ type: 'create', data: fromSupabaseOrder(event.data) });
          }
        } else if (event.type === 'update') {
          handleRealtimeEvent({ type: 'update', data: fromSupabaseOrder(event.data) });
        } else {
          handleRealtimeEvent(event);
        }
      });
    };
    try {
      unsub = doSubscribe();
    } catch (err) {
      // Canal temporariamente indisponível (instância anterior ainda liberando
      // o tópico): uma nova tentativa sem quebrar a página.
      retryTimer = setTimeout(() => {
        try {
          unsub = doSubscribe();
        } catch { /* próxima montagem tenta de novo */ }
      }, 2000);
    }

    const timer = setInterval(() => setTick(t => t + 1), 30000);
    return () => {
      if (retryTimer) clearTimeout(retryTimer);
      unsub?.();
      clearInterval(timer);
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    };
  }, [companyId, sbActive, sbUserId]);

  // FASE 1: carrega stages configuráveis + realtime (colunas atualizam ao
  // editar no gerenciador). Falha aqui nunca quebra o Kanban: fallback legado.
  useEffect(() => {
    if (!companyId || !sbActive) return;
    let cancelled = false;
    const load = async () => {
      try {
        const list = await sbListStages(supabase, companyId);
        if (!cancelled && list && list.length > 0) setStages(list);
      } catch {
        if (!cancelled) setStages(null);
      }
    };
    load();
    let unsub = null;
    try {
      unsub = subscribeCompanyTable(supabase, 'restaurant_order_stages', companyId, () => {
        load();
      });
    } catch {
      unsub = null;
    }
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [companyId, sbActive]);

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

  // Ação primária do card: com stages, o rótulo segue a próxima ETAPA
  // (uma transição legada por vez) com fallback legado — pedido não-terminal
  // nunca fica sem ação visível; sem stages, fluxo legado.
  const getCardPrimary = (order) => {
    if (!order || ['finalizado', 'cancelado'].includes(order.status)) return null;
    if (stages && stages.length > 0) {
      return resolveCardPrimary(displayStages, order);
    }
    const legacy = getAvailableActions(order);
    return legacy.find((a) => a.id === 'accept' || a.id === 'advance') || null;
  };

  // Ação direta no card (reutiliza fluxo central + guarda anti-duplo do drag).
  // Avanço para etapa terminal (baixa da entrega) exige confirmação explícita.
  const requestCardAction = (order, action) => {
    if (!order || !action) return;
    if (action.next === 'finalizado') {
      setFinishOrderData({ order, action });
      return;
    }
    void handleCardAction(order, action);
  };
  const handleCardAction = async (order, action) => {
    if (pendingStatusRef.current.has(order.id)) return;
    pendingStatusRef.current.add(order.id);
    try {
      const updated = await changeOrderStatus(order.id, action.next);
      if (updated) {
        // FASE 1: recarrega o detalhe (items/history) para o Kanban não
        // exibir timeline defasada — a RPC retorna a linha sem eles.
        let detail = null;
        try {
          detail = await sbGetOrderDetail(supabase, companyIdRef.current, updated.id);
        } catch {
          detail = null;
        }
        setOrders(prev => mergeUpdated(prev, detail || updated));
        toast({ title: action.id === 'accept' ? 'Pedido confirmado!' : `Pedido: ${action.label?.replace(/^→ /, '') || STATUS_LABELS[action.next]}` });
      }
    } catch (err) {
      toast({ title: 'Erro ao atualizar pedido', description: err?.message, variant: 'destructive' });
    } finally {
      pendingStatusRef.current.delete(order.id);
    }
  };

  const onDragEnd = async (result) => {
    const { destination, source, draggableId } = result;
    if (!destination || destination.droppableId === source.droppableId) return;
    // Guarda contra duplo disparo (drop repetido antes da resposta)
    if (pendingStatusRef.current.has(draggableId)) return;
    const dragged = orders.find((o) => o.id === draggableId);
    const targetStage = stageById[destination.droppableId];
    if (!dragged || !targetStage) return;
    const toStatus = targetStage.mapsTo;
    // FASE 1: drag valida UMA etapa por vez (volta só uma casa, sem pular).
    // Cancelar via arraste mantém o caminho legado (sem motivo, como antes).
    try {
      const check = assertSingleStep(displayStages, dragged.status, toStatus, dragged.order_type);
      if (check.noop) return;
      // Arraste para Cancelado abre o diálogo com motivo (nunca baixa direta).
      if (check.cancel) { setCancelOrderData(dragged); return; }
    } catch (err) {
      toast({ title: 'Movimento inválido', description: err?.message, variant: 'destructive' });
      try {
        const ords = await listOrdersWithItems(supabase, company.id, 100);
        setOrders(ords);
      } catch { /* mantém estado atual */ }
      return;
    }
    pendingStatusRef.current.add(draggableId);
    const newStatus = toStatus;
    setOrders(prev => prev.map(o => o.id === draggableId ? { ...o, status: newStatus } : o));
    try {
      const updated = await changeOrderStatus(draggableId, newStatus);
      // FASE 1: recarrega o detalhe (items/history); a RPC não os retorna.
      if (updated) {
        let detail = null;
        try {
          detail = await sbGetOrderDetail(supabase, companyIdRef.current, updated.id);
        } catch {
          detail = null;
        }
        setOrders(prev => mergeUpdated(prev, { ...(detail || updated), id: draggableId }));
      }
    } catch (err) {
      toast({ title: 'Erro ao atualizar pedido', variant: 'destructive' });
      const ords = await listOrdersWithItems(supabase, company.id, 100);
      setOrders(ords);
    } finally {
      pendingStatusRef.current.delete(draggableId);
    }
  };

  return (
    <div className="w-full max-w-full min-w-0 lg:h-full lg:min-h-0 lg:flex lg:flex-col">
      <div className="shrink-0">
        <PageHeader title="Fila de pedidos" description="Arraste os pedidos entre as colunas para atualizar o status" />
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
        <>
        <div className="flex justify-end gap-2 mb-2 shrink-0">
          <Button variant="outline" onClick={() => setStageDialogOpen(true)} aria-label="Gerenciar etapas do Kanban">
            <SlidersHorizontal className="h-4 w-4" /> Etapas
          </Button>
          <span className="hidden md:flex gap-2">
            <Button variant="outline" size="icon" onClick={() => scrollKanban(-1)} aria-label="Rolar Kanban para a esquerda">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" onClick={() => scrollKanban(1)} aria-label="Rolar Kanban para a direita">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </span>
        </div>
        <DragDropContext onDragEnd={onDragEnd}>
          <div ref={kanbanRef} className="flex gap-3 sm:gap-4 overflow-x-auto kanban-scroll pb-4 -mx-1 px-1 lg:flex-1 lg:min-h-0 lg:overflow-y-hidden lg:pb-2">
            {displayStages.map(col => {
              const colOrders = orders.filter(o => stageForStatus(displayStages, o.status)?.id === col.id);
              return (
                <Droppable key={col.id} droppableId={col.id}>
                  {(provided) => (
                    <div ref={provided.innerRef} {...provided.droppableProps} className="w-64 sm:w-72 shrink-0 min-w-0 max-h-[60dvh] lg:max-h-full overflow-y-auto lg:h-full rounded-xl">
                      {col.mapsTo === 'novo' ? (
                        <button
                          type="button"
                          onClick={() => setQueueOpen(true)}
                          aria-label={`Abrir fila de pedidos novos (${colOrders.length})`}
                          title="Abrir fila de novos"
                          className="sticky top-0 z-10 w-full bg-background/95 backdrop-blur-sm flex items-center justify-between mb-3 px-1 pt-1 pb-2 cursor-pointer rounded-md hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring text-left"
                        >
                          <div className="flex items-center gap-2">
                            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: col.color }} />
                            <span className="font-heading font-semibold text-sm text-foreground underline decoration-dotted underline-offset-4">{col.name}</span>
                          </div>
                          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{colOrders.length}</span>
                        </button>
                      ) : (
                        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm flex items-center justify-between mb-3 px-1 pt-1 pb-2">
                          <div className="flex items-center gap-2">
                            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: col.color }} />
                            <span className="font-heading font-semibold text-sm text-foreground">{col.name}</span>
                          </div>
                          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{colOrders.length}</span>
                        </div>
                      )}
                      <div className="space-y-2 min-h-[100px]">
                        {colOrders.map((order, index) => {
                          const src = SOURCE_CONFIG[order.source] || SOURCE_CONFIG.online;
                          const wt = waitTime(order.created_date);
                          const wtNum = parseInt(wt) || 0;
                          const isDelayed = wtNum > 30 && !['finalizado', 'cancelado'].includes(col.mapsTo);
                          const cardPrimary = getCardPrimary(order);
                          const cardCancel = !['finalizado', 'cancelado'].includes(order.status);
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
                                  <div className="rounded-md bg-muted/60 px-2 py-0.5 text-[11px] font-semibold text-foreground truncate mb-1.5">{col.name}</div>
                                  <p className="font-medium text-sm text-foreground truncate">{order.customer_name}</p>
                                  {order.customer_phone && <p className="text-xs text-muted-foreground mt-0.5 truncate">{order.customer_phone}</p>}
                                  {order.driver_id && driversById[order.driver_id] && (
                                    <p className="text-xs text-muted-foreground mt-0.5 truncate">🛵 {driversById[order.driver_id].name}</p>
                                  )}
                                  {order.order_type === 'delivery' && shortAddress(order) && (
                                    <p className="text-xs text-muted-foreground mt-0.5 truncate">📍 {shortAddress(order)}</p>
                                  )}
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
                                    <span
                                      title={isMissingTotal(order.total) ? 'Total indisponível para este pedido' : undefined}
                                      className="font-heading font-bold text-sm text-foreground whitespace-nowrap shrink-0"
                                    >
                                      {formatOrderTotal(order.total)}
                                    </span>
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
                                            onClick={(e) => { e.stopPropagation(); requestCardAction(order, cardPrimary); }}
                                            title={cardPrimary.fallback ? 'Etapa seguinte inativa: usa o fluxo padrão do sistema' : undefined}
                                            className="h-8 px-2.5 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors whitespace-nowrap"
                                          >
                                            {cardPrimary.next === 'finalizado' && order.status === 'saiu_entrega' ? 'Concluir entrega' : cardPrimary.label}
                                          </button>
                                        )}
                                      </span>
                                    )}
                                  </div>
                                  {cardPrimary?.fallback && (
                                    <p className="mt-1 text-[11px] text-muted-foreground">⚠️ fluxo padrão (etapa seguinte inativa — verifique em Etapas)</p>
                                  )}
                                  {!cardPrimary && cardCancel && (
                                    <p className="mt-1 text-[11px] text-muted-foreground">⚠️ sem transição válida — verifique as Etapas do Kanban</p>
                                  )}
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
        </>
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
          company={company}
          stages={stages}
          stageName={stageForStatus(displayStages, selectedOrder.status)?.name || ''}
          driver={selectedOrder?.driver_id ? driversById[selectedOrder.driver_id] : null}
          onClose={() => setSelectedOrder(null)}
          onOrderUpdated={(updated) => {
            setOrders(prev => mergeUpdated(prev, updated));
            setSelectedOrder(prev => (prev ? mergeUpdated([prev], updated)[0] : updated));
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
            setOrders(prev => mergeUpdated(prev, updated));
            setSelectedOrder(null);
          }}
        />
      )}
      {finishOrderData && (
        <ConfirmDialog
          open={!!finishOrderData}
          onOpenChange={(open) => { if (!open) setFinishOrderData(null); }}
          title="Concluir entrega?"
          description={`Dar baixa no pedido #${finishOrderData.order?.order_number || '—'} como Finalizado. A baixa registra a entrega concluída e não altera pagamento.`}
          confirmLabel="Concluir entrega"
          onConfirm={() => {
            const { order, action } = finishOrderData;
            setFinishOrderData(null);
            void handleCardAction(order, action);
          }}
        />
      )}
      <NewOrdersQueue
        open={queueOpen}
        onClose={() => setQueueOpen(false)}
        orders={orders}
        onOrderUpdated={(updated) => {
          setOrders(prev => mergeUpdated(prev, updated));
        }}
      />
      {stageDialogOpen && companyId && (
        <StageManagerDialog
          open={stageDialogOpen}
          onClose={() => setStageDialogOpen(false)}
          companyId={companyId}
          stages={stages && stages.length > 0 ? stages : LEGACY_FALLBACK_STAGES}
          onChanged={(fresh) => setStages(fresh && fresh.length > 0 ? fresh : null)}
        />
      )}
    </div>
  );
}