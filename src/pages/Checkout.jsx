import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase, isSupabaseConfigured } from '@/api/supabaseClient';
import { createOrder as sbCreateOrder, buildCreateOrderItems } from '@/api/orders';
import { checkCartDependencies, buildDepRulesFromProducts, buildDepModesFromProducts } from '@/lib/productDependencies';
import { filterOfferByCart, productHasOptions } from '@/lib/sideDish';
import { getStorefrontBySlug } from '@/api/storefront';
import { useCart } from '@/lib/CartContext';
import { saveResume } from '@/lib/orderResume';
import { resolveTableToken } from '@/api/tables';
import ProductModal from '@/components/menu/ProductModal';
import { suggestUpsell, guideMessageFor } from '@/lib/upsell';
import { geocodeAddress, getBrowserLocation, buildGeocodeQuery } from '@/lib/geocode';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Image } from '@/components/ui/image';
import { ArrowLeft, ArrowRight, Bike, Store, Table2, Package, CheckCircle, Loader2, Minus, Plus, Pencil, Trash2, Search, X, MapPin } from 'lucide-react';

const fmtCurrency = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);

const ORDER_TYPES = [
  { id: 'delivery', label: 'Delivery', icon: Bike, desc: 'Entregamos no seu endereço' },
  { id: 'retirada', label: 'Retirada', icon: Store, desc: 'Retire no balcão' },
  { id: 'mesa', label: 'Mesa', icon: Table2, desc: 'Pedido para mesa' },
];

export default function Checkout() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { items, getSubtotal, clearCart, company, setCartCompany, addItem, removeItem, updateItemQuantity } = useCart();

  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState(1);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [storeError, setStoreError] = useState('');
  // Catálogo dentro do checkout: ver detalhes e editar itens sem sair.
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerCat, setPickerCat] = useState('all');
  // Localização da entrega (GPS ou geocodificação; opcional). O servidor
  // resolve a zona pelo polígono e recalcula a taxa — nunca confia nestes
  // valores para preço. Ausente => fluxo legado por zona manual.
  const [geoCoords, setGeoCoords] = useState(null);
  const [locating, setLocating] = useState('');
  // Orientações dispensadas (por seção); saindo do checkout, zeram sozinhas.
  const [dismissedHints, setDismissedHints] = useState([]);
  const editingItem = editingId ? items.find((i) => i.id === editingId) || null : null;
  // Guarda anti-duplo: cliques repetidos antes do estado assentar.
  const submitRef = useRef(false);
  const [orderType, setOrderType] = useState('delivery');
  const [tableNumber, setTableNumber] = useState('');
  const [deliveryZones, setDeliveryZones] = useState([]);
  const [deliveryZoneId, setDeliveryZoneId] = useState('');
  const [customer, setCustomer] = useState({
    name: '', phone: '', email: '', address: '', number: '', complement: '',
    neighborhood: '', city: '', zip_code: ''
  });
  const [paymentMethod, setPaymentMethod] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Lojas com áreas desenhadas exigem localização ou zona explícita.
  const hasPolygonZones = useMemo(
    () => (deliveryZones || []).some((z) => z && z.has_polygon),
    [deliveryZones],
  );

  const handleUseLocation = async () => {
    setLocating('Obtendo sua localização...');
    setError('');
    try {
      const pos = await getBrowserLocation();
      if (!pos) {
        setError('Não foi possível obter sua localização. Verifique a permissão ou informe o endereço.');
        return;
      }
      setGeoCoords({ ...pos, source: 'gps', query: null });
    } finally {
      setLocating('');
    }
  };

  // Gate 3: aviso reativo na revisão (o submit continua barrando; o
  // servidor é a autoridade — aqui nada é removido silenciosamente).
  // Antes de qualquer return antecipado (regras dos Hooks).
  const reviewDepErrors = useMemo(
    () => checkCartDependencies(items, buildDepRulesFromProducts(products), buildDepModesFromProducts(products)),
    [items, products],
  );

  // Check for ?mesa= query param (QR Code: token validado no servidor).
  const urlParams = new URLSearchParams(window.location.search);
  const mesaParam = urlParams.get('mesa');
  // Mesa via QR: token travado (sem edição manual) + nome de exibição.
  const [tableToken, setTableToken] = useState('');
  const [tableLocked, setTableLocked] = useState(false);
  const [tableError, setTableError] = useState('');

  // Tipos visíveis: mesa só com contexto QR (?mesa=); entrega e retirada sempre.
  const availableOrderTypes = useMemo(
    () => ORDER_TYPES.filter((t) => t.id !== 'mesa' || mesaParam),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mesaParam],
  );

  // Edição de linha: remove a antiga só ao confirmar a nova no modal.
  const handleEditItem = (item) => {
    const product = products.find((p) => p.id === item.product_id);
    if (!product) return;
    setEditingId(item.id);
    setSelectedProduct(product);
  };

  const handleAddToCart = (product, quantity, complements, notes, config) => {
    if (editingId) {
      removeItem(editingId);
      setEditingId(null);
    }
    addItem(product, quantity, complements, notes, config);
  };

  const handleCloseProductModal = () => {
    setSelectedProduct(null);
    setEditingId(null);
  };

  const pickerResults = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    return (products || [])
      .filter((p) => pickerCat === 'all' || p.category_id === pickerCat)
      .filter((p) => !q || (p.name || '').toLowerCase().includes(q))
      .slice(0, 30);
  }, [products, pickerSearch, pickerCat]);

  const pickerCats = useMemo(
    () => (categories || []).filter((c) => (products || []).some((p) => p.category_id === c.id)),
    [categories, products],
  );

  // Orientação conversacional: seções relevantes, compatíveis com as
  // dependências do carrinho atual, sem auto-add e sem repetir dispensa.
  const guideSections = useMemo(() => {
    const inCart = new Set(items.map((i) => i && i.product_id).filter(Boolean));
    const depRules = buildDepRulesFromProducts(products);
    const modes = buildDepModesFromProducts(products);
    const visible = (list) => filterOfferByCart(list || [], items, depRules, modes)
      .filter((p) => !inCart.has(p.id)).slice(0, 3);
    return suggestUpsell({ products, categories, cartItems: items, limitPerSection: 6 })
      .map((s) => ({ ...s, items: visible(s.items) }))
      .filter((s) => s.items.length > 0 && !dismissedHints.includes(s.id));
  }, [products, categories, items, dismissedHints]);

  useEffect(() => {
    if (!mesaParam) return;
    let cancelled = false;
    resolveTableToken(supabase, mesaParam)
      .then((r) => {
        if (cancelled) return;
        if (r?.company_slug && company?.slug && r.company_slug !== company.slug) {
          throw new Error('Mesa de outra empresa');
        }
        setOrderType('mesa');
        setTableNumber(r?.table_name || '');
        setTableToken(mesaParam);
        setTableLocked(true);
      })
      .catch((err) => {
        if (!cancelled) setTableError(err?.message || 'Mesa inválida — siga sem mesa vinculada.');
      });
    return () => { cancelled = true; };
  }, [mesaParam, company?.slug]);

  // Checkout Supabase-only: leitura via storefront (RPC pública).
  useEffect(() => {
    const load = async () => {
      try {
        if (!isSupabaseConfigured()) {
          setError('Sistema indisponível no momento. Tente novamente.');
          return;
        }
        const storefront = await getStorefrontBySlug(supabase, slug);
        setCartCompany(storefront.company);
        setDeliveryZones(storefront.delivery_zones || []);
        setProducts(storefront.products || []);
        setCategories(storefront.categories || []);
        setStoreError('');
      } catch (err) {
        if (err?.code === 'NOT_FOUND') navigate('/');
        else {
          console.error(err);
          setError('Não foi possível carregar a loja.');
          setStoreError('Não foi possível carregar o catálogo.');
        }
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [slug]);

  // Redirect to menu if cart is empty (after loading)
  useEffect(() => {
    if (!loading && items.length === 0) {
      navigate(`/cardapio/${slug}`);
    }
  }, [loading, items.length, slug]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-4 border-border border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (items.length === 0) return null;

  const subtotal = getSubtotal();
  const selectedZone = deliveryZones.find(z => z.id === deliveryZoneId);
  const deliveryFee = orderType === 'delivery' ? (selectedZone?.fee ?? company?.delivery_fee ?? 0) : 0;
  const total = subtotal + deliveryFee;

  const handleNext = () => {
    setError('');
    if (step === 1) {
      if (items.length === 0) {
        navigate(`/cardapio/${slug}`);
        return;
      }
      setStep(2);
    }
  };

  const handleBack = () => {
    setError('');
    setStep((s) => Math.max(1, s - 1));
  };

  // Loja fechada não recebe pedidos (mesma fonte do cardápio: companies.is_open).
  const isClosed = company?.is_open === false;

  // Criação Supabase-only via RPC create_order (preços/totais no servidor).
  const handleSubmit = async () => {
    if (!isSupabaseConfigured()) {
      setError('Sistema indisponível no momento. Tente novamente.');
      return;
    }
    if (company?.is_open === false) {
      setError('Esta loja está fechada no momento e não está recebendo pedidos.');
      return;
    }
    if (orderType === 'mesa' && !tableLocked && !tableNumber.trim()) {
      setError('Número da mesa é obrigatório');
      return;
    }
    // Idempotência no cliente: ignora cliques repetidos com envio em curso.
    // Em falha, o carrinho é preservado e uma nova tentativa é permitida.
    if (submitRef.current) return;
    // Dependências entre produtos (regras da loja): mensagem clara antes
    // da rede; o servidor revalida de qualquer forma.
    const depRules = buildDepRulesFromProducts(products);
    const depErrors = checkCartDependencies(items, depRules, buildDepModesFromProducts(products));
    if (depErrors.length > 0) {
      setError(depErrors[0].message);
      return;
    }
    submitRef.current = true;
    setSubmitting(true);
    setError('');
    try {
      // Localização da entrega (somente delivery): GPS fixado vale;
      // senão, geocodifica o endereço (falha => segue sem coordenadas e
      // o servidor aplica o fluxo legado/manual — nunca inventa).
      let coords = geoCoords;
      if (orderType === 'delivery' && (!coords || coords.source !== 'gps')) {
        const q = buildGeocodeQuery(customer);
        if (coords && coords.source === 'geocode' && coords.query === q) {
          // Reutiliza a geocodificação do mesmo endereço.
        } else if (q) {
          setLocating('Localizando endereço...');
          try {
            const g = await geocodeAddress(customer);
            coords = g ? { ...g, source: 'geocode', query: q } : null;
            setGeoCoords(coords);
          } finally {
            setLocating('');
          }
        } else {
          coords = null;
        }
      }
      if (orderType === 'delivery' && hasPolygonZones && !coords && !deliveryZoneId) {
        setError('Escolha a zona de entrega ou use sua localização para calcularmos a taxa.');
        return;
      }
      const created = await sbCreateOrder(supabase, {
        companySlug: slug,
        orderType,
        tableNumber,
        tableToken: tableLocked ? tableToken : '',
        items: buildCreateOrderItems(items),
        customer,
        deliveryZoneId,
        latitude: coords ? coords.lat : null,
        longitude: coords ? coords.lng : null,
        paymentMethod,
        notes
      });
      // Retomada: guarda o token por loja (falha de storage nunca bloqueia).
      saveResume(slug, created.tracking_token);
      clearCart();
      navigate(`/acompanhar/${created.tracking_token}`);
    } catch (err) {
      setError(err?.message || 'Erro ao criar pedido. Tente novamente.');
    } finally {
      setSubmitting(false);
      submitRef.current = false;
    }
  };

  const primaryColor = company?.primary_color || '#DC2626';

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card sticky top-0 z-10">
        <div className="mx-auto max-w-2xl px-4 py-3 flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link to={`/cardapio/${slug}`}><ArrowLeft className="h-4 w-4 mr-1" /> Cardápio</Link>
          </Button>
          <div className="flex-1" />
          <span className="font-heading font-semibold text-sm">Checkout</span>
        </div>
      </div>

      {/* Progress: carrinho → dados e confirmação (sem wizard de sugestões) */}
      <div className="mx-auto max-w-2xl px-4 py-4">
        <div className="flex items-center gap-2">
          {[1, 2].map(s => (
            <div key={s} className="flex items-center gap-2 flex-1">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition-colors ${
                  s <= step ? 'text-white' : 'bg-muted text-muted-foreground'
                }`}
                style={s <= step ? { backgroundColor: primaryColor } : {}}
              >
                {s < step ? <CheckCircle className="h-4 w-4" /> : s}
              </div>
              <span className="text-xs text-muted-foreground hidden sm:inline">{s === 1 ? 'Pedido' : 'Dados e confirmação'}</span>
              {s < 2 && <div className={`h-1 flex-1 rounded ${s < step ? '' : 'bg-muted'}`} style={s < step ? { backgroundColor: primaryColor } : {}} />}
            </div>
          ))}
        </div>
      </div>

      <div className="mx-auto max-w-2xl px-4 pb-32">
        {isClosed && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm">
            <p className="font-semibold text-red-700">🔴 Loja fechada</p>
            <p className="text-red-600 mt-0.5">Esta loja não está recebendo pedidos no momento. Volte em breve.</p>
          </div>
        )}
        {/* Step 1: Revisar o pedido (antes de qualquer dado pessoal) */}
        {step === 1 && (
          <div className="space-y-4">
            <h2 className="font-heading text-lg font-bold">Revise seu pedido</h2>

            {reviewDepErrors.length > 0 && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800" role="alert">
                {reviewDepErrors.map((e) => (
                  <p key={e.productId}>⚠️ {e.message}</p>
                ))}
              </div>
            )}

            {/* Items */}
            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              {items.map(item => (
                <div key={item.id} className="flex gap-3">
                  {item.image_url ? (
                    <Image src={item.image_url} fittingType="fill" className="h-12 w-12 rounded-lg shrink-0" alt={item.name} />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-muted shrink-0">
                      <Package className="h-5 w-5 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{item.quantity}x {item.name}</p>
                    {item.complements && item.complements.length > 0 && (
                      <p className="text-xs text-muted-foreground">{item.complements.map(c => c.option_name).join(', ')}</p>
                    )}
                    {item.notes && <p className="text-xs text-muted-foreground italic">📝 {item.notes}</p>}
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <button
                        type="button"
                        onClick={() => updateItemQuantity(item.id, item.quantity - 1)}
                        disabled={item.quantity <= 1}
                        aria-label="Diminuir quantidade"
                        className="flex h-8 w-8 items-center justify-center rounded-md border border-border disabled:opacity-50"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <span className="w-6 text-center text-sm font-medium">{item.quantity}</span>
                      <button
                        type="button"
                        onClick={() => updateItemQuantity(item.id, item.quantity + 1)}
                        aria-label="Aumentar quantidade"
                        className="flex h-8 w-8 items-center justify-center rounded-md border border-border"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleEditItem(item)}
                        aria-label={`Editar ${item.name}`}
                        className="flex h-8 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted"
                      >
                        <Pencil className="h-3.5 w-3.5" /> Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => removeItem(item.id)}
                        aria-label={`Remover ${item.name}`}
                        className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  <p className="text-sm font-semibold shrink-0">{fmtCurrency(item.line_total)}</p>
                </div>
              ))}
            </div>

            <div className="flex justify-between font-heading text-lg font-bold pt-2 border-t border-border">
              <span>Subtotal</span>
              <span style={{ color: primaryColor }}>{fmtCurrency(subtotal)}</span>
            </div>

            {/* Adicionar mais itens sem sair do checkout */}
            {!showPicker ? (
              <Button variant="outline" className="w-full min-h-11" onClick={() => setShowPicker(true)}>
                <Plus className="h-4 w-4" /> Adicionar mais itens
              </Button>
            ) : (
              <div className="rounded-xl border border-border bg-card p-3 space-y-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input value={pickerSearch} onChange={e => setPickerSearch(e.target.value)} placeholder="Buscar no cardápio..." className="pl-9" />
                </div>
                {pickerCats.length > 0 && (
                  <div className="flex gap-1.5 overflow-x-auto pb-1">
                    <button
                      type="button"
                      onClick={() => setPickerCat('all')}
                      className={`shrink-0 whitespace-nowrap rounded-full px-3 h-8 text-xs font-medium border ${pickerCat === 'all' ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted text-muted-foreground border-transparent'}`}
                    >
                      Todos
                    </button>
                    {pickerCats.map(c => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setPickerCat(c.id)}
                        title={c.name}
                        className={`shrink-0 whitespace-nowrap rounded-full px-3 h-8 text-xs font-medium border ${pickerCat === c.id ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted text-muted-foreground border-transparent'}`}
                      >
                        {c.icon ? `${c.icon} ` : ''}{c.name}
                      </button>
                    ))}
                  </div>
                )}
                {storeError ? (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-center">
                    <p className="text-xs text-amber-800">{storeError} Seu carrinho está preservado.</p>
                    <Button asChild variant="ghost" size="sm" className="mt-1">
                      <Link to={`/cardapio/${slug}`}>Voltar ao cardápio</Link>
                    </Button>
                  </div>
                ) : (
                <div className="max-h-56 overflow-y-auto divide-y divide-border">
                  {pickerResults.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => { setShowPicker(false); setPickerSearch(''); setPickerCat('all'); setSelectedProduct(p); }}
                      className="flex w-full items-center gap-3 py-2 text-left"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{p.name}</span>
                        <span className="block text-xs text-muted-foreground">{fmtCurrency(p.promotional_price ?? p.price)}</span>
                      </span>
                      <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </button>
                  ))}
                  {pickerResults.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-3">Nenhum produto encontrado.</p>
                  )}
                </div>
                )}
                <Button variant="ghost" size="sm" className="w-full" onClick={() => setShowPicker(false)}>Fechar catálogo</Button>
              </div>
            )}

            {/* Orientação conversacional: sugestões compatíveis, opcionais */}
            {guideSections.length > 0 ? guideSections.slice(0, 2).map((s) => (
              <div key={s.id} className="rounded-xl border border-primary/20 bg-primary/5 p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">
                    {guideMessageFor(s.id, s.title)}
                  </p>
                  <button
                    type="button"
                    onClick={() => setDismissedHints((prev) => [...prev, s.id])}
                    aria-label={`Dispensar sugestão ${s.title}`}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="space-y-1.5">
                  {s.items.map((p) => (
                    <div key={p.id} className="flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5">
                      <button
                        type="button"
                        onClick={() => setSelectedProduct(p)}
                        className="min-w-0 flex-1 text-left"
                        title={`Personalizar ${p.name}`}
                      >
                        <span className="block truncate text-[13px] font-medium">{p.name}</span>
                        <span className="block text-[11px] text-muted-foreground">{fmtCurrency(p.promotional_price ?? p.price)}</span>
                      </button>
                      {/* Adição direta só sem personalização; com opções, pelo modal (regras do servidor valem igual). */}
                      {!productHasOptions(p) && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 shrink-0 text-xs"
                          style={{ borderColor: primaryColor, color: primaryColor }}
                          onClick={() => addItem(p, 1, [], '')}
                          aria-label={`Adicionar ${p.name} direto`}
                        >
                          <Plus className="h-3.5 w-3.5" /> Adicionar
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )) : (
              <p className="rounded-xl border border-border bg-card p-3 text-center text-sm text-muted-foreground">
                Seu pedido está pronto para continuar.
              </p>
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button className="w-full min-h-11" style={{ backgroundColor: primaryColor }} onClick={handleNext}>
              Continuar <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        )}
        {/* Step 1 (antigo: tipo de pedido — movido para a etapa 2) */}
        {/* Step 2a: modalidade (primeira parte da etapa 2) */}
        {step === 2 && (
          <div className="space-y-4">
            <h2 className="font-heading text-lg font-bold">Entrega ou retirada?</h2>
            <div className="grid gap-3">
              {availableOrderTypes.map(ot => {
                const Icon = ot.icon;
                return (
                  <button
                    key={ot.id}
                    onClick={() => setOrderType(ot.id)}
                    className={`flex items-center gap-3 rounded-xl border p-4 text-left transition-colors ${
                      orderType === ot.id ? 'border-2 bg-muted/50' : 'border-border hover:bg-muted/30'
                    }`}
                    style={orderType === ot.id ? { borderColor: primaryColor } : {}}
                  >
                    <Icon className="h-6 w-6" style={{ color: primaryColor }} />
                    <div className="flex-1">
                      <p className="font-medium text-foreground">{ot.label}</p>
                      <p className="text-xs text-muted-foreground">{ot.desc}</p>
                    </div>
                    <div className={`h-5 w-5 rounded-full border-2 ${orderType === ot.id ? '' : 'border-border'}`} style={orderType === ot.id ? { borderColor: primaryColor, backgroundColor: primaryColor } : {}} />
                  </button>
                );
              })}
            </div>

            {orderType === 'mesa' && (
              <div className="space-y-2">
                <Label>Mesa</Label>
                <Input
                  value={tableNumber}
                  onChange={(e) => setTableNumber(e.target.value)}
                  placeholder="Número da mesa"
                  disabled={tableLocked}
                />
                {tableLocked && <p className="text-xs text-muted-foreground">Mesa definida pelo QR Code</p>}
                {!tableLocked && tableError && (
                  <p className="text-xs text-amber-600">{tableError} Siga sem mesa ou digite o número.</p>
                )}
              </div>
            )}

            {orderType === 'delivery' && deliveryZones.length > 0 && (
              <div className="space-y-2">
                <Label>Zona de entrega</Label>
                <select
                  value={deliveryZoneId}
                  onChange={(e) => setDeliveryZoneId(e.target.value)}
                  className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                >
                  <option value="">Padrão ({fmtCurrency(company?.delivery_fee)})</option>
                  {deliveryZones.map(z => (
                    <option key={z.id} value={z.id}>{z.name} — {fmtCurrency(z.fee)} (~{z.estimated_time}min)</option>
                  ))}
                </select>
              </div>
            )}

          </div>
        )}

        {/* Step 2: Customer data */}
        {step === 2 && (
          <div className="space-y-4">
            <h2 className="font-heading text-lg font-bold">Seus dados</h2>
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Nome *</Label>
                  <Input value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} placeholder="Seu nome" />
                </div>
                <div className="space-y-1.5">
                  <Label>Telefone *</Label>
                  <Input value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} placeholder="(11) 99999-9999" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Email (opcional)</Label>
                <Input type="email" value={customer.email} onChange={(e) => setCustomer({ ...customer, email: e.target.value })} placeholder="seu@email.com" />
              </div>

              {orderType === 'delivery' && (
                <>
                  <div className="space-y-1.5">
                    <Label>Endereço *</Label>
                    <Input value={customer.address} onChange={(e) => setCustomer({ ...customer, address: e.target.value })} placeholder="Rua / Avenida" />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full min-h-10 text-sm"
                    onClick={handleUseLocation}
                    disabled={!!locating}
                  >
                    <MapPin className="h-4 w-4" /> {locating || (geoCoords ? 'Localização definida ✓' : 'Usar minha localização')}
                  </Button>
                  <p className="text-[11px] text-muted-foreground">
                    A taxa é calculada pela área de entrega do endereço. Dados de mapa © OpenStreetMap.
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Número</Label>
                      <Input value={customer.number} onChange={(e) => setCustomer({ ...customer, number: e.target.value })} placeholder="123" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Complemento</Label>
                      <Input value={customer.complement} onChange={(e) => setCustomer({ ...customer, complement: e.target.value })} placeholder="Apto 2" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Bairro</Label>
                      <Input value={customer.neighborhood} onChange={(e) => setCustomer({ ...customer, neighborhood: e.target.value })} placeholder="Centro" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Cidade</Label>
                      <Input value={customer.city} onChange={(e) => setCustomer({ ...customer, city: e.target.value })} placeholder="São Paulo" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>CEP</Label>
                    <Input value={customer.zip_code} onChange={(e) => setCustomer({ ...customer, zip_code: e.target.value })} placeholder="01000-000" />
                  </div>
                </>
              )}
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setStep(1)}>Voltar ao pedido</Button>
            </div>
          </div>
        )}

        {/* Step 4 (antigo: revisão — agora etapa 1; abaixo: resumo + confirmação) */}
        {step === 2 && (
          <div className="space-y-4">
            {/* Summary */}
            <div className="rounded-xl border border-border bg-card p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{fmtCurrency(subtotal)}</span>
              </div>
              {orderType === 'delivery' && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Taxa de entrega</span>
                  <span>{fmtCurrency(deliveryFee)}</span>
                </div>
              )}
              <div className="flex justify-between font-heading text-lg font-bold pt-2 border-t border-border">
                <span>Total</span>
                <span style={{ color: primaryColor }}>{fmtCurrency(total)}</span>
              </div>
            </div>

            {/* Payment + Notes */}
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Forma de pagamento</Label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                >
                  <option value="">Selecione...</option>
                  <option value="Dinheiro">Dinheiro</option>
                  <option value="Cartão (na entrega)">Cartão (na entrega)</option>
                  <option value="Pix (na entrega)">Pix (na entrega)</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Observações (opcional)</Label>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex: trocar para R$ 50, entregar na portaria..." rows={2} />
              </div>
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={handleBack} disabled={submitting}>Voltar</Button>
              <Button className="flex-1" style={{ backgroundColor: primaryColor }} onClick={handleSubmit} disabled={submitting || isClosed}>
                {submitting ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Enviando...</>
                ) : (
                  <>Confirmar pedido</>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Personalização (adicionar ou editar item sem sair do checkout) */}
        <ProductModal
          key={editingId || 'new'}
          product={selectedProduct}
          primaryColor={primaryColor}
          isOpen={!!selectedProduct}
          onClose={handleCloseProductModal}
          onAddToCart={handleAddToCart}
          initialItem={editingItem}
        />
      </div>
    </div>
  );
}