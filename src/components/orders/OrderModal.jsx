import React, { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Image } from '@/components/ui/image';
import { Bike, Store, Table2, Phone, MapPin, Receipt, Clock, Pencil, X, Check, ArrowRight, ArrowLeft, Undo2, Package, Plus, Search, ShoppingBag, UtensilsCrossed, Printer, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import RouteModal from '@/components/orders/RouteModal';
import PrintPromptModal from '@/components/orders/PrintPromptModal';
import { normalizePrintSettings, markPrinted } from '@/lib/printSettings';
import { decidePrintTrigger, openPrintWindow, printUrl, PRINT_FAILURE_MESSAGE } from '@/lib/printTrigger';
import { formatAddress, resolveAdvanceFlow } from '@/lib/deliveryRoute';
import { groupComplements, isFreeComplement, itemsComplementsTotal, itemNavState } from '@/lib/orderItemView';
import { listDrivers } from '@/api/team';
import { assignDriver as sbAssignDriver } from '@/api/orders';
import { supabase, isSupabaseConfigured } from '@/api/supabaseClient';
import { useSupabaseAuth } from '@/lib/SupabaseAuthContext';
import { listCustomers as sbListCustomers } from '@/api/customers';
import { editOrder as sbEditOrder, getOrderDetail as sbGetOrderDetail, listOrdersWithItems as sbListOrdersWithItems, linkOrderCustomer as sbLinkCustomer, linkOrderTable as sbLinkTable, setComandaName as sbSetComanda } from '@/api/orders';
import { queueDriverNotifyForStatus, getDriverNotification, markDriverNotified as sbMarkNotified } from '@/api/driverNotifications';
import { buildDriverDeliveryUrl } from '@/lib/driverMessage';
import { getDriver as sbGetDriver } from '@/api/team';
import { isComandaEditable, resolveComandaName } from '@/lib/comanda';
import { filterLinkCustomers, resolveCustomerEnter } from '@/lib/linkEnter';
import { createLinkOpTracker } from '@/lib/linkOp';
import { listProducts as sbListProducts } from '@/api/catalog';
import { listDependenciesWithNames as sbListDependencies } from '@/api/configurator';
import { checkCartDependencies, buildDepModesFromProducts } from '@/lib/productDependencies';
import { getCompanySettings as sbGetSettings } from '@/api/company';
import { useToast } from '@/components/ui/use-toast';
import { changeOrderStatus, getAvailableActions, getNextStatus, STATUS_LABELS } from '@/lib/orderStatusFlow';
import { resolveAdvanceTarget, resolveRegressTarget, shouldAutoCloseOnAction, listStages as sbListStages } from '@/api/orderStages';

const fmtCurrency = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);

const STATUS_PILL = {
  novo: 'bg-blue-100 text-blue-700',
  confirmado: 'bg-yellow-100 text-yellow-700',
  em_preparo: 'bg-orange-100 text-orange-700',
  aguardando_retirada: 'bg-purple-100 text-purple-700',
  saiu_entrega: 'bg-indigo-100 text-indigo-700',
  finalizado: 'bg-green-100 text-green-700',
  cancelado: 'bg-red-100 text-red-700',
};

// Colapsa transições consecutivas iguais (ex.: Confirmado, Confirmado → Confirmado).
// Eventos de status diferentes são sempre preservados.
function collapseConsecutiveStatuses(history) {
  if (!Array.isArray(history)) return [];
  return history.filter((h, i) => i === 0 || h?.status !== history[i - 1]?.status);
}

export default function OrderModal({ order, isOpen, onClose, onOrderUpdated, onCancel, onSelectOrder, company, driver, onRequestPayment, stages = null, stageName = '' }) {
  const { toast } = useToast();
  // FASE 5.4: edição via adapter Supabase quando há sessão; leituras
  // Leituras auxiliares (fotos/histórico) via adapters Supabase.
  const { user: sbUser } = useSupabaseAuth();
  const sbActive = isSupabaseConfigured() && !!sbUser;
  const [editMode, setEditMode] = useState(false);
  const [editData, setEditData] = useState(null);
  const [saving, setSaving] = useState(false);
  const [statusAction, setStatusAction] = useState(null);
  const [photoMap, setPhotoMap] = useState({});
  const [custHistory, setCustHistory] = useState([]);
  const [custStats, setCustStats] = useState(null);
  const [histOk, setHistOk] = useState(false);
  const [extraLoading, setExtraLoading] = useState(false);
  const statusBusyRef = useRef(false);
  const [showPicker, setShowPicker] = useState(false);
  const [menuProducts, setMenuProducts] = useState([]);
  const [menuSearch, setMenuSearch] = useState('');
  const [menuLoading, setMenuLoading] = useState(false);
  // Gate 3: regras de dependência da empresa (validação UX antes do
  // servidor; o servidor continua sendo a autoridade final).
  const [depRules, setDepRules] = useState([]);
  // FASE 5.4 UX: modal de rota (só delivery, endereço clicável).
  const [routeOpen, setRouteOpen] = useState(false);
  // FASE 5.5-B3: passo de atribuição de entregador (delivery → saiu_entrega).
  const [assignStep, setAssignStep] = useState(null);
  // Confirmação quando já há entregador vinculado (manter/alterar/cancelar).
  const [keepStep, setKeepStep] = useState(null);
  const [drivers, setDrivers] = useState([]);
  const [selectedDriver, setSelectedDriver] = useState('');
  const [assigning, setAssigning] = useState(false);
  // UX Kanban: gerenciar entregador direto no pedido (alterar/remover).
  const [managingDriver, setManagingDriver] = useState(false);
  // Vínculos de balcão: cliente e mesa (sem recriar o pedido).
  // Aviso ao entregador (WhatsApp manual): pendente criado na saída para
  // entrega; o envio é um clique explícito (nunca automático, sem provedor).
  const [notifyPrompt, setNotifyPrompt] = useState(null);
  const [notifyBusy, setNotifyBusy] = useState(false);
  const [notifyMsg, setNotifyMsg] = useState('');
  const notifyShownRef = useRef('');
  // Nome da comanda: texto livre p/ retirada sem cliente (sem cadastro).
  const [linking, setLinking] = useState(null);
  // Identidade de operação dos vínculos (condição de corrida): uma
  // operação antiga nunca fecha seção aberta depois (ver linkOp.js).
  const linkOpRef = useRef(null);
  const linkOp = () => linkOpRef.current || (linkOpRef.current = createLinkOpTracker());
  const [comandaDraft, setComandaDraft] = useState('');
  const [custQuery, setCustQuery] = useState('');
  const [custResults, setCustResults] = useState([]);
  const [custSelected, setCustSelected] = useState('');
  const [tableList, setTableList] = useState([]);
  const [tableSelected, setTableSelected] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);
  const [defaultDriverId, setDefaultDriverId] = useState(null);
  // Impressão pós-aceite: mesma decisão do Kanban (printTrigger). Manual =
  // só o botão "Imprimir pedido"; confirm/auto = PrintPromptModal.
  const [printCfg, setPrintCfg] = useState({ mode: 'manual', stages: [], width: '80' });
  const [printPrompt, setPrintPrompt] = useState(null);
  // Stages reais para a DECISÃO de impressão (paridade com o Kanban).
  // Usadas SÓ aqui: ações do modal seguem o fluxo existente (stages prop).
  const [printStages, setPrintStages] = useState(null);
  // Config de impressão carregada? Se o aceite for mais rápido que a carga,
  // a decisão abaixo recarrega na hora (nunca usa o padrão manual à toa).
  const printCfgLoadedRef = useRef(false);
  const [manageList, setManageList] = useState([]);
  const [manageSelected, setManageSelected] = useState('');
  const [manageBusy, setManageBusy] = useState(false);

  // Histórico do pedido: recolhido por padrão (expande/recolhe sem perder dados).
  const [historyOpen, setHistoryOpen] = useState(false);

  // Histórico do cliente: recolhido por padrão, independente do histórico
  // do pedido (expandir um nunca abre/fecha o outro).
  const [custHistoryOpen, setCustHistoryOpen] = useState(false);
  // Itens: recolhe acima de 3; detalhe do item e resumo financeiro em
  // painéis secundários (nunca trocam de pedido).
  const [itemsOpen, setItemsOpen] = useState(false);
  const [selectedItemIdx, setSelectedItemIdx] = useState(null);
  const [summaryOpen, setSummaryOpen] = useState(false);

  // Fotos dos produtos + histórico do cliente (2 consultas, com cancelamento).
  useEffect(() => {
    if (!order || !isOpen) return;
    let cancelled = false;
    setEditMode(false);
    setAssignStep(null);
    setKeepStep(null);
    setManagingDriver(false);
    setLinking(null);
    linkOp().reset();
    setCustQuery('');
    setCustResults([]);
    setTableList([]);
    setStatusAction(null);
    setPrintPrompt(null);
    setComandaDraft('');
    setHistoryOpen(false);
    setCustHistoryOpen(false);
    setItemsOpen(false);
    setSelectedItemIdx(null);
    setSummaryOpen(false);
    setNotifyPrompt(null);
    setNotifyMsg('');
    notifyShownRef.current = '';
    statusBusyRef.current = false;
    setPhotoMap({});
    setCustHistory([]);
    setCustStats(null);
    setHistOk(false);
    setExtraLoading(true);

    const load = async () => {
      try {
        const productIds = [...new Set((order.items || []).map(i => i.product_id).filter(Boolean))];

        // Fotos: consulta isolada — catálogo da mesma empresa em 1 query (RLS).
        try {
          const products = productIds.length > 0
            ? (await sbListProducts(supabase, order.company_id)).filter(p => productIds.includes(p.id))
            : [];
          if (!cancelled) {
            const map = {};
            products.forEach(p => { if (p.image_url) map[p.id] = p.image_url; });
            setPhotoMap(map);
          }
        } catch (err) { /* fotos são opcionais */ }

        // Histórico do cliente via adapter (com itens); estatísticas
        // derivadas da lista (orders_count/total_spent não existem no schema).
        const [allOrders] = await Promise.all([
          (order.customer_id || order.customer_phone)
            ? sbListOrdersWithItems(supabase, order.company_id, 50).catch(() => [])
            : Promise.resolve([]),
        ]);
        if (cancelled) return;
        const mine = (allOrders || []).filter(h =>
          h.id !== order.id && (
            (order.customer_id && h.customer_id === order.customer_id) ||
            (!order.customer_id && order.customer_phone && (h.customer_phone === order.customer_phone || h.customer_data?.phone === order.customer_phone))
          )).slice(0, 5);
        setHistOk(true);
        setCustHistory(mine);
        if (mine.length > 0 || order.customer_id || order.customer_phone) {
          const prevTotal = mine.reduce((s, h) => s + (Number(h.total) || 0), 0);
          setCustStats({ count: mine.length + 1, total: prevTotal + (Number(order.total) || 0) });
        }
      } catch (err) { /* seções extras são opcionais */ }
      finally { if (!cancelled) setExtraLoading(false); }
    };
    load();
    return () => { cancelled = true; };
  }, [order?.id, isOpen]);

  // Vínculos: recarrega o detalhe (itens/totais preservados pela API).
  // Fecha a seção SOMENTE se nenhuma navegação ocorreu desde o início da
  // operação (opId); dados e toast sempre aplicam.
  const reloadAfterLink = async (okMsg, opId) => {
    try {
      const detail = await sbGetOrderDetail(supabase, order.company_id, order.id);
      onOrderUpdated(detail || order);
    } catch {
      onOrderUpdated(order);
    }
    toast({ title: okMsg });
    if (opId === undefined || linkOp().shouldClose(opId)) setLinking(null);
  };

  const openLinkCustomer = async () => {
    setCustQuery('');
    setCustSelected(order.customer_id || '');
    linkOp().userNavigated();
    try {
      const list = await sbListCustomers(supabase, order.company_id);
      setCustResults(list || []);
    } catch {
      setCustResults([]);
    }
    setLinking('customer');
  };

  const openLinkTable = async () => {
    setTableSelected(order.table_id || '');
    linkOp().userNavigated();
    try {
      const { data } = await supabase.from('dining_tables')
        .select('id,name,active').eq('company_id', order.company_id).eq('active', true)
        .order('name');
      setTableList(data || []);
    } catch {
      setTableList([]);
    }
    setLinking('table');
  };

  // Confirmação do vínculo de cliente (botão + Enter): validações do fluxo
  // (escolha na lista + confirmação explícita). Guarda anti-duplo.
  const confirmLinkCustomer = async () => {
    if (linkBusy) return;
    const opId = linkOp().beginOp();
    setLinkBusy(true);
    try {
      const chosen = custResults.find((c) => c.id === custSelected);
      if (!chosen) throw new Error('Escolha um cliente da lista');
      if (!window.confirm(`Vincular "${chosen.name || 'sem nome'}" a este pedido?`)) return;
      await sbLinkCustomer(supabase, order.id, order.company_id, chosen.id);
      await reloadAfterLink('Cliente vinculado!', opId);
    } catch (err) {
      toast({ title: 'Erro ao vincular', description: err?.message, variant: 'destructive' });
    } finally {
      setLinkBusy(false);
    }
  };

  // Enter na busca: confirma o destacado ou seleciona o único inequívoco
  // (só destaca; salvar passa pelas validações do Confirmar vínculo).
  const handleCustomerSearchEnter = () => {
    if (linkBusy) return;
    const r = resolveCustomerEnter({ results: custResults, query: custQuery, custSelected, busy: linkBusy });
    if (r.action === 'select') {
      setCustSelected(r.id);
      return;
    }
    if (r.action === 'confirm') {
      void confirmLinkCustomer();
    }
  };

  // Salvamento do nome da comanda (botão + Enter): texto livre no snapshot
  // do pedido; nunca toca em customers. Guarda anti-duplo.
  const saveComandaName = async () => {
    if (linkBusy) return;
    const opId = linkOp().beginOp();
    setLinkBusy(true);
    try {
      await sbSetComanda(supabase, order.id, order.company_id, comandaDraft);
      await reloadAfterLink(comandaDraft.trim() ? 'Nome da comanda salvo!' : 'Nome da comanda removido.', opId);
    } catch (err) {
      toast({ title: 'Erro ao salvar', description: err?.message, variant: 'destructive' });
    } finally {
      setLinkBusy(false);
    }
  };

  // Motoboy padrão + config de impressão + stages reais da empresa (selo
  // "Padrão", decisão de impressão pós-aceite com paridade Kanban; falha
  // nunca quebra o modal).
  useEffect(() => {
    if (!order || !isOpen || !sbActive) {
      setDefaultDriverId(null);
      return;
    }
    let cancelled = false;
    printCfgLoadedRef.current = false;
    sbGetSettings(supabase, order.company_id)
      .then(s => {
        if (cancelled) return;
        setDefaultDriverId(s?.settings?.default_driver_id || null);
        setPrintCfg(normalizePrintSettings(s?.settings?.print));
        printCfgLoadedRef.current = true;
      })
      .catch(() => { if (!cancelled) { setPrintCfg({ mode: 'manual', stages: [], width: '80' }); printCfgLoadedRef.current = true; } });
    // Só para a decisão de impressão (ações do modal não mudam).
    sbListStages(supabase, order.company_id)
      .then(list => { if (!cancelled) setPrintStages(list && list.length > 0 ? list : null); })
      .catch(() => { if (!cancelled) setPrintStages(null); });
    return () => { cancelled = true; };
  }, [order?.id, order?.company_id, isOpen, sbActive]);

  // Ao abrir um pedido já em rota (ex.: avançado pelo Kanban), oferece o
  // aviso se houver pendente/iniciado para o entregador atual. Uma vez por
  // abertura; falha de leitura nunca quebra o modal. Antes de qualquer
  // return antecipado (regras dos Hooks).
  useEffect(() => {
    if (!isOpen || !order || order.order_type !== 'delivery' || order.status !== 'saiu_entrega' || !sbActive) return;
    const key = `${order.id}:${order.driver_id || '-'}`;
    if (notifyShownRef.current === key) return;
    notifyShownRef.current = key;
    (async () => {
      try {
        const rec = await getDriverNotification(supabase, order.company_id, order.id, order.driver_id || null);
        if (rec && (rec.status === 'pendente' || rec.status === 'iniciado')
            && (order.driver_id == null || rec.driver_id === order.driver_id)) {
          setNotifyPrompt({ driverId: order.driver_id || null });
          setNotifyMsg('');
        }
      } catch { /* sem prompt, sem quebrar */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, order?.id, order?.status, order?.driver_id, sbActive]);

  if (!order) return null;

  // FASE 1: com stages configuráveis, avançar/voltar navega UMA etapa por vez
  // (traduzida para o status legado); sem stages, fluxo legado intacto.
  const hasStages = Array.isArray(stages) && stages.length > 0;
  const advanceTarget = hasStages ? resolveAdvanceTarget(stages, order) : null;
  const regressTarget = hasStages ? resolveRegressTarget(stages, order) : null;
  const legacyActions = getAvailableActions(order);
  let actions;
  let primaryAction;
  let regressAction = null;
  let cancelAction;
  if (hasStages) {
    actions = [];
    if (order.status === 'novo' && advanceTarget) {
      actions.push({ id: 'accept', label: 'Aceitar pedido', next: advanceTarget.targetStatus });
    } else if (advanceTarget) {
      actions.push({ id: 'advance', label: `Avançar para ${advanceTarget.targetStage.name}`, next: advanceTarget.targetStatus });
    }
    if (regressTarget) {
      regressAction = { id: 'regress', label: `Voltar para ${regressTarget.targetStage.name}`, next: regressTarget.targetStatus };
    }
    cancelAction = (order.status === 'finalizado' || order.status === 'cancelado') ? null : { id: 'cancel' };
    primaryAction = actions[0] || null;
  } else {
    actions = legacyActions;
    primaryAction = actions.find(a => a.id === 'accept' || a.id === 'advance');
    // Caminho legado também conhece o próximo status (sem regresso explícito).
    if (!hasStages && primaryAction && !primaryAction.next) {
      primaryAction = { ...primaryAction, next: getNextStatus(order) };
    }
    cancelAction = actions.find(a => a.id === 'cancel');
  }

  const runStatusAction = async (action) => {
    if (statusBusyRef.current) return;
    statusBusyRef.current = true;
    setStatusAction(action.id);
    try {
      const updated = await changeOrderStatus(order.id, action.next);
      // FASE 1: a RPC retorna a linha sem items/history; recarrega o detalhe
      // para o modal exibir o histórico atualizado (sem isso, o merge no
      // Kanban preservaria o histórico antigo e a timeline ficaria defasada).
      let detail = null;
      try {
        detail = await sbGetOrderDetail(supabase, order.company_id, order.id);
      } catch {
        detail = null;
      }
      const merged = detail || updated;
      onOrderUpdated(merged);
      toast({ title: action.id === 'accept' ? 'Pedido confirmado!' : `Pedido: ${STATUS_LABELS[action.next] || action.next}` });
      // Saída para entrega (delivery): registra o aviso pendente e oferece
      // o envio manual. Nunca bloqueia, nunca duplica, nunca reverte status.
      if (action.next === 'saiu_entrega' && (merged?.order_type || order?.order_type) === 'delivery') {
        const co = merged?.company_id || order?.company_id;
        const did = merged?.driver_id ?? order?.driver_id ?? null;
        if (co && sbActive) {
          queueDriverNotifyForStatus(supabase, co, { ...(merged || order), driver_id: did }, 'saiu_entrega').catch(() => {});
        }
        setNotifyPrompt({ driverId: did });
        setNotifyMsg('');
      }
      // Impressão pós-aceite (mesma decisão do Kanban/fila): só após sucesso
      // confirmado, sem tocar de novo no status. Se a config ainda não
      // carregou, busca na hora (aceite rápido nunca cai no manual à toa).
      let cfg = printCfg;
      let printStagesForDecision = hasStages ? stages : printStages;
      if (!printCfgLoadedRef.current) {
        try {
          const s = await sbGetSettings(supabase, order.company_id);
          cfg = normalizePrintSettings(s?.settings?.print);
          setPrintCfg(cfg);
          printCfgLoadedRef.current = true;
        } catch { /* mantém a atual */ }
        if (!hasStages) {
          try {
            const l = await sbListStages(supabase, order.company_id);
            printStagesForDecision = l && l.length > 0 ? l : null;
            setPrintStages(printStagesForDecision);
          } catch { /* mantém */ }
        }
      }
      const d = decidePrintTrigger({
        printCfg: cfg, stages: printStagesForDecision, toStatus: action.next,
        orderId: merged?.id || order.id,
      });
      if (d.kind === 'none') {
        if (shouldAutoCloseOnAction(action.id)) onClose();
      } else {
        setPrintPrompt({
          orderId: merged?.id || order.id,
          orderNumber: merged?.order_number || order.order_number,
          stageId: d.stageId, stageName: d.stageName, url: d.url,
          autoClose: shouldAutoCloseOnAction(action.id),
        });
      }
      // FASE 1: concluiu a interação -> Kanban atualiza (realtime + merge).
      // Em erro, o modal permanece aberto (sem rollback necessário: nada
      // otimista foi aplicado aqui).
    } catch (err) {
      toast({ title: 'Erro ao atualizar pedido', description: err?.message, variant: 'destructive' });
    } finally {
      statusBusyRef.current = false;
      setStatusAction(null);
    }
  };

  // Reimpressão manual / nova tentativa: abre a rota dedicada, nunca altera
  // o status e nunca usa o dedupe (sempre permitida).
  const handleManualPrint = () => {
    const r = openPrintWindow(printUrl(order.id, stageName || order.status));
    if (!r.ok) {
      toast({ title: 'Falha na impressão', description: `${PRINT_FAILURE_MESSAGE[r.reason]} Tente de novo.`, variant: 'destructive' });
    }
  };

  const openAssignStep = async (action, preselected = '') => {
    try {
      const list = sbActive
        ? (await listDrivers(supabase, order.company_id)).filter(d => d.status === 'ativo')
        : [];
      setDrivers(list);
    } catch {
      setDrivers([]);
    }
    setSelectedDriver(preselected || order.driver_id || '');
    setAssignStep(action);
  };

  const handleStatusAction = async (action) => {
    // Delivery rumo a saiu_entrega: sem entregador → seletor; com entregador →
    // confirmação (manter/alterar/cancelar). Demais fluxos vão direto.
    if (!assignStep && !keepStep && resolveAdvanceFlow(order, action.next) !== 'direct') {
      if (resolveAdvanceFlow(order, action.next) === 'confirm') {
        setKeepStep(action);
        return;
      }
      await openAssignStep(action);
      return;
    }
    await runStatusAction(action);
  };

  const confirmDispatch = async (withDriver) => {
    const action = assignStep;
    setAssignStep(null);
    if (!action) return;
    setAssigning(true);
    try {
      if (withDriver && selectedDriver && sbActive) {
        await sbAssignDriver(supabase, order.id, order.company_id, selectedDriver);
      }
    } catch (err) {
      toast({ title: 'Entregador não atribuído', description: err?.message, variant: 'destructive' });
      return; // não avança sem atribuição válida quando o operador escolheu atribuir
    } finally {
      setAssigning(false);
    }
    await runStatusAction(action);
  };

  // Envio manual explícito: monta a mensagem do pedido persistido, abre o
  // wa.me e registra NO MÁXIMO "iniciado" (nunca "enviado"/confirmado).
  // Sem telefone válido: informa o motivo, sem enviar. Falha: mantém o
  // painel para reenvio controlado; o pedido segue intacto.
  const sendDriverNotify = async () => {
    const did = notifyPrompt?.driverId;
    if (!did || notifyBusy) return;
    setNotifyBusy(true);
    setNotifyMsg('');
    try {
      const [drv, detail] = await Promise.all([
        sbGetDriver(supabase, order.company_id, did).catch(() => null),
        sbGetOrderDetail(supabase, order.company_id, order.id).catch(() => null),
      ]);
      const full = detail || order;
      const url = buildDriverDeliveryUrl(full, drv || { phone: '' });
      await sbMarkNotified(supabase, order.company_id, {
        orderId: order.id, driverId: did,
        message: `Conversa aberta no painel (pedido #${full.order_number ?? ''}).`,
      });
      window.open(url, '_blank', 'noopener');
      toast({ title: 'WhatsApp aberto (envio manual)', description: 'Status: iniciado. A confirmação virá pela integração.' });
      setNotifyPrompt(null);
    } catch (err) {
      setNotifyMsg(err?.message || 'Não foi possível preparar o envio. Tente de novo.');
    } finally {
      setNotifyBusy(false);
    }
  };

  const startEdit = () => {
    setEditData({
      customer_address: order.customer_address || '',
      customer_number: order.customer_number || '',
      customer_complement: order.customer_complement || '',
      customer_neighborhood: order.customer_neighborhood || '',
      notes: order.notes || '',
      discount: order.discount || 0,
      items: order.items?.map(i => ({ ...i })) || []
    });
    setShowPicker(false);
    setMenuSearch('');
    setMenuLoading(true);
    // Cardápio da mesma empresa, só disponíveis (regra do createOrder)
    sbListProducts(supabase, order.company_id).catch(() => [])
      .then(list => setMenuProducts((list || []).filter(p => p.available && !p.out_of_stock)))
      .catch(() => setMenuProducts([]))
      .finally(() => setMenuLoading(false));
    // Dependências da mesma empresa (falha silenciosa: servidor revalida).
    sbListDependencies(supabase, order.company_id).then(setDepRules).catch(() => setDepRules([]));
    setEditMode(true);
  };

  const addProductToEdit = (product) => {
    const unitPrice = product.promotional_price != null ? Number(product.promotional_price) : Number(product.price);
    setEditData(prev => {
      const idx = prev.items.findIndex(i => i.product_id === product.id && !i.notes && (!i.complements || i.complements.length === 0));
      if (idx >= 0) {
        const next = [...prev.items];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
        return { ...prev, items: next };
      }
      return {
        ...prev,
        items: [...prev.items, {
          product_id: product.id,
          name: product.name,
          unit_price: unitPrice,
          price: unitPrice,
          quantity: 1,
          notes: '',
          complements: [],
        }],
      };
    });
  };

  const saveEdit = async () => {
    setSaving(true);
    try {
      // Gate 3: mensagem clara antes da rede, sem descartar a edição.
      // O servidor (manage_order) revalida de qualquer forma.
      const depErrors = checkCartDependencies(editData.items, depRules, buildDepModesFromProducts(menuProducts));
      if (depErrors.length > 0) {
        toast({ title: 'Item incompatível', description: depErrors[0].message, variant: 'destructive' });
        return;
      }
      await sbEditOrder(supabase, order.id, {
        items: editData.items.map(i => ({
          product_id: i.product_id,
          quantity: i.quantity,
          complements: i.complements || [],
          notes: i.notes || '',
        })),
        discount: Number(editData.discount) || 0,
        address: {
          street: editData.customer_address,
          number: editData.customer_number,
          complement: editData.customer_complement,
          neighborhood: editData.customer_neighborhood,
        },
        notes: editData.notes,
      });
      const detail = await sbGetOrderDetail(supabase, order.company_id, order.id);
      onOrderUpdated(detail || { ...order });
      setEditMode(false);
      toast({ title: 'Pedido atualizado' });
    } catch (err) {
      toast({ title: 'Erro ao editar pedido', description: err?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const updateItemQty = (idx, delta) => {
    setEditData(prev => {
      const newItems = [...prev.items];
      newItems[idx].quantity = Math.max(1, newItems[idx].quantity + delta);
      return { ...prev, items: newItems };
    });
  };

  const removeItem = (idx) => {
    setEditData(prev => ({ ...prev, items: prev.items.filter((_, i) => i !== idx) }));
  };

  const busy = saving || statusAction !== null;

  // Painel do item: navega SÓ entre itens deste pedido (nunca troca de pedido).
  const itemNav = itemNavState(selectedItemIdx, (order?.items || []).length);
  const selectedItem = itemNav.valid ? order.items[selectedItemIdx] : null;
  const selectedItemPhoto = selectedItem?.product_id ? photoMap[selectedItem.product_id] : null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-2xl max-h-[90vh] overflow-hidden p-0 gap-0 flex flex-col">
        <DialogHeader className="shrink-0 px-4 pt-3 sm:px-6 sm:pt-4">
          <button
            type="button"
            onClick={onClose}
            aria-label="Voltar ao Kanban"
            className="mb-1 inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
          >
            <ArrowLeft className="h-4 w-4" /> Voltar
          </button>
          <DialogTitle className="flex flex-wrap items-end justify-between gap-2 pr-6">
            <span>
              <span className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pedido</span>
              <span className="font-heading text-2xl font-bold">#{order.order_number}</span>
              {order.created_date && (
                <span className="block text-xs text-muted-foreground mt-0.5">
                  {new Date(order.created_date).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </span>
            <span className={`text-sm px-3 py-1.5 rounded-full font-semibold whitespace-nowrap ${STATUS_PILL[order.status] || STATUS_PILL.novo}`}>
              {stageName || STATUS_LABELS[order.status] || order.status}
            </span>
          </DialogTitle>
        </DialogHeader>

        {!editMode ? (
          <>
          <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-4 space-y-5">
            {/* Cliente + operação: duas colunas no desktop, empilhadas no mobile. */}
            <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl bg-muted/50 p-3.5 space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Cliente</p>
              <p className="font-heading text-xl font-bold text-foreground break-words">{order.customer_name}</p>
              {order.customer_id && order.status !== 'cancelado' && histOk &&
                !custHistory.some(h => h.status !== 'cancelado') && (
                <p title="Cliente identificado sem pedidos anteriores nesta empresa">
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800">
                    🥇 Primeiro pedido deste cliente
                  </span>
                </p>
              )}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                {order.customer_phone && (
                  <span className="flex items-center gap-1.5">
                    <Phone className="h-4 w-4 shrink-0" /> {order.customer_phone}
                  </span>
                )}
                <span className="flex items-center gap-1.5">
                  {order.order_type === 'delivery' && <><Bike className="h-4 w-4 shrink-0" /> Delivery</>}
                  {order.order_type === 'retirada' && <><Store className="h-4 w-4 shrink-0" /> Retirada</>}
                  {order.order_type === 'mesa' && <><Table2 className="h-4 w-4 shrink-0" /> Mesa {order.table_number}</>}
                </span>
              </div>
              {(custStats || custHistory.length > 0) && (
                <p className="text-xs text-muted-foreground pt-0.5">
                  {custStats
                    ? `Pedidos anteriores: ${Math.max(0, custStats.count - 1)} • Total de pedidos: ${custStats.total ? fmtCurrency(custStats.total) : fmtCurrency(0)}`
                    : `Pedidos recentes: ${custHistory.length}`}
                </p>
              )}
              {order.order_type === 'delivery' && formatAddress(order) && (
                <button
                  type="button"
                  onClick={() => setRouteOpen(true)}
                  title="Ver rota de entrega"
                  className="flex w-full items-start gap-2 rounded-xl bg-primary/5 border border-primary/20 p-3 text-left text-sm hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
                >
                  <MapPin className="h-5 w-5 shrink-0 text-primary mt-0.5" />
                  <span className="min-w-0">
                    <span className="block text-xs font-bold uppercase tracking-wider text-primary">📍 Endereço de entrega — ver rota</span>
                    <span className="block text-foreground break-words mt-0.5">{formatAddress(order)}</span>
                  </span>
                </button>
              )}
            </div>
            {(order.order_type === 'retirada' || order.order_type === 'mesa'
              || (order.status !== 'finalizado' && order.status !== 'cancelado' && sbActive)) && (
            <div className="rounded-2xl bg-muted/50 p-3.5 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Vínculos e operação</p>
              {/* Vínculos e entregador lado a lado no desktop; empilhados no mobile. */}
              <div className="grid gap-2 lg:grid-cols-2">
              {order.status !== 'finalizado' && order.status !== 'cancelado' && sbActive && (
                <div className="rounded-xl border border-border p-2.5 space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">🔗 Vínculos</p>
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground break-words">
                      Cliente: <span className="font-medium text-foreground">{order.customer_name || 'Avulso'}</span>
                      {order.order_type === 'mesa' && (
                        <> • Mesa: <span className="font-medium text-foreground">{order.table_number || '—'}</span></>
                      )}
                    </p>
                    {linking ? (
                      <Button variant="ghost" size="sm" className="h-8 text-xs w-full" onClick={() => { linkOp().userNavigated(); setLinking(null); }} disabled={linkBusy}>
                        Fechar
                      </Button>
                    ) : (
                      <div className="flex gap-1.5">
                        <Button variant="outline" size="sm" className="h-8 text-xs flex-1" onClick={openLinkCustomer}>
                          {order.customer_id ? 'Alterar' : 'Vincular'}
                        </Button>
                        {order.order_type === 'mesa' && (
                          <Button variant="outline" size="sm" className="h-8 text-xs flex-1" onClick={openLinkTable}>Mesa</Button>
                        )}
                      </div>
                    )}
                  </div>
                  {linking === 'customer' && (
                    <div className="space-y-2">
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                        <Input
                          value={custQuery}
                          onChange={(e) => setCustQuery(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleCustomerSearchEnter();
                            }
                          }}
                          placeholder="Buscar cliente por nome ou telefone..."
                          className="pl-8 h-9 text-sm"
                        />
                      </div>
                      <div className="max-h-40 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                        {filterLinkCustomers(custResults, custQuery)
                          .map((c) => (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => setCustSelected(c.id)}
                              className={`w-full text-left px-3 py-2 text-sm hover:bg-muted ${custSelected === c.id ? 'bg-muted font-medium' : ''}`}
                            >
                              {c.name || 'Sem nome'}
                              {c.phone && <span className="text-muted-foreground"> • {c.phone}</span>}
                            </button>
                          ))}
                        {custResults.length === 0 && (
                          <p className="px-3 py-2 text-xs text-muted-foreground">Nenhum cliente encontrado.</p>
                        )}
                      </div>
                      <Button
                        size="sm"
                        className="w-full"
                        disabled={!custSelected || linkBusy}
                        onClick={confirmLinkCustomer}
                      >
                        {linkBusy ? 'Salvando...' : 'Confirmar vínculo'}
                      </Button>
                    </div>
                  )}
                  {linking === 'table' && order.order_type === 'mesa' && (
                    <div className="space-y-2">
                      <Select value={tableSelected} onValueChange={setTableSelected}>
                        <SelectTrigger><SelectValue placeholder="Selecione a mesa..." /></SelectTrigger>
                        <SelectContent>
                          {tableList.map((t) => (
                            <SelectItem key={t.id} value={t.id}>Mesa {t.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {tableList.length === 0 && (
                        <p className="text-xs text-muted-foreground">Nenhuma mesa ativa configurada.</p>
                      )}
                      <Button
                        size="sm"
                        className="w-full"
                        disabled={!tableSelected || linkBusy}
                        onClick={async () => {
                          if (linkBusy) return;
                          const opId = linkOp().beginOp();
                          setLinkBusy(true);
                          try {
                            const chosen = tableList.find((t) => t.id === tableSelected);
                            if (!chosen) throw new Error('Escolha uma mesa válida');
                            if (!window.confirm(`Vincular este pedido à Mesa ${chosen.name}?`)) return;
                            await sbLinkTable(supabase, order.id, order.company_id, chosen.id);
                            await reloadAfterLink('Mesa vinculada!', opId);
                          } catch (err) {
                            toast({ title: 'Erro ao vincular', description: err?.message, variant: 'destructive' });
                          } finally {
                            setLinkBusy(false);
                          }
                        }}
                      >
                        {linkBusy ? 'Salvando...' : 'Confirmar mesa'}
                      </Button>
                    </div>
                  )}
                  {isComandaEditable(order) && (
                    <div className="space-y-2 border-t border-border pt-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm text-muted-foreground truncate">
                          Comanda: <span className="font-medium text-foreground">{resolveComandaName(order) || '—'}</span>
                        </p>
                        {linking === 'comanda' ? (
                          <Button variant="ghost" size="sm" onClick={() => { linkOp().userNavigated(); setLinking(null); }} disabled={linkBusy}>
                            Fechar
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            className="shrink-0"
                            onClick={() => { setComandaDraft(resolveComandaName(order)); linkOp().userNavigated(); setLinking('comanda'); }}
                          >
                            {resolveComandaName(order) ? 'Alterar' : 'Nomear'}
                          </Button>
                        )}
                      </div>
                      {linking === 'comanda' && (
                        <div className="space-y-2">
                          <Label htmlFor="comanda-nome">Nome da comanda</Label>
                          <Input
                            id="comanda-nome"
                            value={comandaDraft}
                            onChange={(e) => setComandaDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                void saveComandaName();
                              }
                            }}
                            placeholder="Ex.: André, João, Mesa 3"
                            maxLength={40}
                            className="h-9 text-sm"
                          />
                          <p className="text-xs text-muted-foreground">
                            Texto livre, sem cadastrar cliente. Vazio remove o nome (volta a “Avulso”).
                          </p>
                          <Button
                            size="sm"
                            className="w-full"
                            disabled={linkBusy}
                            onClick={saveComandaName}
                          >
                            {linkBusy ? 'Salvando...' : 'Salvar nome'}
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              {order.order_type === 'delivery' && order.status !== 'finalizado' && order.status !== 'cancelado' && sbActive && (
                <div className="rounded-xl border border-border p-2.5 space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">🛵 Entregador</p>
                  {!managingDriver ? (
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-foreground break-words">
                        {driver?.name || (order.driver_id ? 'Vinculado' : 'Sem entregador')}
                        {driver?.phone && <span className="text-muted-foreground font-normal"> • {driver.phone}</span>}
                        {order.driver_id && defaultDriverId && order.driver_id === defaultDriverId && (
                          <span className="ml-1.5 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Padrão</span>
                        )}
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs w-full"
                        onClick={async () => {
                          try {
                            const list = (await listDrivers(supabase, order.company_id)).filter(d => d.status === 'ativo');
                            setManageList(list);
                          } catch {
                            setManageList([]);
                          }
                          setManageSelected(order.driver_id || '');
                          setManagingDriver(true);
                        }}
                      >
                        {order.driver_id ? 'Alterar' : 'Atribuir'}
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Select value={manageSelected} onValueChange={setManageSelected}>
                        <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                        <SelectContent>
                          {manageList.map(d => (
                            <SelectItem key={d.id} value={d.id}>
                              {d.name}{d.vehicle_plate ? ` • ${d.vehicle_plate}` : ''}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <div className="flex flex-col sm:flex-row sm:justify-end gap-2">
                        <Button variant="ghost" size="sm" className="w-full sm:w-auto" onClick={() => setManagingDriver(false)} disabled={manageBusy}>
                          Fechar
                        </Button>
                        {order.driver_id && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={manageBusy}
                            onClick={async () => {
                              setManageBusy(true);
                              try {
                                await sbAssignDriver(supabase, order.id, order.company_id, null);
                                const detail = await sbGetOrderDetail(supabase, order.company_id, order.id);
                                onOrderUpdated(detail || { ...order, driver_id: null });
                                toast({ title: 'Entregador removido' });
                                setManagingDriver(false);
                              } catch (err) {
                                toast({ title: 'Erro ao remover', description: err?.message, variant: 'destructive' });
                              } finally {
                                setManageBusy(false);
                              }
                            }}
                          >
                            Remover
                          </Button>
                        )}
                        <Button
                          size="sm"
                          disabled={manageBusy || !manageSelected}
                          onClick={async () => {
                            setManageBusy(true);
                            try {
                              await sbAssignDriver(supabase, order.id, order.company_id, manageSelected);
                              const detail = await sbGetOrderDetail(supabase, order.company_id, order.id);
                              onOrderUpdated(detail || { ...order, driver_id: manageSelected });
                              toast({ title: 'Entregador atualizado!' });
                              setManagingDriver(false);
                            } catch (err) {
                              toast({ title: 'Erro ao atribuir', description: err?.message, variant: 'destructive' });
                            } finally {
                              setManageBusy(false);
                            }
                          }}
                        >
                          Salvar
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              </div>
              {order.order_type === 'retirada' && (
                <p className="flex items-center gap-2 text-sm font-semibold text-foreground pt-1">
                  <ShoppingBag className="h-4 w-4 shrink-0" /> 🛍️ RETIRADA no balcão
                </p>
              )}
              {order.order_type === 'mesa' && (
                <p className="flex items-center gap-2 text-sm font-semibold text-foreground pt-1">
                  <UtensilsCrossed className="h-4 w-4 shrink-0" /> 🍽️ MESA {order.table_number || ''}
                </p>
              )}
            </div>
            )}
            </div>

            {/* Items: compactos; acima de 3, recolhe com expansão. Clique abre o detalhe. */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Itens do pedido ({order.items?.length || 0})
                </p>
                {(order.items?.length || 0) > 3 && (
                  <button
                    type="button"
                    onClick={() => setItemsOpen((v) => !v)}
                    aria-expanded={itemsOpen}
                    className="text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                  >
                    {itemsOpen ? 'Ver menos' : `Ver todos (${order.items.length})`}
                  </button>
                )}
              </div>
              <div className="space-y-1.5">
                {(itemsOpen || (order.items?.length || 0) <= 3 ? (order.items || []) : (order.items || []).slice(0, 3)).map((item, i) => {
                  const photo = item.product_id ? photoMap[item.product_id] : null;
                  return (
                    <button
                      key={item.id || i}
                      type="button"
                      onClick={() => setSelectedItemIdx((order.items || []).indexOf(item))}
                      aria-label={`Ver detalhes de ${item.name}`}
                      className="flex w-full gap-2.5 rounded-2xl border border-border bg-card p-2.5 text-left transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {photo ? (
                        <Image src={photo} fittingType="fill" className="h-14 w-14 sm:h-16 sm:w-16 rounded-xl shrink-0 object-cover" alt="" />
                      ) : (
                        <div className="flex h-14 w-14 sm:h-16 sm:w-16 shrink-0 items-center justify-center rounded-xl bg-muted">
                          <Package className="h-6 w-6 text-muted-foreground" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-foreground break-words leading-snug text-sm">{item.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {item.quantity} {item.quantity === 1 ? 'unidade' : 'unidades'} • {fmtCurrency(item.unit_price)} cada
                        </p>
                        {item.complements && item.complements.length > 0 && (
                          <div className="mt-1 space-y-0.5">
                            {groupComplements(item.complements).map((g, gi) => (
                              <p key={gi} className="text-xs text-muted-foreground break-words">
                                <span className="font-semibold">{g.group}: </span>
                                {g.items.map((c, ci) => (
                                  <span key={ci}>
                                    {ci > 0 && ', '}
                                    {Number(c.quantity) > 1 ? `${c.quantity}x ` : ''}{c.option_name || c.name}
                                    {' '}({isFreeComplement(c) ? 'Grátis' : fmtCurrency(c.price)})
                                  </span>
                                ))}
                              </p>
                            ))}
                          </div>
                        )}
                        {item.notes && <p className="text-xs text-muted-foreground italic mt-0.5 break-words">📝 {item.notes}</p>}
                      </div>
                      <p className="text-sm font-bold shrink-0 whitespace-nowrap">{fmtCurrency(item.price)}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Totals: bloco clicável abre o resumo financeiro (só conferência). */}
            <div
              role="button"
              tabIndex={0}
              onClick={() => setSummaryOpen(true)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSummaryOpen(true); } }}
              aria-label="Ver resumo financeiro do pedido"
              title="Ver resumo financeiro"
              className="w-full text-left rounded-2xl border border-border p-3.5 space-y-1 text-sm cursor-pointer transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{fmtCurrency(order.subtotal)}</span></div>
              {itemsComplementsTotal(order.items) > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Adicionais inclusos</span><span>{fmtCurrency(itemsComplementsTotal(order.items))}</span></div>}
              {order.delivery_fee > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Taxa de entrega</span><span>{fmtCurrency(order.delivery_fee)}</span></div>}
              {order.discount > 0 && <div className="flex justify-between text-green-600"><span>Desconto</span><span>-{fmtCurrency(order.discount)}</span></div>}
              {order.change_for != null && <div className="flex justify-between"><span className="text-muted-foreground">Troco para</span><span>{fmtCurrency(order.change_for)}</span></div>}
              <div className="flex items-baseline justify-between pt-2 border-t border-border">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Total • ver resumo</span>
                <span className="font-heading text-2xl font-bold">{fmtCurrency(order.total)}</span>
              </div>
            </div>

            {/* Payment + notes */}
            {order.payment_method && (
              <div className="flex items-center gap-2 text-sm pt-2 border-t border-border">
                <Receipt className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="text-muted-foreground">Pagamento:</span>
                <span className="font-medium truncate">{order.payment_method}</span>
                {order.payment_status && <span className="text-muted-foreground">• {order.payment_status}</span>}
              </div>
            )}
            {order.notes && (
              <div className="text-sm pt-2 border-t border-border break-words">
                <span className="text-muted-foreground">Obs: </span>
                <span>{order.notes}</span>
              </div>
            )}

            {/* Cancel reason */}
            {order.status === 'cancelado' && order.cancel_reason && (
              <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm break-words">
                <p className="font-medium text-red-700">Cancelado por: {order.canceled_by_name || '—'}</p>
                <p className="text-red-600 mt-1">Motivo: {order.cancel_reason}</p>
              </div>
            )}

            {/* Order history: somente eventos DESTE pedido, sem repetir consecutivos.
                Recolhido por padrão; expande/recolhe sem perder informações. */}
            {order.status_history && order.status_history.length > 0 && (
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => setHistoryOpen((v) => !v)}
                  aria-expanded={historyOpen}
                  aria-label={historyOpen ? 'Recolher histórico do pedido' : 'Expandir histórico do pedido'}
                  className="flex w-full items-center justify-between gap-2 rounded-lg py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Histórico do pedido</span>
                  {historyOpen ? (
                    <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                </button>
                {historyOpen && (
                <div className="rounded-2xl border border-border divide-y divide-border mt-1">
                  {collapseConsecutiveStatuses(order.status_history).map((h, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 px-3 py-2">
                      <span className="flex items-center gap-2 text-sm font-medium text-foreground min-w-0">
                        <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">{STATUS_LABELS[h.status] || h.status}</span>
                      </span>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(h.timestamp).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  ))}
                </div>
                )}
              </div>
            )}

            {/* Customer history: OUTROS pedidos do cliente, um card por pedido.
                Recolhido por padrão, mesmo padrão do histórico do pedido. */}
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setCustHistoryOpen((v) => !v)}
                aria-expanded={custHistoryOpen}
                aria-label={custHistoryOpen ? 'Recolher histórico do cliente' : 'Expandir histórico do cliente'}
                className="flex w-full items-center justify-between gap-2 rounded-lg py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Histórico do cliente</span>
                {custHistoryOpen ? (
                  <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
              </button>
              {custHistoryOpen && (
              <div className="mt-1">
              <p className="text-xs text-muted-foreground mb-2">Pedidos anteriores</p>
              {extraLoading ? (
                <p className="text-sm text-muted-foreground">Carregando...</p>
              ) : custHistory.length === 0 ? (
                (histOk && (order.customer_id || order.customer_phone)) ? (
                <p className="text-sm text-muted-foreground">Este é o primeiro pedido deste cliente.</p>
                ) : (
                <p className="text-sm text-muted-foreground">Sem histórico vinculado a este pedido.</p>
                )
              ) : (
                <div className="space-y-2">
                  {custHistory.map(h => (
                    <button
                      key={h.id}
                      type="button"
                      onClick={() => onSelectOrder?.(h)}
                      className="flex w-full items-center justify-between gap-2 rounded-xl border border-border p-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <div className="min-w-0">
                        <p className="font-semibold text-foreground">Pedido #{h.order_number}</p>
                        <p className="text-xs text-muted-foreground">
                          {STATUS_LABELS[h.status] || h.status} • {h.items?.length || 0} {(h.items?.length || 0) === 1 ? 'item' : 'itens'} • {h.created_date ? new Date(h.created_date).toLocaleDateString('pt-BR') : ''}
                        </p>
                      </div>
                      <p className="font-bold shrink-0 whitespace-nowrap">{fmtCurrency(h.total)}</p>
                    </button>
                  ))}
                </div>
              )}
              </div>
              )}
            </div>
          </div>

            {/* Actions by status */}
            {(primaryAction || cancelAction) && (
              <div className="shrink-0 border-t border-border px-4 sm:px-6 py-2 sm:py-3">
                {keepStep && (
                  <div className="rounded-xl border border-border bg-muted/40 p-3 mb-3 space-y-2">
                    <p className="text-sm font-semibold text-foreground">Entregador já vinculado</p>
                    <p className="text-sm text-muted-foreground">
                      Este pedido já está atribuído a <span className="font-medium text-foreground">{driver?.name || 'este entregador'}</span>.
                      Deseja manter este entregador para a entrega?
                    </p>
                    <div className="flex flex-col sm:flex-row sm:justify-end gap-2">
                      <Button variant="ghost" size="sm" className="w-full sm:w-auto min-h-11" onClick={() => setKeepStep(null)}>
                        Cancelar
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full sm:w-auto min-h-11"
                        onClick={() => {
                          const action = keepStep;
                          setKeepStep(null);
                          openAssignStep(action, order.driver_id || '');
                        }}
                      >
                        Alterar entregador
                      </Button>
                      <Button
                        size="sm"
                        className="w-full sm:w-auto min-h-11"
                        onClick={() => {
                          const action = keepStep;
                          setKeepStep(null);
                          runStatusAction(action);
                        }}
                      >
                        Manter entregador
                      </Button>
                    </div>
                  </div>
                )}
                {assignStep && (
                  <div className="rounded-xl border border-border bg-muted/40 p-3 mb-3 space-y-2">
                    <Label>🛵 Entregador</Label>
                    {drivers.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Nenhum entregador ativo cadastrado.</p>
                    ) : (
                      <Select value={selectedDriver} onValueChange={setSelectedDriver}>
                        <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                        <SelectContent>
                          {drivers.map(d => (
                            <SelectItem key={d.id} value={d.id}>
                              {d.name}{d.vehicle_plate ? ` • ${d.vehicle_plate}` : ''}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    <div className="flex flex-col sm:flex-row sm:justify-end gap-2">
                      <Button variant="outline" className="w-full sm:w-auto min-h-11" onClick={() => confirmDispatch(false)} disabled={assigning}>
                        Pular
                      </Button>
                      <Button
                        className="w-full sm:w-auto min-h-11"
                        onClick={() => confirmDispatch(true)}
                        disabled={assigning || !selectedDriver}
                      >
                        {assigning ? 'Saindo...' : 'Confirmar saída'}
                      </Button>
                    </div>
                  </div>
                )}
            {/* Aviso ao entregador: após saída para entrega (delivery).
                Envio sempre manual via WhatsApp; abrir marca "iniciado". */}
            {notifyPrompt && order.order_type === 'delivery' && order.status === 'saiu_entrega' && (
              <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 mb-3 space-y-2" role="status">
                {notifyPrompt.driverId ? (
                  <>
                    <p className="text-sm font-medium text-foreground">🛵 Avisar entregador no WhatsApp?</p>
                    <p className="text-xs text-muted-foreground">
                      Abre a conversa com pedido, endereço, total e pagamento. Abrir registra "iniciado" — o envio é manual.
                    </p>
                    {notifyMsg && <p className="text-xs text-red-600">{notifyMsg}</p>}
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" className="flex-1 min-h-10" onClick={() => setNotifyPrompt(null)}>Depois</Button>
                      <Button size="sm" className="flex-1 min-h-10" onClick={sendDriverNotify} disabled={notifyBusy}>
                        {notifyBusy ? 'Preparando...' : 'Avisar no WhatsApp'}
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs text-amber-800">⚠️ Saiu para entrega sem entregador atribuído — atribua um entregador para avisar no WhatsApp.</p>
                    <Button variant="ghost" size="sm" className="h-7 shrink-0" onClick={() => setNotifyPrompt(null)}>OK</Button>
                  </div>
                )}
              </div>
            )}
            {/* Barra de ações: icon-only. Mesmos handlers/validações;
                só apresentação muda. Regresso também icon-only. */}
                <div className="flex flex-col sm:flex-row sm:justify-end gap-2">
                  <TooltipProvider>
                  {regressAction && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          className="h-11 w-full sm:w-11 p-0 shrink-0"
                          onClick={() => runStatusAction(regressAction)}
                          disabled={busy}
                          aria-label={regressAction.label}
                        >
                          {statusAction === 'regress' ? (
                            <Loader2 className="h-5 w-5 animate-spin" />
                          ) : (
                            <Undo2 className="h-5 w-5" />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{regressAction.label}</TooltipContent>
                    </Tooltip>
                  )}
                    {cancelAction && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="destructive"
                            className="h-11 w-full sm:w-11 p-0 shrink-0"
                            onClick={onCancel}
                            disabled={busy}
                            aria-label="Cancelar pedido"
                          >
                            <X className="h-5 w-5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Cancelar pedido</TooltipContent>
                      </Tooltip>
                    )}
                    {primaryAction && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            className="h-11 w-full sm:w-11 p-0 shrink-0 bg-green-600 hover:bg-green-700 text-white"
                            onClick={() => handleStatusAction(primaryAction)}
                            disabled={busy}
                            aria-label={primaryAction.label}
                          >
                            {statusAction ? (
                              <Loader2 className="h-5 w-5 animate-spin" />
                            ) : primaryAction.id === 'accept' ? (
                              <Check className="h-5 w-5" />
                            ) : (
                              <ArrowRight className="h-5 w-5" />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{primaryAction.label}</TooltipContent>
                      </Tooltip>
                    )}
                    {order.status !== 'cancelado' && order.status !== 'finalizado' && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="outline"
                            className="h-11 w-full sm:w-11 p-0 shrink-0"
                            onClick={handleManualPrint}
                            disabled={busy}
                            aria-label={`Imprimir pedido ${order.order_number || ''}`}
                          >
                            <Printer className="h-5 w-5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Imprimir pedido</TooltipContent>
                      </Tooltip>
                    )}
                  </TooltipProvider>
                </div>
                {order.status !== 'cancelado' && order.status !== 'finalizado' && onRequestPayment && (
                  <Button variant="outline" className="w-full mt-2" onClick={() => onRequestPayment(order)} disabled={busy}>
                    💳 Solicitar pagamento
                  </Button>
                )}
                {order.status !== 'cancelado' && order.status !== 'finalizado' && (
                  <Button variant="ghost" className="w-full mt-2" onClick={startEdit} disabled={busy}>
                    <Pencil className="h-4 w-4" /> Editar itens/endereço
                  </Button>
                )}
              </div>
            )}
          </>
        ) : (
          /* EDIT MODE */
          <>
          <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-heading font-semibold">Editar pedido</h3>
              <Button variant="ghost" size="sm" onClick={() => setEditMode(false)}><X className="h-4 w-4" /></Button>
            </div>

            {/* Edit items */}
            <div className="space-y-2">
              <Label>Itens</Label>
              {editData.items.map((item, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg border border-border p-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.name}</p>
                    <p className="text-xs text-muted-foreground">{fmtCurrency(item.unit_price)}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button type="button" onClick={() => updateItemQty(i, -1)} className="flex h-8 w-8 items-center justify-center rounded border border-border" aria-label="Diminuir quantidade">−</button>
                    <span className="w-8 text-center text-sm">{item.quantity}</span>
                    <button type="button" onClick={() => updateItemQty(i, 1)} className="flex h-8 w-8 items-center justify-center rounded border border-border" aria-label="Aumentar quantidade">+</button>
                  </div>
                  <button type="button" onClick={() => removeItem(i)} className="shrink-0 text-red-500 hover:bg-red-50 rounded p-1.5" aria-label="Remover item">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
              {checkCartDependencies(editData.items, depRules, buildDepModesFromProducts(menuProducts)).map((e) => (
                <p key={e.productId} className="text-xs text-amber-700 rounded-lg border border-amber-300 bg-amber-50 p-2.5" role="alert">
                  ⚠️ {e.message}
                </p>
              ))}
            </div>

            {/* Add products from menu */}
            <div className="space-y-2">
              <Button variant="outline" className="w-full min-h-11" onClick={() => setShowPicker(v => !v)}>
                <Plus className="h-4 w-4" /> {showPicker ? 'Ocultar cardápio' : 'Adicionar produtos'}
              </Button>
              {showPicker && (
                <div className="rounded-xl border border-border p-2 space-y-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input value={menuSearch} onChange={e => setMenuSearch(e.target.value)} placeholder="Buscar produto..." className="pl-9" />
                  </div>
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {menuLoading && <p className="text-sm text-muted-foreground p-2">Carregando cardápio...</p>}
                    {!menuLoading && menuProducts.filter(p => p.name?.toLowerCase().includes(menuSearch.toLowerCase())).map(p => (
                      <div key={p.id} className="flex items-center gap-2 rounded-lg p-2 hover:bg-muted/50">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{p.name}</p>
                          <p className="text-xs text-muted-foreground">{fmtCurrency(p.promotional_price != null ? p.promotional_price : p.price)}</p>
                        </div>
                        <Button variant="outline" size="sm" onClick={() => addProductToEdit(p)} aria-label={`Adicionar ${p.name}`}>
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                    {!menuLoading && menuProducts.filter(p => p.name?.toLowerCase().includes(menuSearch.toLowerCase())).length === 0 && (
                      <p className="text-sm text-muted-foreground p-2">Nenhum produto disponível.</p>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Edit address (for delivery) */}
            {order.order_type === 'delivery' && (
              <div className="space-y-2">
                <Label>Endereço</Label>
                <Input value={editData.customer_address} onChange={(e) => setEditData({ ...editData, customer_address: e.target.value })} placeholder="Rua" />
                <div className="grid grid-cols-2 gap-2">
                  <Input value={editData.customer_number} onChange={(e) => setEditData({ ...editData, customer_number: e.target.value })} placeholder="Número" />
                  <Input value={editData.customer_complement} onChange={(e) => setEditData({ ...editData, customer_complement: e.target.value })} placeholder="Complemento" />
                </div>
                <Input value={editData.customer_neighborhood} onChange={(e) => setEditData({ ...editData, customer_neighborhood: e.target.value })} placeholder="Bairro" />
              </div>
            )}

            {/* Edit discount + notes */}
            <div className="space-y-2">
              <Label>Desconto (R$)</Label>
              <Input type="number" step="0.01" min="0" value={editData.discount} onChange={(e) => setEditData({ ...editData, discount: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Observações</Label>
              <Textarea value={editData.notes} onChange={(e) => setEditData({ ...editData, notes: e.target.value })} rows={2} />
            </div>
          </div>

            <div className="shrink-0 border-t border-border px-4 sm:px-6 py-3 sm:py-4">
              <div className="flex flex-col sm:flex-row sm:justify-end gap-2">
                <Button variant="ghost" className="w-full sm:w-auto min-h-11" onClick={() => setEditMode(false)}>Fechar</Button>
                <Button variant="outline" className="w-full sm:w-auto sm:min-w-32 min-h-11" onClick={() => setEditMode(false)}>Voltar</Button>
                <Button className="w-full sm:w-auto sm:min-w-32 min-h-11" onClick={saveEdit} disabled={saving}>
                  {saving ? 'Salvando...' : 'Salvar alterações'}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
      <RouteModal open={routeOpen} onClose={() => setRouteOpen(false)} order={order} company={company} />
      {printPrompt && (
        <PrintPromptModal
          open={!!printPrompt}
          onOpenChange={(open) => {
            if (!open) {
              setPrintPrompt(null);
              if (printPrompt.autoClose) onClose();
            }
          }}
          orderNumber={printPrompt.orderNumber}
          stageName={printPrompt.stageName}
          onSkip={() => {
            setPrintPrompt(null);
            if (printPrompt.autoClose) onClose();
          }}
          onPrint={() => {
            const r = openPrintWindow(printPrompt.url);
            if (r.ok) {
              markPrinted(printPrompt.orderId, printPrompt.stageId);
              setPrintPrompt(null);
              if (printPrompt.autoClose) onClose();
            } else {
              toast({ title: 'Falha na impressão', description: `${PRINT_FAILURE_MESSAGE[r.reason]} Tente de novo.`, variant: 'destructive' });
            }
          }}
        />
      )}

      {/* Detalhe do item: foto, personalizações e total da linha, com
          navegação anterior/próximo restrita aos itens DESTE pedido. */}
      <Dialog open={!!selectedItem} onOpenChange={(open) => { if (!open) setSelectedItemIdx(null); }}>
        <DialogContent
          className="w-[calc(100vw-2rem)] max-w-md max-h-[90vh] overflow-y-auto"
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft' && itemNav.hasPrev) setSelectedItemIdx(itemNav.prevIdx);
            if (e.key === 'ArrowRight' && itemNav.hasNext) setSelectedItemIdx(itemNav.nextIdx);
          }}
        >
          <DialogHeader>
            <DialogTitle className="pr-6">
              {selectedItem?.name}
              <span className="block text-xs font-normal text-muted-foreground mt-0.5">
                Item {(selectedItemIdx ?? 0) + 1} de {itemNav.count} • Pedido #{order.order_number}
              </span>
            </DialogTitle>
          </DialogHeader>
          {selectedItem && (
            <div className="space-y-3">
              <div className="flex gap-3">
                {selectedItemPhoto ? (
                  <Image src={selectedItemPhoto} fittingType="fill" className="h-24 w-24 rounded-xl shrink-0 object-cover" alt="" />
                ) : (
                  <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-xl bg-muted">
                    <Package className="h-8 w-8 text-muted-foreground" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-muted-foreground">
                    {selectedItem.quantity} {selectedItem.quantity === 1 ? 'unidade' : 'unidades'} • {fmtCurrency(selectedItem.unit_price)} cada
                  </p>
                  <p className="font-heading text-2xl font-bold mt-1">{fmtCurrency(selectedItem.price)}</p>
                </div>
              </div>
              {(selectedItem.complements?.length || 0) > 0 && (
                <div className="space-y-1">
                  {groupComplements(selectedItem.complements).map((g, gi) => (
                    <p key={gi} className="text-sm break-words">
                      <span className="font-semibold">{g.group}: </span>
                      <span className="text-muted-foreground">
                        {g.items.map((c, ci) => (
                          <span key={ci}>
                            {ci > 0 && ', '}
                            {Number(c.quantity) > 1 ? `${c.quantity}x ` : ''}{c.option_name || c.name}
                            {' '}({isFreeComplement(c) ? 'Grátis' : fmtCurrency(c.price)})
                          </span>
                        ))}
                      </span>
                    </p>
                  ))}
                </div>
              )}
              {selectedItem.notes && <p className="text-sm italic text-muted-foreground break-words">📝 {selectedItem.notes}</p>}
              <div className="flex gap-2">
                <Button
                  variant="outline" className="flex-1"
                  disabled={!itemNav.hasPrev}
                  onClick={() => setSelectedItemIdx(itemNav.prevIdx)}
                  aria-label="Item anterior"
                >
                  ← Anterior
                </Button>
                <Button
                  variant="outline" className="flex-1"
                  disabled={!itemNav.hasNext}
                  onClick={() => setSelectedItemIdx(itemNav.nextIdx)}
                  aria-label="Próximo item"
                >
                  Próximo →
                </Button>
              </div>
              <Button variant="ghost" className="w-full" onClick={() => setSelectedItemIdx(null)}>
                Voltar ao pedido
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Resumo financeiro: só conferência dos valores oficiais (sem recalcular,
          sem finalizar). Ação de avanço só se o fluxo atual permitir. */}
      <Dialog open={summaryOpen} onOpenChange={setSummaryOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-sm max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="pr-6">
              Resumo financeiro
              <span className="block text-xs font-normal text-muted-foreground mt-0.5">
                Pedido #{order.order_number} • valores registrados
              </span>
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{fmtCurrency(order.subtotal)}</span></div>
            {itemsComplementsTotal(order.items) > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Adicionais inclusos</span><span>{fmtCurrency(itemsComplementsTotal(order.items))}</span></div>}
            {order.delivery_fee > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Taxa de entrega</span><span>{fmtCurrency(order.delivery_fee)}</span></div>}
            {order.discount > 0 && <div className="flex justify-between text-green-600"><span>Desconto</span><span>-{fmtCurrency(order.discount)}</span></div>}
            {order.change_for != null && <div className="flex justify-between"><span className="text-muted-foreground">Troco para</span><span>{fmtCurrency(order.change_for)}</span></div>}
            <div className="flex items-baseline justify-between pt-2 border-t border-border">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Total</span>
              <span className="font-heading text-3xl font-bold">{fmtCurrency(order.total)}</span>
            </div>
            {(order.payment_method || order.payment_status) && (
              <p className="text-sm text-muted-foreground pt-1">
                Pagamento: <span className="font-medium text-foreground">{[order.payment_method, order.payment_status].filter(Boolean).join(' • ')}</span>
              </p>
            )}
          </div>
          {primaryAction && (
            <Button
              className="w-full bg-green-600 hover:bg-green-700 text-white"
              disabled={busy}
              onClick={() => { setSummaryOpen(false); handleStatusAction(primaryAction); }}
              aria-label={primaryAction.label}
            >
              {primaryAction.label}
            </Button>
          )}
          <Button variant="ghost" className="w-full" onClick={() => setSummaryOpen(false)}>
            Fechar resumo
          </Button>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
