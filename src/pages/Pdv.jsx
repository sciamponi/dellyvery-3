import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/api/supabaseClient';
import { useCompany } from '@/hooks/useCompany';
import { listProducts, listCategories } from '@/api/catalog';
import { listCustomers } from '@/api/customers';
import { listZones } from '@/api/deliveryZones';
import { createOrder } from '@/api/orders';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Image } from '@/components/ui/image';
import { useToast } from '@/components/ui/use-toast';
import { calcPdvTotals } from '@/lib/orderDay';
import { Plus, Minus, Trash2, Search, Package, CheckCircle, Bike, Store, Table2, User } from 'lucide-react';

const fmtCurrency = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);

const ORDER_TYPES = [
  { id: 'mesa', label: 'Mesa', icon: Table2 },
  { id: 'retirada', label: 'Retirada', icon: Store },
  { id: 'delivery', label: 'Entrega', icon: Bike },
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
  const [orderType, setOrderType] = useState('mesa');
  const [tableNumber, setTableNumber] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [customer, setCustomer] = useState({ name: '', phone: '' });
  const [address, setAddress] = useState('');
  const [deliveryZoneId, setDeliveryZoneId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [doneOrder, setDoneOrder] = useState(null);

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
      } catch (err) {
        toast({ title: 'Erro ao carregar cardápio', description: err?.message, variant: 'destructive' });
      } finally {
        setDataLoading(false);
      }
    };
    load();
  }, [company?.id]);

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

  const addItem = (product) => {
    const unit = product.promotional_price != null ? product.promotional_price : product.price;
    setItems(prev => {
      const i = prev.findIndex(x => x.product_id === product.id);
      if (i >= 0) {
        const next = [...prev];
        next[i] = { ...next[i], quantity: next[i].quantity + 1 };
        return next;
      }
      return [...prev, {
        product_id: product.id, name: product.name, image_url: product.image_url,
        unit_price: unit, quantity: 1, complements: [], notes: '',
      }];
    });
  };

  const changeQty = (productId, delta) => {
    setItems(prev => prev
      .map(x => x.product_id === productId ? { ...x, quantity: x.quantity + delta } : x)
      .filter(x => x.quantity > 0));
  };

  const removeItem = (productId) => setItems(prev => prev.filter(x => x.product_id !== productId));

  const zone = zones.find(z => z.id === deliveryZoneId);
  const fee = orderType === 'delivery' ? (zone?.fee ?? company?.delivery_fee ?? 0) : 0;
  const { subtotal, total, count: itemCount } = calcPdvTotals(items, fee);

  const handleSubmit = async () => {
    if (items.length === 0) {
      toast({ title: 'Pedido vazio', description: 'Adicione ao menos um produto.', variant: 'destructive' });
      return;
    }
    if (orderType === 'mesa' && !tableNumber.trim()) {
      toast({ title: 'Mesa obrigatória', description: 'Informe o número da mesa.', variant: 'destructive' });
      return;
    }
    if (!customer.name.trim() || !customer.phone.trim()) {
      toast({ title: 'Cliente obrigatório', description: 'Informe nome e telefone (ou selecione um cliente).', variant: 'destructive' });
      return;
    }
    if (orderType === 'delivery' && !address.trim()) {
      toast({ title: 'Endereço obrigatório', description: 'Informe o endereço de entrega.', variant: 'destructive' });
      return;
    }
    setSubmitting(true);
    try {
      const created = await createOrder(supabase, {
        companySlug: company.slug,
        orderType,
        tableNumber,
        items: items.map(i => ({ product_id: i.product_id, quantity: i.quantity, complements: i.complements || [], notes: i.notes || '' })),
        customer: { name: customer.name, phone: customer.phone, address },
        deliveryZoneId: deliveryZoneId || null,
        paymentMethod: paymentMethod || null,
        notes: '',
      });
      setDoneOrder(created);
      setItems([]);
      toast({ title: `Pedido #${created.order_number} criado!` });
    } catch (err) {
      toast({ title: 'Erro ao criar pedido', description: err?.message, variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || dataLoading) return <Spinner />;
  if (!company) return null;

  return (
    <div className={`flex flex-col lg:h-[calc(100vh-4rem)] lg:min-h-0 lg:overflow-hidden ${items.length > 0 ? 'pb-20 lg:pb-0' : ''}`}>
      <div className="shrink-0 mb-3">
        <h1 className="font-heading text-xl font-bold text-foreground">PDV</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Crie pedidos de mesa, retirada ou entrega</p>
      </div>

      {doneOrder && (
        <div className="mb-3 shrink-0 flex items-center gap-3 rounded-2xl border border-green-200 bg-green-50 p-4">
          <CheckCircle className="h-6 w-6 text-green-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-medium text-foreground">Pedido #{doneOrder.order_number} criado!</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setDoneOrder(null)}>Novo pedido</Button>
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
          <div className="rounded-2xl border border-border bg-card p-4 flex flex-col gap-4 lg:h-full lg:min-h-0 lg:overflow-hidden">
            <div className="shrink-0 space-y-4">
            <div>
              <Label className="mb-2 block">Tipo do pedido</Label>
              <div className="grid grid-cols-3 gap-1.5">
                {ORDER_TYPES.map(t => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setOrderType(t.id)}
                    className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-2.5 text-xs font-medium transition-colors min-w-0 ${orderType === t.id ? 'border-primary bg-primary/5 text-foreground' : 'border-border text-muted-foreground'}`}
                  >
                    <t.icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{t.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {orderType === 'mesa' && (
              <div className="space-y-1.5">
                <Label>Mesa *</Label>
                <Input value={tableNumber} onChange={e => setTableNumber(e.target.value)} placeholder="Número da mesa" inputMode="numeric" />
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Cliente</Label>
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
              <Label>Pagamento</Label>
              <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)} className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm min-w-0">
                <option value="">Selecione...</option>
                {PAYMENTS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>

            </div>

            <div className="flex-1 min-h-0 flex flex-col">
              <Label className="mb-2 block shrink-0">Itens ({itemCount})</Label>
              {items.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">Toque em Adicionar nos produtos.</p>
              ) : (
                <div className="space-y-2 max-h-64 lg:max-h-none lg:flex-1 lg:min-h-0 overflow-y-auto pr-1">
                  {items.map(x => (
                    <div key={x.product_id} className="flex items-center gap-2 rounded-xl border border-border p-2 min-w-0">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{x.name}</p>
                        <p className="text-xs text-muted-foreground">{fmtCurrency(x.unit_price)} cada</p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button type="button" aria-label="Diminuir" onClick={() => changeQty(x.product_id, -1)} className="flex h-8 w-8 items-center justify-center rounded-md border border-border hover:bg-muted"><Minus className="h-3.5 w-3.5" /></button>
                        <span className="w-6 text-center text-sm font-medium">{x.quantity}</span>
                        <button type="button" aria-label="Aumentar" onClick={() => changeQty(x.product_id, 1)} className="flex h-8 w-8 items-center justify-center rounded-md border border-border hover:bg-muted"><Plus className="h-3.5 w-3.5" /></button>
                        <button type="button" aria-label={`Remover ${x.name}`} onClick={() => removeItem(x.product_id)} className="flex h-8 w-8 items-center justify-center rounded-md text-destructive hover:bg-destructive/10"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="shrink-0 space-y-1 pt-2 border-t border-border text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{fmtCurrency(subtotal)}</span></div>
              {orderType === 'delivery' && (
                <div className="flex justify-between"><span className="text-muted-foreground">Taxa de entrega</span><span>{fmtCurrency(fee)}</span></div>
              )}
              <div className="flex justify-between font-heading text-lg font-bold pt-1"><span>Total</span><span>{fmtCurrency(total)}</span></div>
            </div>

            <Button className="w-full h-11 shrink-0" onClick={handleSubmit} disabled={submitting || items.length === 0}>
              {submitting ? 'Enviando...' : 'Finalizar pedido'}
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
    </div>
  );
}
