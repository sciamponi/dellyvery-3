import React, { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Image } from '@/components/ui/image';
import { Bike, Store, Table2, Phone, MapPin, Receipt, Clock, XCircle, Pencil, X, Check, ArrowRight, Package, Plus, Search } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useToast } from '@/components/ui/use-toast';
import { changeOrderStatus, getAvailableActions, STATUS_LABELS } from '@/lib/orderStatusFlow';

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

export default function OrderModal({ order, isOpen, onClose, onOrderUpdated, onCancel, onSelectOrder }) {
  const { toast } = useToast();
  const [editMode, setEditMode] = useState(false);
  const [editData, setEditData] = useState(null);
  const [saving, setSaving] = useState(false);
  const [statusAction, setStatusAction] = useState(null);
  const [photoMap, setPhotoMap] = useState({});
  const [custHistory, setCustHistory] = useState([]);
  const [custStats, setCustStats] = useState(null);
  const [extraLoading, setExtraLoading] = useState(false);
  const statusBusyRef = useRef(false);
  const [showPicker, setShowPicker] = useState(false);
  const [menuProducts, setMenuProducts] = useState([]);
  const [menuSearch, setMenuSearch] = useState('');
  const [menuLoading, setMenuLoading] = useState(false);

  // Fotos dos produtos + histórico do cliente (2 consultas, com cancelamento).
  useEffect(() => {
    if (!order || !isOpen) return;
    let cancelled = false;
    setEditMode(false);
    setStatusAction(null);
    statusBusyRef.current = false;
    setPhotoMap({});
    setCustHistory([]);
    setCustStats(null);
    setExtraLoading(true);

    const load = async () => {
      try {
        const productIds = [...new Set((order.items || []).map(i => i.product_id).filter(Boolean))];
        const historyFilter = order.customer_id
          ? { company_id: order.company_id, customer_id: order.customer_id }
          : order.customer_phone
            ? { company_id: order.company_id, customer_phone: order.customer_phone }
            : null;

        const [products, history, customers] = await Promise.all([
          productIds.length > 0
            ? base44.entities.Product.filter({ company_id: order.company_id, id: { $in: productIds } })
            : Promise.resolve([]),
          historyFilter
            ? base44.entities.Order.filter(historyFilter, '-created_date', 6)
            : Promise.resolve([]),
          order.customer_id
            ? base44.entities.Customer.filter({ company_id: order.company_id, id: order.customer_id })
            : Promise.resolve([]),
        ]);
        if (cancelled) return;
        const map = {};
        products.forEach(p => { if (p.image_url) map[p.id] = p.image_url; });
        setPhotoMap(map);
        setCustHistory(history.filter(h => h.id !== order.id).slice(0, 5));
        if (customers.length > 0) {
          setCustStats({ count: customers[0].orders_count || 0, total: customers[0].total_spent || 0 });
        }
      } catch (err) { /* seções extras são opcionais */ }
      finally { if (!cancelled) setExtraLoading(false); }
    };
    load();
    return () => { cancelled = true; };
  }, [order?.id, isOpen]);

  if (!order) return null;

  const actions = getAvailableActions(order);
  const primaryAction = actions.find(a => a.id === 'accept' || a.id === 'advance');
  const cancelAction = actions.find(a => a.id === 'cancel');

  const handleStatusAction = async (action) => {
    if (statusBusyRef.current) return;
    statusBusyRef.current = true;
    setStatusAction(action.id);
    try {
      const updated = await changeOrderStatus(order.id, action.next);
      onOrderUpdated(updated);
      toast({ title: action.id === 'accept' ? 'Pedido confirmado!' : `Pedido: ${STATUS_LABELS[action.next]}` });
    } catch (err) {
      toast({ title: 'Erro ao atualizar pedido', description: err?.message, variant: 'destructive' });
    } finally {
      statusBusyRef.current = false;
      setStatusAction(null);
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
    base44.entities.Product.filter({ company_id: order.company_id })
      .then(list => setMenuProducts(list.filter(p => p.available && !p.out_of_stock)))
      .catch(() => setMenuProducts([]))
      .finally(() => setMenuLoading(false));
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
      const res = await base44.functions.invoke('manageOrder', {
        action: 'edit',
        order_id: order.id,
        customer_address: editData.customer_address,
        customer_number: editData.customer_number,
        customer_complement: editData.customer_complement,
        customer_neighborhood: editData.customer_neighborhood,
        customer_notes: editData.notes,
        discount: Number(editData.discount) || 0,
        items: editData.items.map(i => ({
          product_id: i.product_id,
          quantity: i.quantity,
          complements: i.complements || [],
          notes: i.notes || ''
        }))
      });
      if (res.data?.error) throw new Error(res.data.error);
      onOrderUpdated(res.data.order);
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

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-lg max-h-[90vh] overflow-hidden p-0 gap-0 flex flex-col">
        <DialogHeader className="shrink-0 px-4 pt-4 sm:px-6 sm:pt-6">
          <DialogTitle className="flex flex-wrap items-end justify-between gap-2 pr-6">
            <span>
              <span className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pedido</span>
              <span className="font-heading text-3xl font-bold">#{order.order_number}</span>
            </span>
            <span className={`text-sm px-3 py-1.5 rounded-full font-semibold whitespace-nowrap ${STATUS_PILL[order.status] || STATUS_PILL.novo}`}>
              {STATUS_LABELS[order.status] || order.status}
            </span>
          </DialogTitle>
        </DialogHeader>

        {!editMode ? (
          <>
          <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-4 space-y-5">
            {/* Customer */}
            <div className="rounded-2xl bg-muted/50 p-4 space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Cliente</p>
              <p className="font-heading text-xl font-bold text-foreground break-words">{order.customer_name}</p>
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
              {order.order_type === 'delivery' && order.customer_address && (
                <div className="flex items-start gap-2 text-sm pt-1 border-t border-border/60">
                  <MapPin className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
                  <span className="min-w-0 break-words">
                    {order.customer_address}{order.customer_number ? `, ${order.customer_number}` : ''}
                    {order.customer_complement && ` - ${order.customer_complement}`}
                    {order.customer_neighborhood && `, ${order.customer_neighborhood}`}
                    {order.customer_city && ` — ${order.customer_city}`}
                  </span>
                </div>
              )}
            </div>

            {/* Items */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Itens ({order.items?.length || 0})
              </p>
              <div className="space-y-2">
                {order.items?.map((item, i) => {
                  const photo = item.product_id ? photoMap[item.product_id] : null;
                  return (
                    <div key={i} className="flex gap-3 rounded-2xl border border-border bg-card p-3">
                      {photo ? (
                        <Image src={photo} fittingType="fill" className="h-16 w-16 sm:h-20 sm:w-20 rounded-xl shrink-0 object-cover" alt={item.name} />
                      ) : (
                        <div className="flex h-16 w-16 sm:h-20 sm:w-20 shrink-0 items-center justify-center rounded-xl bg-muted">
                          <Package className="h-7 w-7 text-muted-foreground" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-foreground break-words leading-snug">{item.name}</p>
                        <p className="text-sm text-muted-foreground mt-0.5">
                          {item.quantity} {item.quantity === 1 ? 'unidade' : 'unidades'} • {fmtCurrency(item.unit_price)} cada
                        </p>
                        {item.complements && item.complements.length > 0 && (
                          <p className="text-xs text-muted-foreground mt-1 break-words">
                            + {item.complements.map(c => `${c.quantity > 1 ? `${c.quantity}x ` : ''}${c.option_name} (${fmtCurrency(c.price)})`).join(', ')}
                          </p>
                        )}
                        {item.notes && <p className="text-xs text-muted-foreground italic mt-1 break-words">📝 {item.notes}</p>}
                      </div>
                      <p className="text-base font-bold shrink-0 whitespace-nowrap">{fmtCurrency(item.price)}</p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Totals */}
            <div className="rounded-2xl border border-border p-4 space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{fmtCurrency(order.subtotal)}</span></div>
              {order.delivery_fee > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Taxa de entrega</span><span>{fmtCurrency(order.delivery_fee)}</span></div>}
              {order.discount > 0 && <div className="flex justify-between text-green-600"><span>Desconto</span><span>-{fmtCurrency(order.discount)}</span></div>}
              <div className="flex items-baseline justify-between pt-2 border-t border-border">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Total</span>
                <span className="font-heading text-3xl font-bold">{fmtCurrency(order.total)}</span>
              </div>
            </div>

            {/* Payment + notes */}
            {order.payment_method && (
              <div className="flex items-center gap-2 text-sm pt-2 border-t border-border">
                <Receipt className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="text-muted-foreground">Pagamento:</span>
                <span className="font-medium truncate">{order.payment_method}</span>
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

            {/* Order history: somente eventos DESTE pedido, sem repetir consecutivos */}
            {order.status_history && order.status_history.length > 0 && (
              <div className="pt-1">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Histórico do pedido</p>
                <div className="rounded-2xl border border-border divide-y divide-border">
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
              </div>
            )}

            {/* Customer history: OUTROS pedidos do cliente, um card por pedido */}
            <div className="pt-1">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Histórico do cliente</p>
              <p className="text-xs text-muted-foreground mb-2">Pedidos anteriores</p>
              {extraLoading ? (
                <p className="text-sm text-muted-foreground">Carregando...</p>
              ) : custHistory.length === 0 ? (
                <p className="text-sm text-muted-foreground">Este é o primeiro pedido deste cliente.</p>
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
          </div>

            {/* Actions by status */}
            {(primaryAction || cancelAction) && (
              <div className="shrink-0 border-t border-border px-4 sm:px-6 py-3 sm:py-4">
                <div className="flex flex-row justify-end gap-2">
                  {cancelAction && (
                    <Button variant="destructive" className="flex-1 sm:flex-none sm:min-w-32 min-h-11" onClick={onCancel} disabled={busy}>
                      <XCircle className="h-4 w-4" /> Cancelar
                    </Button>
                  )}
                  {primaryAction && (
                    <Button
                      className="flex-1 sm:flex-none sm:min-w-32 min-h-11"
                      onClick={() => handleStatusAction(primaryAction)}
                      disabled={busy}
                    >
                      {statusAction ? 'Atualizando...' : (
                        <>{primaryAction.id === 'accept' ? <Check className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />} {primaryAction.label}</>
                      )}
                    </Button>
                  )}
                </div>
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
              <div className="flex flex-row justify-end gap-2">
                <Button variant="ghost" className="flex-1 sm:flex-none min-h-11" onClick={() => setEditMode(false)}>Fechar</Button>
                <Button variant="outline" className="flex-1 sm:flex-none sm:min-w-32 min-h-11" onClick={() => setEditMode(false)}>Voltar</Button>
                <Button className="flex-1 sm:flex-none sm:min-w-32 min-h-11" onClick={saveEdit} disabled={saving}>
                  {saving ? 'Salvando...' : 'Salvar alterações'}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
