import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase, isSupabaseConfigured } from '@/api/supabaseClient';
import { createOrder as sbCreateOrder, buildCreateOrderItems } from '@/api/orders';
import { checkCartDependencies, buildDepRulesFromProducts } from '@/lib/productDependencies';
import { getStorefrontBySlug } from '@/api/storefront';
import { useCart } from '@/lib/CartContext';
import { saveResume } from '@/lib/orderResume';
import { suggestUpsellSteps } from '@/lib/upsell';
import { resolveTableToken } from '@/api/tables';
import ProductModal from '@/components/menu/ProductModal';
import UpsellSuggestions from '@/components/checkout/UpsellSuggestions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Image } from '@/components/ui/image';
import { ArrowLeft, ArrowRight, Bike, Store, Table2, Package, CheckCircle, Loader2 } from 'lucide-react';

const fmtCurrency = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);

const ORDER_TYPES = [
  { id: 'delivery', label: 'Delivery', icon: Bike, desc: 'Entregamos no seu endereço' },
  { id: 'retirada', label: 'Retirada', icon: Store, desc: 'Retire no balcão' },
  { id: 'mesa', label: 'Mesa', icon: Table2, desc: 'Pedido para mesa' },
];

export default function Checkout() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { items, getSubtotal, clearCart, company, setCartCompany, addItem } = useCart();

  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState(1);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [selectedUpsell, setSelectedUpsell] = useState(null);
  // Wizard de sugestões (Fase B): sub-etapa dentro da etapa 3.
  const [subStep, setSubStep] = useState(0);
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

  // Wizard de sugestões (Fase B): etapas não-vazias (acompanhamentos →
  // bebidas → sobremesas); carrinho preservado entre elas. Hook antes de
  // qualquer return antecipado (regras dos Hooks).
  const upsellSteps = useMemo(
    () => suggestUpsellSteps({ products, categories, cartItems: items }),
    [products, categories, items],
  );

  // Gate 3: aviso reativo na revisão (o submit continua barrando; o
  // servidor é a autoridade — aqui nada é removido silenciosamente).
  // Antes de qualquer return antecipado (regras dos Hooks).
  const reviewDepErrors = useMemo(
    () => checkCartDependencies(items, buildDepRulesFromProducts(products)),
    [items, products],
  );

  // Check for ?mesa= query param (QR Code: token validado no servidor).
  const urlParams = new URLSearchParams(window.location.search);
  const mesaParam = urlParams.get('mesa');
  // Mesa via QR: token travado (sem edição manual) + nome de exibição.
  const [tableToken, setTableToken] = useState('');
  const [tableLocked, setTableLocked] = useState(false);
  const [tableError, setTableError] = useState('');

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
      } catch (err) {
        if (err?.code === 'NOT_FOUND') navigate('/');
        else {
          console.error(err);
          setError('Não foi possível carregar a loja.');
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

  // Sub-etapa atual do wizard (limitada ao número de etapas existentes).
  const activeSub = Math.min(subStep, Math.max(upsellSteps.length - 1, 0));

  const handleNext = () => {
    setError('');
    if (step === 1) {
      if (orderType === 'mesa' && !tableNumber.trim()) {
        setError('Número da mesa é obrigatório');
        return;
      }
      setStep(2);
    } else if (step === 2) {
      if (!customer.name.trim() || !customer.phone.trim()) {
        setError('Nome e telefone são obrigatórios');
        return;
      }
      if (orderType === 'delivery' && !customer.address.trim()) {
        setError('Endereço é obrigatório para delivery');
        return;
      }
      // Sem sugestões: pula direto para a revisão.
      setSubStep(0);
      setStep(upsellSteps.length > 0 ? 3 : 4);
    } else if (step === 3) {
      // Sugestões são opcionais: avançar sem validar.
      if (activeSub < upsellSteps.length - 1) setSubStep(activeSub + 1);
      else setStep(4);
    }
  };

  const handleBack = () => {
    setError('');
    if (step === 3 && activeSub > 0) setSubStep(activeSub - 1);
    else if (step === 3) setStep(2);
    else if (step === 4 && upsellSteps.length > 0) { setSubStep(upsellSteps.length - 1); setStep(3); }
    else if (step === 4) setStep(2);
    else setStep((s) => Math.max(1, s - 1));
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
    // Idempotência no cliente: ignora cliques repetidos com envio em curso.
    // Em falha, o carrinho é preservado e uma nova tentativa é permitida.
    if (submitRef.current) return;
    // Dependências entre produtos (regras da loja): mensagem clara antes
    // da rede; o servidor revalida de qualquer forma.
    const depRules = buildDepRulesFromProducts(products);
    const depErrors = checkCartDependencies(items, depRules);
    if (depErrors.length > 0) {
      setError(depErrors[0].message);
      return;
    }
    submitRef.current = true;
    setSubmitting(true);
    setError('');
    try {
      const created = await sbCreateOrder(supabase, {
        companySlug: slug,
        orderType,
        tableNumber,
        tableToken: tableLocked ? tableToken : '',
        items: buildCreateOrderItems(items),
        customer,
        deliveryZoneId,
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

      {/* Progress */}
      <div className="mx-auto max-w-2xl px-4 py-4">
        <div className="flex items-center gap-2">
          {[1, 2, 3, 4].map(s => (
            <div key={s} className="flex items-center gap-2 flex-1">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition-colors ${
                  s <= step ? 'text-white' : 'bg-muted text-muted-foreground'
                }`}
                style={s <= step ? { backgroundColor: primaryColor } : {}}
              >
                {s < step ? <CheckCircle className="h-4 w-4" /> : s}
              </div>
              {s < 4 && <div className={`h-1 flex-1 rounded ${s < step ? '' : 'bg-muted'}`} style={s < step ? { backgroundColor: primaryColor } : {}} />}
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
        {/* Step 1: Order type */}
        {step === 1 && (
          <div className="space-y-4">
            <h2 className="font-heading text-lg font-bold">Tipo de pedido</h2>
            <div className="grid gap-3">
              {ORDER_TYPES.map(ot => {
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

            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button className="w-full" style={{ backgroundColor: primaryColor }} onClick={handleNext}>
              Continuar <ArrowRight className="h-4 w-4" />
            </Button>
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
              <Button variant="outline" className="flex-1" onClick={() => setStep(1)}>Voltar</Button>
              <Button className="flex-1" style={{ backgroundColor: primaryColor }} onClick={handleNext}>
                Continuar <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Upsell em etapas (acompanhamentos → bebidas → sobremesas) */}
        {step === 3 && upsellSteps[activeSub] && (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground text-center">
              Sugestões {activeSub + 1} de {upsellSteps.length}: {upsellSteps[activeSub].title} (opcional)
            </p>
            <UpsellSuggestions
              products={products}
              categories={categories}
              primaryColor={primaryColor}
              onCustomize={setSelectedUpsell}
              onSkip={handleNext}
              section={upsellSteps[activeSub]}
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={handleBack}>Voltar</Button>
              <Button className="flex-1" style={{ backgroundColor: primaryColor }} onClick={handleNext}>
                {activeSub < upsellSteps.length - 1 ? 'Pular' : 'Continuar'} <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 4: Review */}
        {step === 4 && (
          <div className="space-y-4">
            <h2 className="font-heading text-lg font-bold">Revisar pedido</h2>

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
                  </div>
                  <p className="text-sm font-semibold shrink-0">{fmtCurrency(item.line_total)}</p>
                </div>
              ))}
            </div>

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

        {/* Configurador para sugestões com adicionais/opções */}
        <ProductModal
          product={selectedUpsell}
          primaryColor={primaryColor}
          isOpen={!!selectedUpsell}
          onClose={() => setSelectedUpsell(null)}
          onAddToCart={addItem}
        />
      </div>
    </div>
  );
}