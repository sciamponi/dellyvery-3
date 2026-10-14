import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/api/supabaseClient';
import { useCompany } from '@/hooks/useCompany';
import { listProducts, listCategories } from '@/api/catalog';
import { listTables } from '@/api/tables';
import { listCustomers } from '@/api/customers';
import { listZones } from '@/api/deliveryZones';
import { createOrder, editOrder, cancelOrder, getOrderDetail, listOrdersWithItems, assignDriver, buildCreateOrderItems } from '@/api/orders';
import { listDrivers } from '@/api/team';
import { markDriverNotified } from '@/api/driverNotifications';
import { buildDriverDeliveryUrl } from '@/lib/driverMessage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Image } from '@/components/ui/image';
import { useToast } from '@/components/ui/use-toast';
import { calcPdvTotals } from '@/lib/orderDay';
import { validatePdvDraft } from '@/lib/pdvValidation';
import { groupComandasByTable, mergeComandaItems, toPdvDraftItem, normalizeTable } from '@/lib/tableComandas';
import { buildWhatsAppUrl } from '@/lib/menuShare';
import TableSelectModal, { MergeConfirmModal, TableMergePicker } from '@/components/pdv/TableSelectModal';
import OrderModal from '@/components/orders/OrderModal';
import CancelOrderDialog from '@/components/orders/CancelOrderDialog';
import ProductModal from '@/components/menu/ProductModal';
import { CartProvider } from '@/lib/CartContext';
import { getProductConfig, listDependenciesWithNames } from '@/api/configurator';
import { checkCartDependencies, buildDepModesFromProducts } from '@/lib/productDependencies';
import { Plus, Minus, Trash2, Search, Package, CheckCircle, Bike, Store, Table2, User, Printer, MessageCircle, Tag } from 'lucide-react';

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
  const [configCache, setConfigCache] = useState({});
  // Balcão (retirada) é o padrão: finalizar sem escolher tipo nunca
  // deve cobrar mesa.
  const [orderType, setOrderType] = useState('retirada');
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
  const [tableOpen, setTableOpen] = useState(false);
  const [selectedComandaId, setSelectedComandaId] = useState(null);
  const [mergeTable, setMergeTable] = useState(null);
  const [mergeIds, setMergeIds] = useState([]);
  const [mergeConfirm, setMergeConfirm] = useState(null);
  const [merging, setMerging] = useState(false);
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
        listTables(supabase, company.id, { onlyActive: true }).then(setRegisteredTables).catch(() => {});
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
    if (!company) return;
    try {
      const all = await listOrdersWithItems(supabase, company.id, 200);
      setMesaOrders(all.filter(o => o.order_type === 'mesa'));
    } catch {
      // comandas são auxiliares: falha silenciosa, PDV continua funcionando
    }
  };

  useEffect(() => {
    if (orderType === 'mesa' && company) refreshMesaOrders();
  }, [orderType, company?.id]);

  const tables = useMemo(() => groupComandasByTable(mesaOrders), [mesaOrders]);
  // Ocupação por nome normalizado (comandas ativas × mesas cadastradas).
  const occupiedNames = useMemo(() => {
    const set = new Set();
    for (const g of tables) set.add(normalizeTable(g.table));
    return set;
  }, [tables]);
  const filteredTables = useMemo(() => {
    const q = tableSearch.trim().toLowerCase();
    if (!q) return registeredTables;
    return registeredTables.filter((t) =>
      (t.name || '').toLowerCase().includes(q) || (t.code || '').toLowerCase().includes(q),
    );
  }, [registeredTables, tableSearch]);

  const pickRegisteredTable = (t) => {
    setOrderType('mesa');
    setSelectedTableId(t.id);
    setTableNumber(t.name || '');
    const group = tables.find((x) => normalizeTable(x.table) === normalizeTable(t.name));
    if (group && group.comandas.length === 1) {
      const full = mesaOrders.find((o) => o.id === group.comandas[0].id);
      if (full) loadComanda(full);
    }
    // 0 ou N comandas: segue com a mesa vinculada (N usa o seletor de comandas).
  };
  const currentComandas = useMemo(() => {
    const t = normalizeTable(tableNumber);
    if (!t) return [];
    return tables.find(x => x.table === t)?.comandas || [];
  }, [tables, tableNumber]);
  const selectedComanda = useMemo(
    () => mesaOrders.find(o => o.id === selectedComandaId) || null,
    [mesaOrders, selectedComandaId],
  );

  const filtered = useMemo(() => products.filter(p => {
    const ms = !search || p.name?.toLowerCase().includes(search.toLowerCase());
    const mc = filterCat === 'all' || p.category_id === filterCat;
    return ms && mc && p.available !== false;
  }), [products, search, filterCat]);

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
    // o Montar; senão adiciona a linha avulsa direto.
    void (async () => {
      try {
        if (await ensureRequiredConfig(product, true)) addPlainItem(product);
      } catch {
        addPlainItem(product);
      }
    })();
  };

  const ensureRequiredConfig = async (product, openWhenRequired) => {
    let cfg = configCache[product.id];
    if (cfg === undefined && company) {
      try {
        cfg = await getProductConfig(supabase, company.id, product.id);
        setConfigCache((prev) => ({ ...prev, [product.id]: cfg }));
      } catch {
        cfg = null;
      }
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
      const i = prev.findIndex(x => x.product_id === product.id && !x.config);
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
  const addConfiguredLine = (product, quantity, complements, notes, config) => {
    const unit = product.promotional_price != null ? product.promotional_price : product.price;
    const key = (c) => JSON.stringify(c || null);
    setItems(prev => {
      const i = prev.findIndex(x =>
        x.product_id === product.id &&
        JSON.stringify(x.complements || []) === JSON.stringify(complements || []) &&
        (x.notes || '') === (notes || '') &&
        key(x.config) === key(config));
      if (i >= 0) {
        const next = [...prev];
        next[i] = { ...next[i], quantity: next[i].quantity + quantity };
        return next;
      }
      return [...prev, {
        id: `${product.id}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        product_id: product.id, name: product.name, image_url: product.image_url,
        unit_price: unit, quantity, complements: complements || [], notes: notes || '',
        ...(config ? { config } : {}),
      }];
    });
  };

  // Abre a montagem V2 do produto (config sob demanda, com cache).
  const openConfigure = async (lineOrProduct) => {
    const productId = lineOrProduct.product_id || lineOrProduct.id;
    const base = products.find((p) => p.id === productId) || lineOrProduct;
    if (!company) return;
    try {
      let cfg = configCache[productId];
      if (!cfg) {
        cfg = await getProductConfig(supabase, company.id, productId);
        setConfigCache((prev) => ({ ...prev, [productId]: cfg }));
      }
      if (!cfg || (cfg.steps || []).length === 0) {
        toast({ title: 'Sem montagem', description: 'Este produto não tem grupos de complementos.' });
        return;
      }
      setConfiguring({
        ...base,
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
      .map(x => x.id === lineId ? { ...x, quantity: x.quantity + delta } : x)
      .filter(x => x.quantity > 0));
  };

  const removeItem = (lineId) => setItems(prev => prev.filter(x => x.id !== lineId));

  const setItemNotes = (lineId, notes) => {
    setItems(prev => prev.map(x => x.id === lineId ? { ...x, notes } : x));
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
    setSelectedTableId(null);
    if (!keepTable) {
      setTableNumber('');
      setAddress('');
      setDeliveryZoneId('');
    }
  };

  // Troca de modalidade nunca mistura comanda de mesa com outro tipo:
  // o rascunho vira pedido novo (itens preservados como linhas avulsas).
  const selectOrderType = (t) => {
    if (t === orderType) return;
    setOrderType(t);
    setSelectedComandaId(null);
    setSelectedTableId(null);
  };

  // Mesa → comanda ativa → cliente (nome/telefone automáticos).
  const loadComanda = (order) => {
    if (!order) return;
    setOrderType('mesa');
    setSelectedTableId(order.table_id || null);
    setTableNumber(order.table_number || '');
    setCustomer({ name: order.customer_name || '', phone: order.customer_phone || '' });
    setCustomerSearch('');
    setPaymentMethod(order.payment_method || '');
    setDiscount(String(order.discount || ''));
    setItems((Array.isArray(order.items) ? order.items : []).map(toPdvDraftItem));
    setSelectedComandaId(order.id);
    setTableOpen(false);
    setMergeTable(null);
    setMergeIds([]);
  };

  const pickTable = (table) => {
    const t = normalizeTable(table);
    setOrderType('mesa');
    const reg = registeredTables.find((r) => normalizeTable(r.name) === t);
    setSelectedTableId(reg ? reg.id : null);
    setTableNumber(t);
    const group = tables.find(x => x.table === t);
    if (group && group.comandas.length === 1) {
      const full = mesaOrders.find(o => o.id === group.comandas[0].id);
      if (full) loadComanda(full);
      else setTableOpen(false);
    } else if (!group) {
      setTableOpen(false);
    }
    // várias comandas: mantém o modal aberto para escolha
  };

  const newComanda = (table) => {
    const t = normalizeTable(table) || normalizeTable(tableNumber);
    resetDraft(true);
    setOrderType('mesa');
    const reg = registeredTables.find((r) => normalizeTable(r.name) === t);
    setSelectedTableId(reg ? reg.id : null);
    setTableNumber(t);
    setTableOpen(false);
    setMergeTable(null);
    setMergeIds([]);
    toast({ title: t ? `Nova comanda na Mesa ${t}` : 'Nova comanda' });
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
      setMergeIds([]);
      setTableOpen(true);
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

  const handleSubmit = async () => {
    // Guarda anti-duplo no topo: antes das validações, para toques
    // repetidos nunca gerarem nem toast duplicado nem pedido duplo.
    if (submitRef.current) return;
    // Validação única por tentativa (validatePdvDraft retorna o 1º erro).
    const invalid = validatePdvDraft({
      items, orderType, tableNumber, customer, address, paymentMethod, changeFor,
    });
    if (invalid) {
      toast({ title: invalid.title, description: invalid.description, variant: 'destructive' });
      return;
    }
    // Dependências entre produtos (regra da loja; servidor revalida).
    const depErrors = checkCartDependencies(items, depRules, buildDepModesFromProducts(products));
    if (depErrors.length > 0) {
      toast({ title: 'Item incompatível', description: depErrors[0].message, variant: 'destructive' });
      return;
    }
    const changeForValue = paymentMethod === 'Dinheiro' && String(changeFor).trim() !== ''
      ? Number(String(changeFor).replace(',', '.'))
      : null;
    submitRef.current = true;
    setSubmitting(true);
    try {
      const apiItems = buildCreateOrderItems(items);
      let number;
      let savedId = null;
      if (selectedComanda) {
        // Comanda existente: soma ao pedido via edit (totais recalculados no backend).
        await editOrder(supabase, selectedComanda.id, { items: apiItems, discount: discountValue });
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
        // create_order não aceita desconto: aplica via edit em seguida.
        if (discountValue > 0) {
          try {
            await editOrder(supabase, created.order_id, { discount: discountValue });
          } catch {
            toast({ title: `Pedido #${number} criado sem desconto`, description: 'Não foi possível aplicar o desconto. Ajuste em Pedidos.', variant: 'destructive' });
          }
        }
        toast({ title: `Pedido #${number} criado!` });
      }
      setDoneOrder({ order_id: savedId, order_number: number, order_type: orderType, driver_id: driverId || null });
      setNotifyState('');
      const keepTable = orderType === 'mesa';
      resetDraft(keepTable);
      refreshMesaOrders();
    } catch (err) {
      toast({ title: 'Erro ao criar pedido', description: err?.message, variant: 'destructive' });
    } finally {
      setSubmitting(false);
      submitRef.current = false;
    }
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
      const url = buildDriverDeliveryUrl(detail, driver);
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

  return (
    <div className={`flex flex-col lg:h-[calc(100vh-4rem)] lg:min-h-0 lg:overflow-hidden ${items.length > 0 ? 'pb-20 lg:pb-0' : ''}`}>
      <div className="shrink-0 mb-3">
        <h1 className="font-heading text-xl font-bold text-foreground">🧾 PDV</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Crie pedidos de mesa, retirada ou entrega</p>
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
        {/* Produtos */}
        <div className="lg:col-span-2 min-w-0 flex flex-col gap-3 lg:h-full lg:min-h-0">
          <div className="relative shrink-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar produto..." className="pl-9 h-10" />
          </div>
          <div className="shrink-0 flex gap-1.5 overflow-x-auto pb-1">
            <button onClick={() => setFilterCat('all')} className={`shrink-0 whitespace-nowrap rounded-full px-3 h-8 text-xs font-medium border ${filterCat === 'all' ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted text-muted-foreground border-transparent'}`}>Todos</button>
            {categories.map(c => (
              <button key={c.id} onClick={() => setFilterCat(c.id)} className={`shrink-0 whitespace-nowrap rounded-full px-3 h-8 text-xs font-medium border ${filterCat === c.id ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted text-muted-foreground border-transparent'}`}>{c.icon} {c.name}</button>
            ))}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto lg:pr-1 lg:pb-2">
          <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-[repeat(auto-fill,minmax(170px,1fr))]">
            {filtered.map(p => (
              <div key={p.id} className="rounded-xl border border-border bg-card overflow-hidden flex flex-col min-w-0">
                <div className="relative h-28 sm:h-32 lg:h-[132px] overflow-hidden bg-muted">
                  {p.image_url ? (
                    <Image src={p.image_url} fittingType="fill" className="h-full w-full" alt={p.name} />
                  ) : (
                    <div className="flex h-full items-center justify-center"><Package className="h-7 w-7 text-muted-foreground/60" /></div>
                  )}
                </div>
                <div className="p-1.5 flex-1 min-w-0">
                  <p className="text-[13px] leading-tight font-medium text-foreground truncate">{p.name}</p>
                  <p className="text-sm font-bold text-primary">{fmtCurrency(p.promotional_price ?? p.price)}</p>
                </div>
                <Button size="sm" className="m-1.5 mt-0 h-8 text-xs" onClick={() => addItem(p)} aria-label={`Adicionar ${p.name}`}>
                  <Plus className="h-4 w-4" /> Adicionar
                </Button>
              </div>
            ))}
          </div>
          {filtered.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">Nenhum produto encontrado.</p>}
          </div>
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
                        const busy = occupiedNames.has(normalizeTable(t.name));
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
                    <p className="text-xs text-muted-foreground">Nenhuma mesa cadastrada.</p>
                    <Link to="/mesas" className="text-xs font-medium text-primary hover:underline">
                      Cadastrar mesas
                    </Link>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setTableOpen(true)}
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
                <p className="text-sm text-muted-foreground text-center py-4 shrink-0">Toque em Adicionar nos produtos.</p>
              ) : (
                                <div className="space-y-2 max-h-64 lg:max-h-none overflow-y-auto lg:overflow-visible pr-1">
                  {items.map(x => (
                    <div key={x.id || x.product_id} className="rounded-xl border border-border p-2 min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{x.name}</p>
                          <p className="text-xs text-muted-foreground">{fmtCurrency(x.unit_price)} cada</p>
                          {(x.complements || []).length > 0 && (
                            <p className="text-[11px] text-muted-foreground truncate">
                              + {x.complements.map(c => `${c.quantity > 1 ? `${c.quantity}x ` : ''}${c.option_name || c.name}`).join(', ')}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button type="button" aria-label="Diminuir" onClick={() => changeQty(x.id || x.product_id, -1)} className="flex h-8 w-8 items-center justify-center rounded-md border border-border hover:bg-muted"><Minus className="h-3.5 w-3.5" /></button>
                          <span className="w-6 text-center text-sm font-medium">{x.quantity}</span>
                          <button type="button" aria-label="Aumentar" onClick={() => changeQty(x.id || x.product_id, 1)} className="flex h-8 w-8 items-center justify-center rounded-md border border-border hover:bg-muted"><Plus className="h-3.5 w-3.5" /></button>
                          <button type="button" aria-label={`Remover ${x.name}`} onClick={() => removeItem(x.id || x.product_id)} className="flex h-8 w-8 items-center justify-center rounded-md text-destructive hover:bg-destructive/10"><Trash2 className="h-4 w-4" /></button>
                        </div>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => openConfigure(x)}
                          className="text-[11px] font-medium text-primary hover:underline"
                        >
                          ⚙️ Montar
                        </button>
                        <button
                          type="button"
                          onClick={() => setNoteOpenId(noteOpenId === (x.id || x.product_id) ? null : (x.id || x.product_id))}
                          className="text-[11px] text-muted-foreground hover:text-foreground"
                        >
                          {x.notes ? `📝 ${x.notes}` : '+ obs do item'}
                        </button>
                      </div>
                      {noteOpenId === (x.id || x.product_id) && (
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
              {submitting ? 'Enviando...' : selectedComanda ? `Atualizar comanda #${selectedComanda.order_number}` : 'Finalizar pedido'}
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

      {/* Seletor de mesa / comandas */}
      <TableSelectModal
        open={tableOpen}
        onClose={() => { setTableOpen(false); setMergeTable(null); setMergeIds([]); }}
        mesaOrders={mesaOrders}
        initialTable={tableNumber}
        onPickTable={pickTable}
        onPickComanda={(id) => { const full = mesaOrders.find(o => o.id === id); if (full) loadComanda(full); }}
        onNewComanda={newComanda}
        onMergeTable={(table) => { setTableOpen(false); setMergeTable(table); setMergeIds([]); }}
        onViewComanda={openDetail}
      />

      {/* Escolha de comandas para juntar (dentro do contexto da mesa) */}
      {mergeTable && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => { setMergeTable(null); setMergeIds([]); }} />
          <div className="relative w-full max-w-md">
            <TableMergePicker
              table={mergeTable}
              comandas={tables.find(x => x.table === mergeTable)?.comandas || []}
              selected={mergeIds}
              onToggle={(id) => setMergeIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])}
              onCancel={() => { setMergeTable(null); setMergeIds([]); setTableOpen(true); }}
              onContinue={() => {
                const all = tables.find(x => x.table === mergeTable)?.comandas || [];
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
            primaryColor={company?.primary_color}
            isOpen={!!configuring}
            onClose={() => setConfiguring(null)}
            onAddToCart={(product, quantity, complements, notes, config) =>
              addConfiguredLine(product, quantity, complements, notes, config)
            }
          />
        </CartProvider>
      )}
    </div>
  );
}
