import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase, isSupabaseConfigured } from '@/api/supabaseClient';
import { useSupabaseAuth } from '@/lib/SupabaseAuthContext';
import { listOrdersWithItems, fromSupabaseOrder, subscribeCompanyTable, getOrderDetail as sbGetOrderDetail, listNovoNotifications, markNotificationRead as sbMarkRead } from '@/api/orders';
import { getCurrentCompany as sbGetCurrentCompany, updateCompany as sbUpdateCompany } from '@/api/company';
import { listProducts as sbListProducts } from '@/api/catalog';
import { Button } from '@/components/ui/button';
import { Image } from '@/components/ui/image';
import { isToday, startOfDay } from 'date-fns';
import { isSameDay, isFutureDay, addDaysLocal, formatDayLabel, filterByDay } from '@/lib/orderDay';
import { ShoppingBag, Clock, CheckCircle, Package, ArrowRight, Store, AlertTriangle, XCircle, Bike, ChevronLeft, ChevronRight, Banknote, BellRing } from 'lucide-react';
import OrderModal from '@/components/orders/OrderModal';
import CancelOrderDialog from '@/components/orders/CancelOrderDialog';
import OrdersListModal from '@/components/orders/OrdersListModal';
import NewOrderAlert from '@/components/orders/NewOrderAlert';
import PdvAnnouncement, { hasSeenPdv } from '@/components/PdvAnnouncement';
import { playNewOrderAlert, requestNotificationPermission, showOrderNotification } from '@/lib/orderSound';
import { getAlertPrefs } from '@/lib/alertPrefs';
import { createAutoAssignRunner } from '@/lib/autoAssignRealtime';
import { getQueueOrders, getDelayedOrders, getFinalizedByType, getCanceled, filterByDriver } from '@/lib/orderQueue';
import { getDashboardModal, isNovosAlertCard, filterNovosOrders } from '@/lib/dashboardModals';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useToast } from '@/components/ui/use-toast';
import { listDrivers as sbListDrivers } from '@/api/team';

const STATUS_CONFIG = {
  novo: { label: 'Novo', cls: 'bg-blue-100 text-blue-700' },
  confirmado: { label: 'Confirmado', cls: 'bg-yellow-100 text-yellow-700' },
  em_preparo: { label: 'Em preparo', cls: 'bg-orange-100 text-orange-700' },
  aguardando_retirada: { label: 'Pronto', cls: 'bg-purple-100 text-purple-700' },
  saiu_entrega: { label: 'Saiu p/ entrega', cls: 'bg-indigo-100 text-indigo-700' },
  finalizado: { label: 'Finalizado', cls: 'bg-green-100 text-green-700' },
  cancelado: { label: 'Cancelado', cls: 'bg-red-100 text-red-700' },
};

const fmtCurrency = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);

// Tempo desde a criação do pedido: agora / N min / N h
function timeSince(dateStr) {
  if (!dateStr) return '--';
  const min = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h`;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [company, setCompany] = useState(null);
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [cancelOrderData, setCancelOrderData] = useState(null);
  // UX: modais de fila/atraso (mesmas regras do Kanban, via orderQueue).
  const [queueModal, setQueueModal] = useState(null);
  const [driversById, setDriversById] = useState({});
  const [driverFilter, setDriverFilter] = useState('all');
  // Navegação por dia em "Últimos pedidos" (padrão: hoje, tempo real).
  const [selectedDate, setSelectedDate] = useState(() => startOfDay(new Date()));
  const [dayOrders, setDayOrders] = useState(null);
  const [dayLoading, setDayLoading] = useState(false);
  const [dayError, setDayError] = useState(null);
  const [, setTick] = useState(0);
  const companyIdRef = useRef(null);
  // Alerta de novo pedido: mesmo mecanismo do Kanban (Pedidos.jsx) —
  // som + modal somente no primeiro evento realtime de pedido recente.
  const [alertQueue, setAlertQueue] = useState([]);
  const [highlightId, setHighlightId] = useState(null);
  const [showPdvNews, setShowPdvNews] = useState(false);
  const seenOrderIdsRef = useRef(new Set());
  const highlightTimerRef = useRef(null);
  const alertPrefsRef = useRef({ sound: true, visual: true });
  const autoAssignRunner = useRef(null);

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

  // Marca como lida a notificação de "novo" do pedido (best-effort).
  const markNovoNotificationRead = async (orderId) => {
    try {
      const list = await listNovoNotifications(supabase, orderId);
      await Promise.all(list.filter(n => !n.read).map(n => sbMarkRead(supabase, n.id)));
    } catch (err) { /* ignore */ }
  };
  // FASE 5.4: com sessão Supabase, pedidos/produtos via Supabase (RLS).
  const { user: sbUser, currentCompany: sbCompany, currentRole: sbRole } = useSupabaseAuth();
  const sbActive = isSupabaseConfigured() && !!sbUser && !!sbCompany;
  const { toast } = useToast();
  // FASE 2: controle operacional aberto/fechado (companies.is_open).
  const [confirmOpenClose, setConfirmOpenClose] = useState(false);
  const [togglingOpen, setTogglingOpen] = useState(false);
  const canToggleOpen = ['OWNER', 'ADMIN'].includes(sbRole);

  useEffect(() => {
    if (sbActive) companyIdRef.current = sbCompany.id;
    if (sbActive) {
      autoAssignRunner.current = createAutoAssignRunner({
        client: supabase,
        getCompanyId: () => companyIdRef.current,
      });
    } else {
      autoAssignRunner.current = null;
    }
    requestNotificationPermission();
    if (sbActive && sbUser) {
      alertPrefsRef.current = getAlertPrefs(sbCompany.id, sbUser.id);
    }
    const load = async () => {
      try {
        if (!sbActive) {
          if (sbUser && !sbCompany) navigate('/criar-restaurante');
          return;
        }
        companyIdRef.current = sbCompany.id;
        const [ords, prods, fullCompany] = await Promise.all([
          listOrdersWithItems(supabase, sbCompany.id, 50),
          sbListProducts(supabase, sbCompany.id).catch(() => []),
          // Linha completa da empresa (is_open fresh); identidade do
          // contexto não traz todos os campos operacionais.
          sbGetCurrentCompany(supabase, sbCompany.id).catch(() => null),
        ]);
        setCompany(fullCompany || { id: sbCompany.id, ...sbCompany });
        setOrders(ords);
        ords.forEach(o => seenOrderIdsRef.current.add(o.id));
        setProducts(prods);
        sbListDrivers(supabase, sbCompany.id)
          .then(list => setDriversById(Object.fromEntries((list || []).map(d => [d.id, d]))))
          .catch(() => {});
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
        if (!hasSeenPdv(sbUser?.id)) setShowPdvNews(true);
      }
    };
    load();

    const handleEvent = async (event) => {
      if (!companyIdRef.current) return;
      if (event.data?.company_id && event.data.company_id !== companyIdRef.current) return;
      if (event.type === 'create') {
        const isNew = !seenOrderIdsRef.current.has(event.data.id);
        seenOrderIdsRef.current.add(event.data.id);
        setOrders(prev => [event.data, ...prev.filter(o => o.id !== event.data.id)].slice(0, 50));
        // Som + alerta + destaque SOMENTE na primeira vez que o pedido aparece
        // (seenOrderIds). Pedidos antigos no carregamento inicial nunca
        // disparam (isFresh < 120s). Sem janela de tempo: painel aberto há
        // horas também deve alertar.
        const createdAt = event.data.created_date ? new Date(event.data.created_date).getTime() : 0;
        const isFresh = createdAt > 0 && (Date.now() - createdAt) < 120000;
        if (isNew && isFresh) {
          const prefs = alertPrefsRef.current;
          if (prefs.sound) playNewOrderAlert();
          // Selo de primeiro pedido: 1 consulta agregada por chegada
          // (sem N+1 por render); falha = sem selo, nunca bloqueia o alerta.
          let firstFlag;
          if (event.data.customer_id && companyIdRef.current) {
            try {
              const prior = await countCustomerOrders(
                supabase, companyIdRef.current, event.data.customer_id, event.data.id,
              );
              firstFlag = prior === 0;
            } catch { firstFlag = undefined; }
          }
          const alertItem = firstFlag === undefined
            ? event.data
            : { ...event.data, isFirstOrder: firstFlag };
          if (prefs.visual) {
            showOrderNotification(alertItem);
            setAlertQueue(prev => prev.some(o => o.id === alertItem.id) ? prev : [...prev, alertItem]);
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
    const watchId = companyIdRef.current || sbCompany?.id;
    const unsub = watchId
      ? subscribeCompanyTable(supabase, 'orders', watchId, async (event) => {
          if (event.type === 'create' && event.data?.id) {
            try {
              const detail = await sbGetOrderDetail(supabase, watchId, event.data.id);
              handleEvent({ type: 'create', data: detail || fromSupabaseOrder(event.data) });
            } catch {
              handleEvent({ type: 'create', data: fromSupabaseOrder(event.data) });
            }
          } else if (event.type === 'update') {
            handleEvent({ type: 'update', data: fromSupabaseOrder(event.data) });
          } else handleEvent(event);
        })
      : null;
    // Timer único (30s) para atualizar todos os cronômetros da lista
    const timer = setInterval(() => setTick(t => t + 1), 30000);
    return () => {
      unsub?.();
      clearInterval(timer);
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    };
  }, []);

  // Ao sair de "hoje", busca histórico amplo uma vez e filtra por dia.
  // Voltar para hoje retoma a lista tempo real.
  useEffect(() => {
    if (isToday(selectedDate)) {
      setDayOrders(null);
      setDayError(null);
      return;
    }
    if (!company) return;
    let cancelled = false;
    setDayLoading(true);
    setDayError(null);
    const cid = companyIdRef.current || company.id;
    listOrdersWithItems(supabase, cid, 500)
      .then(ords => { if (!cancelled) setDayOrders(ords); })
      .catch(() => { if (!cancelled) setDayError('Não foi possível carregar os pedidos deste dia.'); })
      .finally(() => { if (!cancelled) setDayLoading(false); });
    return () => { cancelled = true; };
  }, [selectedDate, company?.id]);

  // Pedidos novos aguardando aceitação (card + modal; hook antes de
  // qualquer return antecipado). Contagem sobre o carregado, sem alterar
  // status nem duplicar pedidos.
  const novos = useMemo(
    () => filterNovosOrders(orders),
    [orders],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-border border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (!company) return null;

  const ordersToday = orders.filter(o => o.created_date && isToday(new Date(o.created_date)));
  const inProgress = orders.filter(o => ['novo', 'confirmado', 'em_preparo', 'aguardando_retirada', 'saiu_entrega'].includes(o.status));
  const finished = orders.filter(o => o.status === 'finalizado');
  // Mesmas regras que o Kanban usava (orderQueue: fila + atraso >30min).
  const inQueue = getQueueOrders(orders);
  const delayed = getDelayedOrders(orders);
  const canceled = getCanceled(orders);
  const hasNovo = orders.some(o => o.status === 'novo');
  const finDelivery = getFinalizedByType(orders, 'delivery');
  const finRetirada = getFinalizedByType(orders, 'retirada');
  const finMesa = getFinalizedByType(orders, 'mesa');
  const finDeliveryFiltered = filterByDriver(finDelivery, driverFilter);

  const viewingToday = isToday(selectedDate);
  const dayLabel = formatDayLabel(selectedDate);
  const canGoForward = !isFutureDay(addDaysLocal(selectedDate, 1)) && !isSameDay(selectedDate, new Date());

  // Últimos pedidos: ativos primeiro (ordem de chegada, sem reordenar por
  // status), depois finalizados (pela conclusão), por fim cancelados.
  // Usa created_date para chegada e o histórico para o momento da transição
  // terminal; nunca o número do pedido como substituto da data.
  const terminalAt = (order, status) => {
    const h = order.status_history || [];
    for (let i = h.length - 1; i >= 0; i--) {
      const s = h[i]?.status || h[i]?.new_status;
      if (s === status) {
        const t = new Date(h[i]?.timestamp || h[i]?.created_at).getTime();
        if (t > 0) return t;
      }
    }
    return 0;
  };
  const arrivalAt = (o) => new Date(o.created_date).getTime() || 0;
  const groupRank = (s) => (s === 'finalizado' ? 1 : s === 'cancelado' ? 2 : 0);
  const dayBase = dayOrders ?? orders;
  const dayFiltered = viewingToday ? dayBase : filterByDay(dayBase, selectedDate);
  const recentOrders = [...dayFiltered]
    .sort((a, b) => {
      const ga = groupRank(a.status);
      const gb = groupRank(b.status);
      if (ga !== gb) return ga - gb;
      if (ga === 1) return (terminalAt(b, 'finalizado') || arrivalAt(b)) - (terminalAt(a, 'finalizado') || arrivalAt(a));
      if (ga === 2) return (terminalAt(b, 'cancelado') || arrivalAt(b)) - (terminalAt(a, 'cancelado') || arrivalAt(a));
      return arrivalAt(b) - arrivalAt(a);
    })
    .slice(0, 8);

  const queueCards = [
    { icon: ShoppingBag, label: 'Na fila', value: inQueue.length, color: 'text-blue-600', bg: 'bg-blue-50', ariaLabel: `Ver pedidos na fila (${inQueue.length})`, modal: 'fila' },
    { icon: AlertTriangle, label: 'Em atraso', value: delayed.length, color: 'text-red-600', bg: 'bg-red-50', ariaLabel: `Ver pedidos em atraso (${delayed.length})`, modal: 'atraso' },
  ];

  // Compactos: Novos primeiro; Pedidos hoje (só hoje); demais sobre o
  // carregado (como antes).
  const todayCards = [
    { icon: BellRing, label: 'Novos pedidos', value: novos.length, color: 'text-amber-600', bg: 'bg-amber-50', ariaLabel: `Ver novos pedidos aguardando (${novos.length})`, modal: 'novos' },
    { icon: ShoppingBag, label: 'Pedidos hoje', value: ordersToday.length, color: 'text-blue-600', bg: 'bg-blue-50', ariaLabel: `Ver pedidos de hoje (${ordersToday.length})`, modal: 'hoje' },
    { icon: Clock, label: 'Em andamento', value: inProgress.length, color: 'text-orange-600', bg: 'bg-orange-50', ariaLabel: `Ver em andamento (${inProgress.length})`, modal: 'andamento' },
    { icon: CheckCircle, label: 'Finalizados', value: finished.length, color: 'text-green-600', bg: 'bg-green-50', ariaLabel: `Ver finalizados (${finished.length})`, modal: 'finalizados' },
    { icon: XCircle, label: 'Cancelados', value: canceled.length, color: 'text-red-600', bg: 'bg-red-50', ariaLabel: `Ver cancelados (${canceled.length})`, modal: 'cancelados' },
  ];

  const finCards = [
    { label: 'Entregas', value: finDelivery.length, modal: 'finDelivery' },
    { label: 'Retiradas', value: finRetirada.length, modal: 'finRetirada' },
    { label: 'Mesas', value: finMesa.length, modal: 'finMesa' },
  ];

  const { title: modalTitle, orders: modalOrders } = getDashboardModal(queueModal, {
    delayed, novos, ordersToday, inProgress, finished, canceled,
    finDeliveryFiltered, finRetirada, finMesa, inQueue,
  });

  const driverOptions = Object.values(driversById);

  return (
    <div className="space-y-8 w-full max-w-full min-w-0">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-foreground">{company.name}</h1>
          <p className="text-sm text-muted-foreground">{company.slogan || 'Bem-vindo de volta!'}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to={`/cardapio/${company.slug}`}>
              <Store className="h-4 w-4 mr-2" /> Ver cardápio
            </Link>
          </Button>
          <Button asChild size="sm" className="bg-primary hover:bg-primary/90">
            <Link to="/pdv">
              <Banknote className="h-4 w-4 mr-2" /> PDV
            </Link>
          </Button>
          <button
            type="button"
            onClick={() => canToggleOpen && setConfirmOpenClose(true)}
            disabled={!canToggleOpen}
            title={canToggleOpen ? (company.is_open ? 'Fechar restaurante' : 'Abrir restaurante') : 'Somente OWNER/ADMIN podem alterar'}
            aria-label={company.is_open ? 'Restaurante aberto — clique para fechar' : 'Restaurante fechado — clique para abrir'}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${company.is_open ? 'bg-green-50 text-green-700 hover:bg-green-100' : 'bg-red-50 text-red-700 hover:bg-red-100'} ${canToggleOpen ? 'cursor-pointer' : 'cursor-not-allowed opacity-70'}`}
          >
            <span className={`h-2 w-2 rounded-full ${company.is_open ? 'bg-green-500' : 'bg-red-500'}`} />
            {company.is_open ? '🟢 Aberto' : '🔴 Fechado'}
          </button>
          <ConfirmDialog
            open={confirmOpenClose}
            onOpenChange={setConfirmOpenClose}
            title={company.is_open ? 'Fechar restaurante?' : 'Abrir restaurante?'}
            description={company.is_open
              ? 'Novos pedidos online deixarão de ser aceitos. O PDV interno continua funcionando.'
              : 'O restaurante voltará a aceitar pedidos online.'}
            confirmLabel={company.is_open ? 'Fechar restaurante' : 'Abrir restaurante'}
            onConfirm={async () => {
              if (togglingOpen) return;
              setTogglingOpen(true);
              try {
                const next = !company.is_open;
                await sbUpdateCompany(supabase, company.id, { is_open: next });
                setCompany(prev => (prev ? { ...prev, is_open: next } : prev));
                toast({ title: next ? 'Restaurante aberto!' : 'Restaurante fechado.' });
                setConfirmOpenClose(false);
              } catch (err) {
                toast({ title: 'Erro ao alterar status', description: err?.message, variant: 'destructive' });
              } finally {
                setTogglingOpen(false);
              }
            }}
          />
        </div>
      </div>

      {/* Stats compactos (inclui Novos pedidos; bloco destacado removido) */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        {[...todayCards, ...queueCards].map((s) => {
          const isAlertCard = isNovosAlertCard(hasNovo, s.label);
          return (
          <button
            key={s.modal || s.label}
            type="button"
            onClick={() => (s.modal ? setQueueModal(s.modal) : navigate('/pedidos'))}
            aria-label={s.ariaLabel}
            className={`w-full rounded-2xl border bg-card p-4 text-left cursor-pointer transition-all hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${isAlertCard ? 'border-red-500 hover:border-red-600' : 'border-border hover:border-primary/50'}`}
          >
            <div className="flex items-center gap-3">
              <div className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${isAlertCard ? 'bg-red-100' : s.bg}`}>
                <s.icon className={`h-4 w-4 ${isAlertCard ? 'text-red-600' : s.color}`} />
                {isAlertCard && <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-red-600 animate-pulse" />}
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground truncate">{s.label}</p>
                <p className="font-heading text-xl font-bold text-foreground leading-tight">{s.value}</p>
              </div>
            </div>
          </button>
          );
        })}
      </div>

      {/* Finalizados por tipo */}
      <div className="grid gap-3 grid-cols-3">
        {finCards.map((s) => (
          <button
            key={s.modal}
            type="button"
            onClick={() => { setDriverFilter('all'); setQueueModal(s.modal); }}
            aria-label={`Ver ${s.label.toLowerCase()} finalizadas (${s.value})`}
            className="w-full rounded-2xl border border-border bg-card p-4 text-left cursor-pointer transition-all hover:border-primary/50 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <p className="text-xs text-muted-foreground truncate">{s.label}</p>
            <p className="font-heading text-xl font-bold text-foreground leading-tight mt-0.5">{s.value}</p>
          </button>
        ))}
      </div>

      <OrdersListModal
        open={queueModal !== null}
        onClose={(order) => {
          setQueueModal(null);
          if (order?.id) setSelectedOrder(order);
        }}
        title={modalTitle}
        orders={modalOrders}
        headerExtra={queueModal === 'finDelivery' ? (
          <div className="flex items-center gap-2">
            <Bike className="h-4 w-4 text-muted-foreground shrink-0" />
            <Select value={driverFilter} onValueChange={setDriverFilter}>
              <SelectTrigger className="flex-1"><SelectValue placeholder="Entregador" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="none">Sem entregador</SelectItem>
                {driverOptions.map(d => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      />

      {/* Two columns */}
      <div className="grid gap-6 lg:grid-cols-3 min-w-0">
        {/* Recent orders */}
        <div className="lg:col-span-2 w-full max-w-full min-w-0 overflow-hidden rounded-2xl border border-border bg-card p-4 sm:p-6">
          <div className="flex items-center justify-between gap-2 mb-4">
            <h2 className="font-heading font-semibold text-foreground">Últimos pedidos</h2>
            <div className="flex items-center gap-1 shrink-0" role="group" aria-label="Navegar entre dias">
              <Button
                variant="ghost" size="icon" className="h-9 w-9"
                aria-label="Dia anterior"
                onClick={() => setSelectedDate(d => addDaysLocal(d, -1))}
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <span className="text-xs font-medium text-muted-foreground whitespace-nowrap min-w-[7rem] text-center" aria-live="polite">
                📅 {dayLabel}
              </span>
              <Button
                variant="ghost" size="icon" className="h-9 w-9"
                aria-label="Próximo dia"
                disabled={!canGoForward}
                onClick={() => setSelectedDate(d => addDaysLocal(d, 1))}
              >
                <ChevronRight className="h-5 w-5" />
              </Button>
            </div>
          </div>
          {dayLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-8 h-8 border-4 border-border border-t-primary rounded-full animate-spin" aria-label="Carregando pedidos do dia" />
            </div>
          ) : dayError ? (
            <div className="text-center py-12">
              <p className="font-medium text-foreground">Erro ao carregar</p>
              <p className="text-sm text-muted-foreground mt-1">{dayError}</p>
              <Button variant="outline" size="sm" className="mt-4" onClick={() => setSelectedDate(d => new Date(d.getTime()))}>
                Tentar novamente
              </Button>
            </div>
          ) : dayFiltered.length === 0 ? (
            <div className="text-center py-12">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
                <Package className="h-7 w-7 text-muted-foreground" />
              </div>
              <p className="font-medium text-foreground">{viewingToday ? 'Nenhum pedido ainda' : '📦 Nenhum pedido neste dia'}</p>
              <p className="text-sm text-muted-foreground mt-1">{viewingToday ? 'Compartilhe seu cardápio para receber o primeiro pedido.' : 'Tente outro dia ou volte para hoje.'}</p>
              {viewingToday ? (
                <Button asChild variant="outline" size="sm" className="mt-4">
                  <Link to={`/cardapio/${company.slug}`}>Ver cardápio <ArrowRight className="h-4 w-4 ml-2" /></Link>
                </Button>
              ) : (
                <Button variant="outline" size="sm" className="mt-4" onClick={() => setSelectedDate(startOfDay(new Date()))}>
                  Voltar para hoje
                </Button>
              )}
            </div>
          ) : orders.length === 0 ? (
            <div className="text-center py-12">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
                <ShoppingBag className="h-7 w-7 text-muted-foreground" />
              </div>
              <p className="font-medium text-foreground">Nenhum pedido ainda</p>
              <p className="text-sm text-muted-foreground mt-1">Compartilhe seu cardápio para receber o primeiro pedido.</p>
              <Button asChild variant="outline" size="sm" className="mt-4">
                <Link to={`/cardapio/${company.slug}`}>Ver cardápio <ArrowRight className="h-4 w-4 ml-2" /></Link>
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {recentOrders.map(order => {
                const st = STATUS_CONFIG[order.status] || STATUS_CONFIG.novo;
                const isNovo = order.status === 'novo';
                const who = order.order_type === 'mesa' && order.table_number ? `Mesa ${order.table_number}` : (order.customer_name || '—');
                return (
                  <button
                    key={order.id}
                    type="button"
                    onClick={() => setSelectedOrder(order)}
                    aria-label={`Ver pedido ${order.order_number} de ${who}`}
                    className={`flex w-full min-w-0 items-center justify-between gap-2 sm:gap-3 rounded-xl border p-3 text-left cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${isNovo ? 'border-red-500 bg-red-50/60 hover:bg-red-50 hover:border-red-600' : 'border-border hover:bg-muted/50 hover:border-primary/50'} ${highlightId === order.id ? 'ring-2 ring-red-500 border-red-600' : ''}`}
                  >
                    <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                      {isNovo ? (
                        <div className="shrink-0 whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-bold bg-red-600 text-white">NOVO</div>
                      ) : (
                        <div className={`shrink-0 whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-medium ${st.cls}`}>{st.label}</div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className={`truncate ${isNovo ? 'font-heading font-bold text-red-700' : 'font-medium text-foreground'}`}>#{order.order_number} • {who}</p>
                        <p className="text-xs text-muted-foreground truncate">{order.items?.length || 0} {order.items?.length === 1 ? 'item' : 'itens'} • {timeSince(order.created_date)}</p>
                      </div>
                    </div>
                    <p className="font-semibold text-foreground shrink-0 whitespace-nowrap ml-2">{fmtCurrency(order.total)}</p>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Products summary */}
        <div className="w-full max-w-full min-w-0 overflow-hidden rounded-2xl border border-border bg-card p-4 sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-heading font-semibold text-foreground">Cardápio</h2>
            <Package className="h-5 w-5 text-muted-foreground" />
          </div>
          {products.length === 0 ? (
            <div className="text-center py-8">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
                <Package className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">Nenhum produto cadastrado</p>
              <p className="text-xs text-muted-foreground mt-1">Adicione produtos ao seu cardápio.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {products.slice(0, 5).map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => navigate('/gestao-produtos')}
                  aria-label={`Gerenciar produto ${p.name}`}
                  className="flex w-full min-w-0 items-center gap-3 rounded-lg p-2 text-left cursor-pointer transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {p.image_url ? (
                    <Image src={p.image_url} fittingType="fill" className="h-10 w-10 rounded-lg shrink-0" alt={p.name} />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted shrink-0">
                      <Package className="h-5 w-5 text-muted-foreground" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground truncate">{p.name}</p>
                    <p className="text-xs text-muted-foreground">{p.available ? 'Disponível' : 'Indisponível'}</p>
                  </div>
                  <p className="text-sm font-semibold text-foreground shrink-0 whitespace-nowrap">{fmtCurrency(p.price)}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

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
      <PdvAnnouncement open={showPdvNews} userId={sbUser?.id} onClose={() => setShowPdvNews(false)} />
      {selectedOrder && (
        <OrderModal
          order={selectedOrder}
          isOpen={!!selectedOrder}
          company={company}
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
    </div>
  );
}