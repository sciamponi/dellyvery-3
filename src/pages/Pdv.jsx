import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/api/supabaseClient';
import { useCompany } from '@/hooks/useCompany';
import { listProducts, listCategories } from '@/api/catalog';
import { listTables } from '@/api/tables';
import { listCustomers } from '@/api/customers';
import { listZones } from '@/api/deliveryZones';
import { createOrder, editOrder, cancelOrder, getOrderDetail, listOrdersWithItems, assignDriver, buildCreateOrderItems } from '@/api/orders';
import { listDrivers, getDriver } from '@/api/team';
import { markDriverNotified } from '@/api/driverNotifications';
import { buildDriverDeliveryUrl } from '@/lib/driverMessage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { calcPdvTotals } from '@/lib/orderDay';
import { validatePdvDraft } from '@/lib/pdvValidation';
import { groupComandasByTable, mergeComandaItems, toPdvDraftItem, normalizeTable } from '@/lib/tableComandas';
import { buildWhatsAppUrl } from '@/lib/menuShare';
import TableSelectModal, { MergeConfirmModal, TableMergePicker } from '@/components/pdv/TableSelectModal';
import PdvTableView from '@/components/pdv/PdvTableView';
import PdvProductCatalog from '@/components/pdv/PdvProductCatalog';
import PdvOrderModal from '@/components/pdv/PdvOrderModal';
import OrderModal from '@/components/orders/OrderModal';
import CancelOrderDialog from '@/components/orders/CancelOrderDialog';
import ProductModal from '@/components/menu/ProductModal';
import { CartProvider } from '@/lib/CartContext';
import { getProductConfig, listDependenciesWithNames } from '@/api/configurator';
import { checkCartDependencies, buildDepModesFromProducts } from '@/lib/productDependencies';
import { mergeDraftLine } from '@/lib/pdvAssembly';
import {
  buildTableCards, comandasForTable, findTableCard, getPdvView,
  hasLocalDraftItems, localDraftItemsOnly, pickLatestComanda,
  setPdvView as persistPdvView,
} from '@/lib/pdvWorkspace';
import { Plus, Minus, Trash2, Search, Package, CheckCircle, Bike, Store, Table2, User, Printer, MessageCircle, Tag, Lock } from 'lucide-react';

const fmtCurrency = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);

const ORDER_TYPES = [
  { id: 'mesa', label: '🍽️ Mesa', icon: Table2 },
  // Balcão opera como retirada com origem presencial (sem novo valor no enum).
  { id: 'retirada', label: '🛍️ Balcão', icon: Store },
  { id: 'delivery', label: '🛵 Entrega', icon: Bike },
];

const PAYMENTS = ['Dinheiro', 'Cartão (na entrega)', 'Pix (na entrega)'];

function Spinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-4 border-border border-t-primary rounded-full animate-spin" />
    </div>
  );
}

export default function Pdv() {
  const { loading, company } = useCompany();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [zones, setZones] = useState([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('all');

  const [items, setItems] = useState([]);
  // Dependências entre produtos (regras da empresa, 1 carga).
  const [depRules, setDepRules] = useState([]);
  // Montagem V2 por linha (ProductModal) + cache de config por produto.
  const [configuring, setConfiguring] = useState(null);
  const [configuringEditId, setConfiguringEditId] = useState(null);
  const [configCache, setConfigCache] = useState({});
  // Mesa é o padrão do PDV de garçom; retirada/entrega continuam disponíveis.
  const [orderType, setOrderType] = useState('mesa');
  const [tableNumber, setTableNumber] = useState('');
  // Mesa cadastrada (ID real) + busca. Manual continua possível.
  const [registeredTables, setRegisteredTables] = useState([]);
  const [tableSearch, setTableSearch] = useState('');
  const [selectedTableId, setSelectedTableId] = useState(null);
  const [customerSearch, setCustomerSearch] = useState('');
  const [customer, setCustomer] = useState({ name: '', phone: '' });
  const [address, setAddress] = useState('');
  const [deliveryZoneId, setDeliveryZoneId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [changeFor, setChangeFor] = useState('');
  const [discount, setDiscount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Guarda anti-duplo: cliques repetidos antes do estado assentar.
  const submitRef = useRef(false);
  const [doneOrder, setDoneOrder] = useState(null);
  // Entregadores (ativos) + notificação manual por pedido.
  const [drivers, setDrivers] = useState([]);
  const [driverId, setDriverId] = useState('');
  const [notifying, setNotifying] = useState(false);
  const [notifyState, setNotifyState] = useState('');
  // Observação por item do rascunho (expandida por linha).
  const [noteOpenId, setNoteOpenId] = useState(null);

  // Comandas de mesa (derivadas dos pedidos ativos — sem entidade Mesa).
  const [mesaOrders, setMesaOrders] = useState([]);
  const [mesaLoading, setMesaLoading] = useState(false);
  const [mesaError, setMesaError] = useState('');
  const [tablesLoading, setTablesLoading] = useState(true);
  const [tablesError, setTablesError] = useState('');
  const [tableOpen, setTableOpen] = useState(false);
  const [tablePickerName, setTablePickerName] = useState('');
  const [tablePickerId, setTablePickerId] = useState(null);
  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const queryMesaRef = useRef('');
  const [selectedComandaId, setSelectedComandaId] = useState(null);
  const [mergeTable, setMergeTable] = useState(null);
  const [mergeCard, setMergeCard] = useState(null);
  const [mergeIds, setMergeIds] = useState([]);
  const [mergeConfirm, setMergeConfirm] = useState(null);
  const [merging, setMerging] = useState(false);
  // Visual Produtos/Mesas. A montagem abre pelo card do produto.
  const [pdvView, setPdvViewState] = useState(() => getPdvView());
  const [tableCardSearch, setTableCardSearch] = useState('');
  // Detalhe da comanda (reuso do OrderModal) + cancelamento.
  const [detailOrder, setDetailOrder] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);

  useEffect(() => {
    if (!company) return;
    const load = async () => {
      try {
        const [prods, cats, custs, zn] = await Promise.all([
          listProducts(supabase, company.id),
          listCategories(supabase, company.id),
          listCustomers(supabase, company.id).catch(() => []),
          listZones(supabase, company.id).catch(() => []),
        ]);
        setProducts(prods);
        setCategories(cats);
        setCustomers(custs);
        setZones(zn);
        listTables(supabase, company.id, { onlyActive: true })
          .then((list) => { setRegisteredTables(list || []); setTablesError(''); })
          .catch((err) => setTablesError(err?.message || 'Falha ao carregar mesas.'))
          .finally(() => setTablesLoading(false));
        listDependenciesWithNames(supabase, company.id).then(setDepRules).catch(() => {});
        listDrivers(supabase, company.id).then((list) => {
          setDrivers((list || []).filter((d) => d.status === 'ativo'));
        }).catch(() => {});
      } catch (err) {
        toast({ title: 'Erro ao carregar cardápio', description: err?.message, variant: 'destructive' });
      } finally {
        setDataLoading(false);
      }
    };
    load();
  }, [company?.id]);

  const refreshMesaOrders = async () => {
    if (!company) return [];
    setMesaLoading(true);
    try {
      const all = await listOrdersWithItems(supabase, company.id, 200);
      const mesa = all.filter(o => o.order_type === 'mesa');
      setMesaOrders(mesa);
      setMesaError('');
      return mesa;
    } catch (err) {
      // Mantém as comandas já carregadas, mas o erro fica visível e recuperável.
      setMesaError(err?.message || 'Falha ao carregar comandas.');
      return null;
    } finally {
      setMesaLoading(false);
    }
  };

  const retryMesas = async () => {
    if (!company) return;
    setTablesLoading(true);
    setTablesError('');
    try {
      const list = await listTables(supabase, company.id, { onlyActive: true });
      setRegisteredTables(list || []);
    } catch (err) {
      setTablesError(err?.message || 'Falha ao carregar mesas.');
    } finally {
      setTablesLoading(false);
    }
    await refreshMesaOrders();
  };

  useEffect(() => {
    if ((orderType === 'mesa' || pdvView === 'mesas') && company) refreshMesaOrders();
  }, [orderType, pdvView, company?.id]);

  // Atalho de Configurações > PDV: /pdv?mesa=12 abre a mesa/comanda pronta.
  useEffect(() => {
    const mesaParam = searchParams.get('mesa');
    if (!mesaParam || !company || tablesLoading) return;
    if (queryMesaRef.current === mesaParam) return;
    queryMesaRef.current = mesaParam;
    let alive = true;

    void (async () => {
      changePdvView('mesas');
      const orders = await refreshMesaOrders();
      if (!alive) return;
      const wanted = normalizeTable(mesaParam) || String(mesaParam).trim();
      const cards = buildTableCards({ tables: registeredTables, orders: orders || [], companyId: company.id });
      const reg = registeredTables.find((r) => normalizeTable(r.name) === wanted);
      const card = findTableCard(cards, { tableId: reg?.id, tableName: wanted });
      if (card) {
        openTableCard(card, orders || []);
      } else if (canReplaceDraft()) {
        setOrderType('mesa');
        setSelectedTableId(reg?.id || null);
        setTableNumber(wanted);
        setOrderModalOpen(true);
      }
      const next = new URLSearchParams(searchParams);
      next.delete('mesa');
      setSearchParams(next, { replace: true });
      queryMesaRef.current = '';
    })();

    return () => { alive = false; };
  }, [searchParams, company?.id, registeredTables, tablesLoading]);

  const tables = useMemo(() => groupComandasByTable(mesaOrders), [mesaOrders]);
  const tableCards = useMemo(
    () => buildTableCards({ tables: registeredTables, orders: mesaOrders, companyId: company?.id }),
    [registeredTables, mesaOrders, company?.id],
  );
  const filteredTables = useMemo(() => {
    const q = tableSearch.trim().toLowerCase();
    if (!q) return registeredTables;
    return registeredTables.filter((t) =>
      (t.name || '').toLowerCase().includes(q) || (t.code || '').toLowerCase().includes(q),
    );
  }, [registeredTables, tableSearch]);

  const selectedCard = useMemo(
    () => findTableCard(tableCards, { tableId: selectedTableId, tableName: tableNumber }),
    [tableCards, selectedTableId, tableNumber],
  );
  const currentComandas = useMemo(
    () => comandasForTable(mesaOrders, selectedTableId, tableNumber, company?.id),
    [mesaOrders, selectedTableId, tableNumber, company?.id],
  );
  const selectedComanda = useMemo(
    () => mesaOrders.find(o => o.id === selectedComandaId) || null,
    [mesaOrders, selectedComandaId],
  );
  const modalTableComandas = useMemo(() => {
    if (currentComandas.length > 0) return currentComandas;
    return (selectedCard?.comandas || []).map((c) => ({
      id: c.id,
      order_number: c.order_number,
      customer_name: c.customerName,
      status: c.status,
    }));
  }, [currentComandas, selectedCard]);

  const matchedCustomers = useMemo(() => {
    if (!customerSearch.trim()) return [];
    const q = customerSearch.toLowerCase();
    return customers.filter(c => c.name?.toLowerCase().includes(q) || c.phone?.includes(q)).slice(0, 5);
  }, [customers, customerSearch]);

  // Gate 3: aviso reativo (não remove nada). Ex.: remover o lanche deixa
  // a batata órfã — o submit e o servidor barram; aqui só avisamos.
  const depErrors = useMemo(
    () => checkCartDependencies(items, depRules, buildDepModesFromProducts(products)),
    [items, depRules, products],
  );

  const addItem = (product) => {
    // Busca a config (com cache) para decidir: com etapa obrigatória abre
    // o Montar; sem config obrigatória adiciona a linha avulsa. Falha de
    // leitura NUNCA vira item avulso silenciosamente.
    void (async () => {
      try {
        if (await ensureRequiredConfig(product, true)) addPlainItem(product);
      } catch (err) {
        toast({
          title: 'Erro ao carregar montagem',
          description: `${err?.message || 'Tente novamente.'} O item não foi adicionado.`,
          variant: 'destructive',
        });
      }
    })();
  };

  const ensureRequiredConfig = async (product, openWhenRequired) => {
    let cfg = configCache[product.id];
    if (cfg === undefined && company) {
      cfg = await getProductConfig(supabase, company.id, product.id);
      setConfigCache((prev) => ({ ...prev, [product.id]: cfg }));
    }
    const steps = cfg?.steps || [];
    const needsConfig = steps.some((s) => s.required || (Number(s.min_select) || 0) > 0);
    if (needsConfig && openWhenRequired) {
      toast({ title: 'Montagem obrigatória', description: 'Escolha as opções para adicionar.' });
      openConfigure(product);
      return false;
    }
    return true;
  };

  const addPlainItem = (product) => {
    const unit = product.promotional_price != null ? product.promotional_price : product.price;
    setItems(prev => {
      // Só mescla em linha avulsa (sem config); configuradas têm identidade própria.
      const i = prev.findIndex(x => x.product_id === product.id && !x.config && !x.persisted);
      if (i >= 0) {
        const next = [...prev];
        next[i] = { ...next[i], quantity: next[i].quantity + 1 };
        return next;
      }
      return [...prev, {
        id: product.id,
        product_id: product.id, name: product.name, image_url: product.image_url,
        unit_price: unit, quantity: 1, complements: [], notes: '',
      }];
    });
  };

  // Linha configurada (V2): mescla por produto+complementos+notas+config.
  const addConfiguredLine = (product, quantity, complements, notes, config, options = {}) => {
    const unit = product.promotional_price != null ? product.promotional_price : product.price;
    const line = {
      id: `${product.id}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      product_id: product.id, name: product.name, image_url: product.image_url,
      unit_price: unit, quantity, complements: complements || [], notes: notes || '',
      ...(config ? { config } : {}),
      ...(options.pendingUpdate ? { pendingUpdate: true } : {}),
    };
    setItems((prev) => {
      const base = configuringEditId ? prev.filter((x) => x.id !== configuringEditId) : prev;
      if (options.pendingUpdate) return [...base, line];
      return mergeDraftLine(base, line);
    });
    setConfiguringEditId(null);
  };

  // Abre a montagem V2 do produto (config sob demanda, com cache).
  const openConfigure = async (lineOrProduct) => {
    const productId = lineOrProduct.product_id || lineOrProduct.id;
    const catalogProduct = products.find((p) => p.id === productId);
    const base = catalogProduct || {
      ...lineOrProduct,
      id: productId,
      price: lineOrProduct.unit_price ?? lineOrProduct.price ?? 0,
    };
    if (!company) return;
    try {
      let cfg = configCache[productId];
      if (!cfg) {
        cfg = await getProductConfig(supabase, company.id, productId);
        setConfigCache((prev) => ({ ...prev, [productId]: cfg }));
      }
      const editingLine = lineOrProduct.product_id ? lineOrProduct : null;
      setConfiguringEditId(editingLine?.id || null);
      setConfiguring({
        ...base,
        initialItem: editingLine,
        config: {
          steps: (cfg.steps || []).map((s) => ({
            ...s,
            options: (cfg.options || []).filter((o) => o.step_id === s.id),
          })),
        },
      });
    } catch (err) {
      toast({ title: 'Erro ao carregar montagem', description: err?.message, variant: 'destructive' });
    }
  };

  const changeQty = (lineId, delta) => {
    setItems(prev => prev
      .map(x => (x.id === lineId && !x.persisted ? { ...x, quantity: x.quantity + delta } : x))
      .filter(x => x.quantity > 0));
  };

  const removeItem = (lineId) => setItems(prev => prev.filter(x => x.id !== lineId || x.persisted));

  const setItemNotes = (lineId, notes) => {
    setItems(prev => prev.map(x => (x.id === lineId && !x.persisted ? { ...x, notes } : x)));
  };

  const zone = zones.find(z => z.id === deliveryZoneId);
  const fee = orderType === 'delivery' ? (zone?.fee ?? company?.delivery_fee ?? 0) : 0;
  const { subtotal, count: itemCount } = calcPdvTotals(items, fee);
  const discountValue = Math.max(0, Math.min(Number(discount) || 0, subtotal));
  const total = subtotal + fee - discountValue;

  const resetDraft = (keepTable = false) => {
    setItems([]);
    setCustomer({ name: '', phone: '' });
    setCustomerSearch('');
    setPaymentMethod('');
    setChangeFor('');
    setDiscount('');
    setDriverId('');
    setNotifyState('');
    setNoteOpenId(null);
    setSelectedComandaId(null);
    if (!keepTable) {
      setSelectedTableId(null);
      setTableNumber('');
      setAddress('');
      setDeliveryZoneId('');
    }
  };

  // Troca de modalidade nunca mistura comanda de mesa com outro tipo. Ao sair
  // de uma comanda, a c�pia local dos itens j� enviados � descartada; apenas
  // linhas novas (ainda n�o persistidas) seguem para o novo pedido.
  const selectOrderType = (t) => {
    if (t === orderType) return;
    if (t !== 'mesa') {
      if (selectedComandaId) {
        if (hasLocalDraftItems(items)
          && !window.confirm('Os itens já enviados sairão deste rascunho. Os itens novos ainda não enviados serão mantidos. Continuar?')) return;
        setItems((prev) => localDraftItemsOnly(prev));
        setSelectedComandaId(null);
      }
      setSelectedTableId(null);
      setTableNumber('');
    }
    setOrderType(t);
    if (t !== 'mesa') setOrderModalOpen(false);
  };

  const changePdvView = (view) => {
    if (view !== 'produtos' && view !== 'mesas') return;
    setPdvViewState(view);
    persistPdvView(view);
    if (view === 'mesas') setTableCardSearch('');
  };

  // Trocar de mesa/comanda só descarta rascunho não enviado com confirmação.
  const canReplaceDraft = () => {
    if (!hasLocalDraftItems(items)) return true;
    return window.confirm('H� itens n�o enviados. Descartar este rascunho e continuar?');
  };

  const startNewComanda = (card, { notify = true } = {}) => {
    if (!card) return;
    if (!canReplaceDraft(null)) return;
    resetDraft(false);
    setOrderType('mesa');
    setSelectedTableId(card.tableId || null);
    setTableNumber(card.name || '');
    setTableOpen(false);
    setTablePickerName('');
    setTablePickerId(null);
    setMergeTable(null);
    setMergeCard(null);
    setMergeIds([]);
    setOrderModalOpen(true);
    if (notify) toast({ title: card.name ? `Nova comanda na Mesa ${card.name}` : 'Nova comanda' });
  };

  const openTableCard = (card, sourceOrders = mesaOrders) => {
    if (!card) return;
    if (card.comandas.length === 0) {
      startNewComanda(card, { notify: false });
      return;
    }
    // Abre o card da mesa direto. Com v�rias comandas, a mais recente por
    // created_date vira a sele��o inicial; as demais ficam no pr�prio card.
    const tableComandas = comandasForTable(
      sourceOrders,
      card.tableId,
      card.name,
      company?.id,
    );
    const cardOrders = sourceOrders.filter((o) => card.comandas.some((c) => c.id === o.id));
    const latest = pickLatestComanda(tableComandas) || pickLatestComanda(cardOrders);
    if (!latest) return;
    if (!canReplaceDraft()) return;
    loadComanda(latest, { openOrder: true });
  };

  const openMergeForCard = (card) => {
    if (!card) return;
    setOrderModalOpen(false);
    setMergeTable(card.name || '');
    setMergeCard(card);
    setMergeIds([]);
    setTableOpen(false);
    setTablePickerName('');
    setTablePickerId(null);
  };

  const pickRegisteredTable = (t) => {
    const card = findTableCard(tableCards, { tableId: t.id, tableName: t.name });
    if (card) openTableCard(card);
  };

  // Mesa → comanda ativa → cliente (nome/telefone automáticos).
  const loadComanda = (order, { openOrder = false } = {}) => {
    if (!order) return;
    setOrderType('mesa');
    setSelectedTableId(order.table_id || null);
    setTableNumber(order.table_number || '');
    setCustomer({ name: order.customer_name || '', phone: order.customer_phone || '' });
    setCustomerSearch('');
    setPaymentMethod(order.payment_method || '');
    setDiscount(String(order.discount || ''));
    setItems((Array.isArray(order.items) ? order.items : [])
      .map((item) => ({ ...toPdvDraftItem(item), persisted: true })));
    setNoteOpenId(null);
    setSelectedComandaId(order.id);
    setTableOpen(false);
    setTablePickerName('');
    setTablePickerId(null);
    setMergeTable(null);
    setMergeCard(null);
    setMergeIds([]);
    if (openOrder) {
      setOrderModalOpen(true);
    }
  };

  const pickTable = (table) => {
    const t = normalizeTable(table);
    const card = findTableCard(tableCards, { tableName: t });
    if (card) {
      openTableCard(card);
      return;
    }
    if (!canReplaceDraft()) return;
    setOrderType('mesa');
    const reg = registeredTables.find((r) => normalizeTable(r.name) === t);
    setSelectedTableId(reg ? reg.id : null);
    setTableNumber(t);
    setTableOpen(false);
    setTablePickerName('');
    setTablePickerId(null);
    setMergeTable(null);
    setMergeCard(null);
    setMergeIds([]);
    setOrderModalOpen(true);
  };

  const newComanda = (table, tableId = null) => {
    const t = normalizeTable(table) || normalizeTable(tableNumber);
    const reg = registeredTables.find((r) => normalizeTable(r.name) === t);
    const card = findTableCard(tableCards, { tableId: tableId || reg?.id, tableName: t }) || {
      tableId: tableId || reg?.id || null,
      name: t,
      comandas: [],
    };
    startNewComanda(card);
  };

  const openDetail = async (orderId) => {
    try {
      const detail = await getOrderDetail(supabase, company.id, orderId);
      if (detail) {
        setTableOpen(false);
        setDetailOrder(detail);
      }
    } catch (err) {
      toast({ title: 'Erro ao abrir comanda', description: err?.message, variant: 'destructive' });
    }
  };

  const selectTableComanda = (orderId) => {
    if (orderId === selectedComandaId) return;
    const full = currentComandas.find((o) => o.id === orderId)
      || mesaOrders.find((o) => o.id === orderId);
    if (!full) return;
    if (!canReplaceDraft()) return;
    loadComanda(full, { openOrder: true });
  };

  const newComandaFromCard = () => {
    if (!tableLabel) return;
    newComanda(tableLabel, selectedTableId);
  };

  const mergeFromCard = () => {
    if (selectedCard) openMergeForCard(selectedCard);
  };

  const requestPayment = (order) => {
    const phone = (order.customer_phone || order.customer_data?.phone || '').replace(/\D/g, '');
    const who = order.customer_name || 'Olá';
    const msg = `${who}! Sua comanda da Mesa ${order.table_number || ''} (Pedido #${order.order_number}) totalizou ${fmtCurrency(order.total)}. Segue para pagamento. Obrigado!`;
    // Sem automação de WhatsApp nesta fase (u17 = em breve): abre conversa.
    const url = phone ? `https://wa.me/${phone}?text=${encodeURIComponent(msg)}` : buildWhatsAppUrl(msg);
    window.open(url, '_blank', 'noopener');
  };

  const runMerge = async () => {
    if (!mergeConfirm || mergeConfirm.comandas.length < 2) return;
    setMerging(true);
    try {
      const full = mergeConfirm.comandas
        .map(c => mesaOrders.find(o => o.id === c.id))
        .filter(Boolean);
      if (full.length < 2) throw new Error('Comandas não encontradas. Recarregue e tente de novo.');
      const [target, ...sources] = full;
      await editOrder(supabase, target.id, {
        items: mergeComandaItems(full.map(o => o.items)),
      });
      const failed = [];
      for (const s of sources) {
        try {
          await cancelOrder(supabase, s.id, `Juntada à comanda #${target.order_number} (Mesa ${mergeConfirm.table})`);
        } catch {
          failed.push(`#${s.order_number}`);
        }
      }
      if (failed.length > 0) {
        toast({
          title: 'Junção parcial',
          description: `Itens somados na comanda #${target.order_number}, mas não foi possível cancelar: ${failed.join(', ')}. Cancele manualmente em Pedidos.`,
          variant: 'destructive',
        });
      } else {
        toast({ title: `Comandas juntadas na #${target.order_number}!` });
      }
      setMergeConfirm(null);
      setMergeTable(null);
      setMergeCard(null);
      setMergeIds([]);
      setTableOpen(false);
      if (selectedComandaId && sources.some(s => s.id === selectedComandaId)) {
        const fresh = await getOrderDetail(supabase, company.id, target.id).catch(() => null);
        if (fresh) loadComanda(fresh);
        else setSelectedComandaId(null);
      }
      refreshMesaOrders();
    } catch (err) {
      toast({ title: 'Erro ao juntar comandas', description: err?.message, variant: 'destructive' });
    } finally {
      setMerging(false);
    }
  };

  const handleSubmit = async (overrideItems = null) => {
    // Guarda anti-duplo no topo: antes das validações, para toques
    // repetidos nunca gerarem nem toast duplicado nem pedido duplo.
    if (submitRef.current) return { ok: false, error: 'Envio em andamento. Aguarde.' };
    const submitItems = Array.isArray(overrideItems) ? overrideItems : items;
    // Validação única por tentativa (validatePdvDraft retorna o 1º erro).
    const invalid = validatePdvDraft({
      items: submitItems, orderType, tableNumber, customer, address, paymentMethod, changeFor,
    });
    if (invalid) {
      toast({ title: invalid.title, description: invalid.description, variant: 'destructive' });
      return { ok: false, error: invalid.description || invalid.title };
    }
    // Dependências entre produtos (regra da loja; servidor revalida).
    const depErrors = checkCartDependencies(submitItems, depRules, buildDepModesFromProducts(products));
    if (depErrors.length > 0) {
      toast({ title: 'Item incompatível', description: depErrors[0].message, variant: 'destructive' });
      return { ok: false, error: depErrors[0].message };
    }
    const changeForValue = paymentMethod === 'Dinheiro' && String(changeFor).trim() !== ''
      ? Number(String(changeFor).replace(',', '.'))
      : null;
    // Desconto incide sobre o conjunto efetivamente enviado (inclui a linha
    // montada no modo automático, que ainda não está no rascunho).
    const submitSubtotal = calcPdvTotals(submitItems, fee).subtotal;
    const submitDiscountValue = Math.max(0, Math.min(Number(discount) || 0, submitSubtotal));
    submitRef.current = true;
    setSubmitting(true);
    // Idempotência: uma chave por tentativa — retry do mesmo submit
    // reaproveita; nova tentativa gera nova chave. Servidor retorna o
    // pedido existente em vez de duplicar.
    const attemptKey = crypto.randomUUID();
    try {
      const apiItems = buildCreateOrderItems(submitItems);
      let number;
      let savedId = null;
      if (selectedComanda) {
        // Comanda existente: soma ao pedido via edit (totais recalculados no backend).
        await editOrder(supabase, selectedComanda.id, { items: apiItems, discount: submitDiscountValue });
        number = selectedComanda.order_number;
        savedId = selectedComanda.id;
        toast({ title: `Comanda #${number} atualizada!` });
      } else {
        const created = await createOrder(supabase, {
          companySlug: company.slug,
          orderType,
          tableNumber,
          tableId: selectedTableId,
          items: apiItems,
          customer: { name: customer.name, phone: customer.phone, address },
          deliveryZoneId: deliveryZoneId || null,
          paymentMethod: paymentMethod || null,
          notes: '',
          changeFor: changeForValue,
          // Desconto atômico no create (servidor valida 0<=d<=subtotal).
          discount: submitDiscountValue,
          idempotencyKey: attemptKey,
          // FASE 2: PDV é atendimento presencial (balcão) — funciona mesmo
          // com o restaurante fechado para pedidos online (is_open=false).
          source: 'balcao',
        });
        number = created.order_number;
        savedId = created.order_id;
        // Entrega com entregador escolhido: associa ao pedido (sem notificar sozinho).
        if (orderType === 'delivery' && driverId) {
          try {
            await assignDriver(supabase, savedId, company.id, driverId);
          } catch {
            toast({ title: `Pedido #${number} criado sem entregador`, description: 'Associe o entregador em Pedidos.', variant: 'destructive' });
          }
        }
        toast({ title: `Pedido #${number} criado!` });
      }
      setDoneOrder({ order_id: savedId, order_number: number, order_type: orderType, driver_id: driverId || null });
      setNotifyState('');
      const keepTable = orderType === 'mesa';
      resetDraft(keepTable);
      // Configuração pode ter mudado (preço/opção/etapa): próximo item
      // sempre consulta o estado atual em vez de reutilizar cache antigo.
      setConfigCache({});
      await refreshMesaOrders();
      return { ok: true, orderNumber: number, orderId: savedId };
    } catch (err) {
      const message = err?.message || 'Falha ao salvar o pedido.';
      toast({ title: 'Erro ao criar pedido', description: message, variant: 'destructive' });
      return { ok: false, error: message };
    } finally {
      setSubmitting(false);
      submitRef.current = false;
    }
  };

  const handleModalSubmit = async () => {
    const result = await handleSubmit();
    if (result?.ok) setOrderModalOpen(false);
    return result;
  };

  const addAutoLine = (line) => {
    const product = line?.product || products.find((p) => p.id === line?.product_id);
    if (!product) return;
    addConfiguredLine(
      product,
      line.quantity || 1,
      line.complements || [],
      line.notes || '',
      line.config,
    );
  };

  const handleCustomerNameChange = (value) => {
    setCustomerSearch(value);
    setCustomer((prev) => ({ ...prev, name: value }));
  };

  const handlePickCustomer = (c) => {
    setCustomer({ name: c.name, phone: c.phone || '' });
    setCustomerSearch('');
  };

  // Notificação manual ao entregador: busca o pedido persistido, monta a
  // mensagem com dados reais, abre o wa.me e registra NO MÁXIMO "iniciado".
  const notifyDriver = async () => {
    const notifyDriverId = doneOrder?.driver_id;
    if (!doneOrder?.order_id || !notifyDriverId || notifying) return;
    const driver = drivers.find((d) => d.id === notifyDriverId);
    if (!driver?.phone) {
      setNotifyState('Entregador sem telefone válido.');
      return;
    }
    setNotifying(true);
    try {
      const detail = await getOrderDetail(supabase, company.id, doneOrder.order_id);
      if (!detail) throw new Error('Pedido não encontrado.');
      // Revalida o entregador no momento do envio (lista pode estar defasada).
      const fresh = await getDriver(supabase, company.id, driver.id);
      if (!fresh || !fresh.phone) throw new Error('Entregador inválido para esta empresa.');
      const url = buildDriverDeliveryUrl(detail, fresh);
      await markDriverNotified(supabase, company.id, {
        orderId: doneOrder.order_id, driverId: driver.id,
        message: `Conversa iniciada manualmente pelo PDV (pedido #${detail.order_number}).`,
      });
      window.open(url, '_blank', 'noopener');
      setNotifyState('Conversa aberta no WhatsApp (envio manual). Status: iniciado.');
    } catch (err) {
      setNotifyState(`Falha ao preparar notificação: ${err?.message || 'tente de novo.'}`);
    } finally {
      setNotifying(false);
    }
  };

  if (loading || dataLoading) return <Spinner />;
  if (!company) return null;

  const renderProductBrowser = () => (
    <PdvProductCatalog
      products={products}
      categories={categories}
      items={items}
      search={search}
      onSearchChange={setSearch}
      filterCat={filterCat}
      onFilterCatChange={setFilterCat}
      onAdd={addItem}
      onQty={changeQty}
    />
  );

  const occupiedCardCount = tableCards.filter((c) => c.comandas.length > 0).length;
  const tableLabel = selectedCard?.name || tableNumber;
  const editingPersisted = !!configuring?.initialItem?.persisted || !!configuring?.initialItem?.pendingUpdate;

  return (
    <div className={`flex flex-col lg:h-[calc(100vh-4rem)] lg:min-h-0 lg:overflow-hidden ${items.length > 0 ? 'pb-20 lg:pb-0' : ''}`}>
      <div className="shrink-0 mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-heading text-xl font-bold text-foreground">🧾 PDV</h1>
        </div>
        <div className="flex shrink-0 rounded-xl border border-border bg-muted/40 p-1" role="tablist" aria-label="Visualização do PDV">
          <button
            type="button"
            role="tab"
            aria-selected={pdvView === 'produtos'}
            onClick={() => changePdvView('produtos')}
            className={`flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors ${pdvView === 'produtos' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <Package className="h-4 w-4" /> Produtos
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={pdvView === 'mesas'}
            onClick={() => changePdvView('mesas')}
            className={`flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors ${pdvView === 'mesas' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <Table2 className="h-4 w-4" /> Mesas
            {occupiedCardCount > 0 && (
              <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] text-primary-foreground">{occupiedCardCount}</span>
            )}
          </button>
        </div>
      </div>

      {doneOrder && (
        <div className="mb-3 shrink-0 rounded-2xl border border-green-200 bg-green-50 p-4">
          <div className="flex items-center gap-3">
            <CheckCircle className="h-6 w-6 text-green-600 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-foreground">Pedido #{doneOrder.order_number} salvo!</p>
              {notifyState && <p className="text-xs text-muted-foreground mt-0.5">{notifyState}</p>}
            </div>
            <Button variant="outline" size="sm" onClick={() => { setDoneOrder(null); setNotifyState(''); }}>Nova venda</Button>
          </div>
          {doneOrder.order_id && (
            <div className="flex flex-wrap gap-2 mt-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(`/impressao/${doneOrder.order_id}?modo=cozinha`, '_blank', 'noopener')}
              >
                <Printer className="h-3.5 w-3.5" /> Cupom cozinha
              </Button>
              {doneOrder.order_type === 'delivery' && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(`/impressao/${doneOrder.order_id}?modo=pacote`, '_blank', 'noopener')}
                >
                  <Tag className="h-3.5 w-3.5" /> Etiqueta pacote
                </Button>
              )}
              {doneOrder.order_type === 'delivery' && doneOrder.driver_id && (
                <Button variant="outline" size="sm" onClick={notifyDriver} disabled={notifying}>
                  <MessageCircle className="h-3.5 w-3.5" /> {notifying ? 'Preparando...' : 'Avisar entregador'}
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3 flex-1 min-h-0 lg:overflow-hidden">
        {/* Catálogo (Produtos) ou mesas + montagem da mesa */}
        <div className="lg:col-span-2 min-w-0 flex flex-col gap-3 lg:h-full lg:min-h-0">
          {pdvView === 'produtos' ? renderProductBrowser() : (
            <PdvTableView
              tableCards={tableCards}
              search={tableCardSearch}
              onSearchChange={setTableCardSearch}
              error={mesaError || tablesError}
              loading={mesaLoading || tablesLoading}
              onRetry={retryMesas}
              onOpenTable={openTableCard}
            />
          )}
        </div>

        {/* Pedido atual */}
        <div className="min-w-0 flex flex-col lg:h-full lg:min-h-0">
          <div className="rounded-2xl border border-border bg-card p-4 flex flex-col gap-3 lg:h-full lg:min-h-0 lg:overflow-hidden">
            <div className="shrink-0 space-y-3">
            <div>
              <Label className="mb-2 block">Tipo do pedido</Label>
              <div className="grid grid-cols-3 gap-1.5">
                {ORDER_TYPES.map(t => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => selectOrderType(t.id)}
                    className={`flex flex-col items-center gap-0.5 rounded-xl border px-1 py-2 text-[11px] font-medium transition-colors min-w-0 ${orderType === t.id ? 'border-primary bg-primary/5 text-foreground' : 'border-border text-muted-foreground'}`}
                  >
                    <t.icon className="h-4 w-4 shrink-0" />
                    <span className="truncate leading-tight">{t.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {orderType === 'mesa' && (
              <div className="space-y-1.5">
                <Label>🍽️ Mesa *</Label>
                {registeredTables.length > 0 ? (
                  <>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input value={tableSearch} onChange={(e) => setTableSearch(e.target.value)} placeholder="Buscar mesa..." className="pl-9 h-9" />
                    </div>
                    <div className="grid grid-cols-3 gap-1.5 max-h-44 overflow-y-auto pr-0.5">
                      {filteredTables.map((t) => {
                        const card = findTableCard(tableCards, { tableId: t.id, tableName: t.name });
                        const busy = (card?.comandas?.length || 0) > 0;
                        const active = selectedTableId === t.id;
                        return (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => pickRegisteredTable(t)}
                            title={t.notes || t.name}
                            aria-label={`Mesa ${t.name}${busy ? ' (ocupada)' : ''}`}
                            className={`min-h-11 rounded-xl border px-1.5 py-1.5 text-xs font-medium transition-colors ${
                              active ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:bg-muted/50'
                            }`}
                          >
                            <span className="block truncate leading-tight">{t.name}</span>
                            {busy && <span className="block text-[10px] text-amber-600 leading-tight">● ocupada</span>}
                          </button>
                        );
                      })}
                    </div>
                    {filteredTables.length === 0 && (
                      <p className="text-xs text-muted-foreground">Nenhuma mesa com esse nome.</p>
                    )}
                  </>
                ) : (
                  <div className="rounded-xl border border-dashed border-border p-3 text-center">
                    <p className="text-xs text-muted-foreground">Nenhuma mesa cadastrada. Configure em Configurações &gt; PDV.</p>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => { setOrderModalOpen(false); setTablePickerName(''); setTablePickerId(null); setTableOpen(true); }}
                  className="flex w-full items-center gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-sm min-w-0 text-left hover:bg-muted/50"
                >
                  <span className="flex-1 min-w-0 truncate">
                    {tableNumber ? `Mesa ${tableNumber}` : 'Comandas / digitar número...'}
                    {currentComandas.length > 0 && (
                      <span className="text-muted-foreground"> • {currentComandas.length} {currentComandas.length === 1 ? 'comanda' : 'comandas'}</span>
                    )}
                  </span>
                  <span className="text-xs text-primary font-medium shrink-0">Trocar</span>
                </button>
                {selectedComanda && (
                  <p className="text-xs text-muted-foreground truncate">
                    👥 Comanda #{selectedComanda.order_number} • 👤 {selectedComanda.customer_name || 'Sem cliente'}
                  </p>
                )}
              </div>
            )}
            </div>

            <div className="flex-1 min-h-0 lg:overflow-y-auto space-y-4 lg:pr-1">
            <div className="space-y-1.5">
              <Label>👤 Cliente{orderType === 'delivery' ? ' *' : ' (opcional)'}</Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input value={customerSearch || customer.name} onChange={e => { setCustomerSearch(e.target.value); setCustomer({ name: e.target.value, phone: customer.phone }); }} placeholder="Buscar ou nome avulso" className="pl-9" />
              </div>
              {matchedCustomers.length > 0 && (
                <div className="rounded-xl border border-border overflow-hidden">
                  {matchedCustomers.map(c => (
                    <button key={c.id} type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-muted truncate" onClick={() => { setCustomer({ name: c.name, phone: c.phone || '' }); setCustomerSearch(''); }}>
                      {c.name} {c.phone && <span className="text-muted-foreground">• {c.phone}</span>}
                    </button>
                  ))}
                </div>
              )}
              <Input value={customer.phone} onChange={e => setCustomer({ ...customer, phone: e.target.value })} placeholder="Telefone" inputMode="tel" />
            </div>

            {orderType === 'delivery' && (
              <div className="space-y-1.5">
                <Label>Endereço *</Label>
                <Input value={address} onChange={e => setAddress(e.target.value)} placeholder="Rua, número, bairro" />
                {zones.length > 0 && (
                  <select value={deliveryZoneId} onChange={e => setDeliveryZoneId(e.target.value)} className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm min-w-0">
                    <option value="">Zona padrão ({fmtCurrency(company?.delivery_fee)})</option>
                    {zones.map(z => <option key={z.id} value={z.id}>{z.name} — {fmtCurrency(z.fee)}</option>)}
                  </select>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <Label>💳 Pagamento</Label>
              <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)} className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm min-w-0">
                <option value="">Selecione...</option>
                {PAYMENTS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              {paymentMethod === 'Dinheiro' && (
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground shrink-0">Troco para R$</Label>
                  <Input
                    value={changeFor}
                    onChange={e => setChangeFor(e.target.value.replace(/[^0-9.,]/g, '').replace(',', '.'))}
                    placeholder="0,00"
                    inputMode="decimal"
                    className="h-8 text-right"
                    aria-label="Troco para quanto"
                  />
                </div>
              )}
            </div>

            {orderType === 'delivery' && drivers.length > 0 && (
              <div className="space-y-1.5">
                <Label>🛵 Entregador</Label>
                <select value={driverId} onChange={e => setDriverId(e.target.value)} className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm min-w-0">
                  <option value="">Sem entregador (associar depois)</option>
                  {drivers.map(d => <option key={d.id} value={d.id}>{d.name}{d.vehicle_type ? ` • ${d.vehicle_type}` : ''}</option>)}
                </select>
              </div>
            )}

            <div className="min-w-0">
              {selectedComanda ? (
                <button
                  type="button"
                  onClick={() => openDetail(selectedComanda.id)}
                  className="mb-2 shrink-0 flex items-center gap-1 text-left rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  title="Abrir detalhes da comanda"
                >
                  <Label className="cursor-pointer">🧾 Itens ({itemCount}) — ver detalhes</Label>
                </button>
              ) : (
                <Label className="mb-2 block shrink-0">🧾 Itens ({itemCount})</Label>
              )}
              {items.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4 shrink-0">Toque em + nos produtos.</p>
              ) : (
                                <div className="space-y-2 max-h-64 lg:max-h-none overflow-y-auto lg:overflow-visible pr-1">
                  {items.map(x => (
                    <div key={x.id || x.product_id} className="rounded-xl border border-border p-2 min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{x.name}</p>
                          <p className="text-xs text-muted-foreground">{fmtCurrency(x.unit_price)} cada</p>
                          {x.persisted && (
                            <p className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-amber-700">
                              <Lock className="h-3 w-3" /> Enviado
                            </p>
                          )}
                          {(x.complements || []).length > 0 && (
                            <p className="text-[11px] text-muted-foreground truncate">
                              + {x.complements.map(c => `${c.quantity > 1 ? `${c.quantity}x ` : ''}${c.option_name || c.name}`).join(', ')}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button type="button" aria-label="Diminuir" disabled={x.persisted} onClick={() => changeQty(x.id || x.product_id, -1)} className="flex h-8 w-8 items-center justify-center rounded-md border border-border hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"><Minus className="h-3.5 w-3.5" /></button>
                          <span className="w-6 text-center text-sm font-medium">{x.quantity}</span>
                          <button type="button" aria-label="Aumentar" disabled={x.persisted} onClick={() => changeQty(x.id || x.product_id, 1)} className="flex h-8 w-8 items-center justify-center rounded-md border border-border hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"><Plus className="h-3.5 w-3.5" /></button>
                          <button type="button" aria-label={`Remover ${x.name}`} disabled={x.persisted} onClick={() => removeItem(x.id || x.product_id)} className="flex h-8 w-8 items-center justify-center rounded-md text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-40"><Trash2 className="h-4 w-4" /></button>
                        </div>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <button
                          type="button"
                          disabled={x.persisted}
                          onClick={() => openConfigure(x)}
                          className="text-[11px] font-medium text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          ⚙️ Montar
                        </button>
                        <button
                          type="button"
                          disabled={x.persisted}
                          onClick={() => setNoteOpenId(noteOpenId === (x.id || x.product_id) ? null : (x.id || x.product_id))}
                          className="text-[11px] text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {x.notes ? `📝 ${x.notes}` : '+ obs do item'}
                        </button>
                      </div>
                      {x.persisted ? (
                        <p className="mt-1 text-[11px] text-muted-foreground">Item já enviado. Ajustes pela tela de Pedidos.</p>
                      ) : noteOpenId === (x.id || x.product_id) && (
                        <Input
                          value={x.notes || ''}
                          onChange={e => setItemNotes(x.id || x.product_id, e.target.value)}
                          placeholder="Ex.: sem cebola, ponto da carne..."
                          className="mt-1 h-8 text-xs"
                          aria-label={`Observação de ${x.name}`}
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
              {depErrors.length > 0 && (
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-800" role="alert">
                  {depErrors.map((e) => (
                    <p key={e.productId}>⚠️ {e.message}</p>
                  ))}
                </div>
              )}
            </div>
            </div>

            <div className="shrink-0 space-y-1 pt-2 border-t border-border text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{fmtCurrency(subtotal)}</span></div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Desconto</span>
                <div className="flex items-center gap-1">
                  <span className="text-muted-foreground text-xs">R$</span>
                  <Input
                    value={discount}
                    onChange={e => setDiscount(e.target.value.replace(/[^0-9.,]/g, '').replace(',', '.'))}
                    placeholder="0,00"
                    inputMode="decimal"
                    className="h-8 w-24 text-right"
                    aria-label="Desconto em reais"
                  />
                </div>
              </div>
              {discountValue > 0 && (
                <div className="flex justify-between text-green-600"><span>Desconto aplicado</span><span>-{fmtCurrency(discountValue)}</span></div>
              )}
              {orderType === 'delivery' && (
                <div className="flex justify-between"><span className="text-muted-foreground">Taxa de entrega</span><span>{fmtCurrency(fee)}</span></div>
              )}
              <div className="flex justify-between font-heading text-lg font-bold pt-1"><span>💰 Total</span><span>{fmtCurrency(total)}</span></div>
            </div>

            {selectedComanda && (
              <Button variant="outline" className="w-full shrink-0" onClick={() => requestPayment(selectedComanda)}>
                💳 Solicitar pagamento
              </Button>
            )}
            <Button className="w-full h-11 shrink-0" onClick={handleSubmit} disabled={submitting || items.length === 0}>
              {submitting ? 'Enviando...' : selectedComanda ? 'Enviar pedido' : 'Finalizar pedido'}
            </Button>
          </div>
        </div>
      </div>

      {/* Resumo fixo no mobile */}
      {items.length > 0 && (
        <div className="lg:hidden fixed bottom-0 inset-x-0 z-20 border-t border-border bg-card px-4 py-3 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground">{itemCount} itens</p>
            <p className="font-heading font-bold">{fmtCurrency(total)}</p>
          </div>
          <Button onClick={handleSubmit} disabled={submitting} className="h-11 px-6">Finalizar</Button>
        </div>
      )}

      {/* Pedido em modal: montagem, revisão e envio sem sair da mesa. */}
      <PdvOrderModal
        open={orderModalOpen}
        onClose={() => setOrderModalOpen(false)}
        companyId={company?.id || ''}
        tableName={tableLabel}
        selectedComanda={selectedComanda}
        tableComandas={modalTableComandas}
        onSelectComanda={selectTableComanda}
        onNewComanda={newComandaFromCard}
        onMergeComandas={mergeFromCard}
        onAutoAdd={addAutoLine}
        products={products}
        categories={categories}
        items={items}
        search={search}
        onSearchChange={setSearch}
        filterCat={filterCat}
        onFilterCatChange={setFilterCat}
        onAdd={addItem}
        onQty={changeQty}
        onRemove={removeItem}
        onEdit={openConfigure}
        noteOpenId={noteOpenId}
        onToggleNote={(id) => setNoteOpenId((prev) => (prev === id ? null : id))}
        onNotesChange={setItemNotes}
        subtotal={subtotal}
        discount={discount}
        onDiscountChange={setDiscount}
        discountValue={discountValue}
        total={total}
        itemCount={itemCount}
        customer={customer}
        customerSearch={customerSearch}
        onCustomerNameChange={handleCustomerNameChange}
        onCustomerPhoneChange={(phone) => setCustomer((prev) => ({ ...prev, phone }))}
        matchedCustomers={matchedCustomers}
        onPickCustomer={handlePickCustomer}
        paymentMethod={paymentMethod}
        onPaymentMethodChange={setPaymentMethod}
        changeFor={changeFor}
        onChangeForChange={setChangeFor}
        payments={PAYMENTS}
        depErrors={depErrors}
        submitting={submitting}
        onSubmit={handleModalSubmit}
      />

      {/* Seletor de mesa / comandas */}
      <TableSelectModal
        key={`tables:${tablePickerId || tablePickerName || tableNumber || 'none'}`}
        open={tableOpen}
        onClose={() => { setTableOpen(false); setTablePickerName(''); setTablePickerId(null); setMergeTable(null); setMergeCard(null); setMergeIds([]); }}
        mesaOrders={mesaOrders}
        tableCards={tableCards}
        initialTable={tablePickerName || tableNumber}
        onPickTable={pickTable}
        onPickCard={openTableCard}
        onPickComanda={selectTableComanda}
        onNewComanda={newComanda}
        onMergeTable={(table, tableId) => {
          const card = findTableCard(tableCards, { tableId, tableName: table });
          setTableOpen(false);
          setTablePickerName('');
          setTablePickerId(null);
          if (card) openMergeForCard(card);
          else { setMergeTable(table); setMergeCard(null); setMergeIds([]); }
        }}
        onViewComanda={openDetail}
      />

      {/* Escolha de comandas para juntar (dentro do contexto da mesa) */}
      {mergeTable && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => { setMergeTable(null); setMergeCard(null); setMergeIds([]); }} />
          <div className="relative w-full max-w-md">
            <TableMergePicker
              table={mergeTable}
              comandas={mergeCard?.comandas || tables.find(x => x.table === mergeTable)?.comandas || []}
              selected={mergeIds}
              onToggle={(id) => setMergeIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])}
              onCancel={() => { setMergeTable(null); setMergeCard(null); setMergeIds([]); setTablePickerName(''); setTablePickerId(null); setTableOpen(true); }}
              onContinue={() => {
                const all = mergeCard?.comandas || tables.find(x => x.table === mergeTable)?.comandas || [];
                setMergeConfirm({ table: mergeTable, comandas: all.filter(c => mergeIds.includes(c.id)) });
              }}
            />
          </div>
        </div>
      )}

      {/* Dupla confirmação da junção */}
      <MergeConfirmModal
        open={!!mergeConfirm}
        onClose={() => { if (!merging) setMergeConfirm(null); }}
        table={mergeConfirm?.table || ''}
        comandas={mergeConfirm?.comandas || []}
        busy={merging}
        onConfirm={runMerge}
      />

      {/* Detalhe da comanda (reuso do OrderModal) */}
      <OrderModal
        order={detailOrder}
        isOpen={!!detailOrder}
        onClose={() => setDetailOrder(null)}
        company={company}
        driver={null}
        onOrderUpdated={(updated) => {
          setDetailOrder(updated);
          setMesaOrders(prev => prev.map(o => o.id === updated.id ? { ...o, ...updated } : o));
        }}
        onCancel={() => setCancelTarget(detailOrder)}
        onSelectOrder={(o) => openDetail(o.id)}
        onRequestPayment={requestPayment}
      />
      <CancelOrderDialog
        order={cancelTarget}
        isOpen={!!cancelTarget}
        onClose={() => setCancelTarget(null)}
        onCancelled={() => {
          setCancelTarget(null);
          setDetailOrder(null);
          if (cancelTarget && cancelTarget.id === selectedComandaId) {
            resetDraft(true);
          }
          refreshMesaOrders();
        }}
      />
      {/* Montagem V2 da linha (mesmo ProductModal do cardápio; carrinho
          próprio vazio — só usa company/is_open; o destino é o rascunho). */}
      {configuring && (
        <CartProvider>
          <ProductModal
            product={configuring}
            initialItem={configuring.initialItem || null}
            primaryColor={company?.primary_color}
            isOpen={!!configuring}
            onClose={() => { setConfiguring(null); setConfiguringEditId(null); }}
            onAddToCart={(product, quantity, complements, notes, config) =>
              addConfiguredLine(product, quantity, complements, notes, config, { pendingUpdate: editingPersisted })
            }
          />
        </CartProvider>
      )}
    </div>
  );
}
