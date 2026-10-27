import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ArrowLeft, Check, ChevronDown, ClipboardList, Layers, Package, Plus, Send, User } from 'lucide-react';
import AutoAssemblyPanel from '@/components/pdv/AutoAssemblyPanel';
import PdvProductCatalog from '@/components/pdv/PdvProductCatalog';
import PdvDraftItems from '@/components/pdv/PdvDraftItems';
import { orderStatusView } from '@/lib/orderStatusView';
import { sortComandasByRecency } from '@/lib/pdvWorkspace';

const fmtCurrency = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);

export default function PdvOrderModal({
  open,
  onClose,
  companyId = '',
  tableName = '',
  selectedComanda = null,
  tableComandas = [],
  onSelectComanda,
  onNewComanda,
  onMergeComandas,
  onAutoAdd,
  products = [],
  categories = [],
  items = [],
  search = '',
  onSearchChange,
  filterCat = 'all',
  onFilterCatChange,
  onAdd,
  onQty,
  onRemove,
  onEdit,
  noteOpenId,
  onToggleNote,
  onNotesChange,
  subtotal = 0,
  discount = '',
  onDiscountChange,
  discountValue = 0,
  total = 0,
  itemCount = 0,
  customer = { name: '', phone: '' },
  customerSearch = '',
  onCustomerNameChange,
  onCustomerPhoneChange,
  matchedCustomers = [],
  onPickCustomer,
  paymentMethod = '',
  onPaymentMethodChange,
  changeFor = '',
  onChangeForChange,
  payments = [],
  depErrors = [],
  submitting = false,
  onSubmit,
}) {
  const [activePane, setActivePane] = useState('catalog');
  const [autoProduct, setAutoProduct] = useState(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const tableOccupied = !!selectedComanda || tableComandas.length > 0;
  const comandaStatus = selectedComanda ? orderStatusView(selectedComanda.status) : null;
  const orderedComandas = sortComandasByRecency(tableComandas).reverse();

  useEffect(() => {
    if (!open) {
      setAutoProduct(null);
      return;
    }
    setAutoProduct(null);
    setActivePane('catalog');
  }, [open, tableName, selectedComanda?.id]);

  const togglePane = () => {
    setActivePane((prev) => (prev === 'catalog' ? 'summary' : 'catalog'));
  };

  const startAutoProduct = (product) => {
    setAutoProduct(product);
    setActivePane('catalog');
  };

  const cancelAuto = () => {
    setAutoProduct(null);
  };

  const addAutoLine = (line) => {
    onAutoAdd?.(line);
    setAutoProduct(null);
    setActivePane('catalog');
  };

  const handleSubmit = async () => {
    if (submitting) return;
    await onSubmit?.();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose?.(); }}>
      <DialogContent className="flex h-[calc(100dvh-0.5rem)] w-[calc(100vw-0.5rem)] max-w-6xl flex-col gap-0 overflow-hidden p-0 sm:h-[min(92vh,860px)]">
        <DialogHeader className="shrink-0 space-y-2 border-b border-border py-2.5 pl-3 pr-12 text-left sm:pl-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <DialogTitle className="truncate font-heading text-lg font-bold">
                  {tableName ? `Mesa ${tableName}` : 'Pedido'}
                </DialogTitle>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${tableOccupied ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                  {tableOccupied ? 'Ocupada' : 'Livre'}
                </span>
                {comandaStatus && (
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${comandaStatus.className}`}>
                    {comandaStatus.label}
                  </span>
                )}
              </div>
              <DialogDescription className="truncate text-xs">
                {selectedComanda
                  ? `Comanda #${selectedComanda.order_number}${selectedComanda.customer_name ? ` · ${selectedComanda.customer_name}` : ''}`
                  : 'Monte, revise e envie o pedido.'}
              </DialogDescription>
            </div>
            <div className="flex w-full shrink-0 gap-1.5 sm:w-auto">
              <div role="group" aria-label="Seção do pedido" className="hidden min-h-9 shrink-0 rounded-lg border border-border bg-muted/60 p-0.5 sm:flex">
                <button
                  type="button"
                  onClick={togglePane}
                  aria-pressed={activePane === 'catalog'}
                  aria-label={activePane === 'catalog' ? 'Produtos ativo. Alternar para Pedido' : 'Ativar Produtos'}
                  className={`flex min-w-0 flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-md px-1.5 text-[10px] font-semibold transition-colors sm:px-2 sm:text-xs ${activePane === 'catalog' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  <Package className="hidden h-3.5 w-3.5 shrink-0 sm:block" /> Produtos
                </button>
                <button
                  type="button"
                  onClick={togglePane}
                  aria-pressed={activePane === 'summary'}
                  aria-label={activePane === 'summary' ? 'Pedido ativo. Alternar para Produtos' : 'Ativar Pedido'}
                  className={`flex min-w-0 flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-md px-1.5 text-[10px] font-semibold transition-colors sm:px-2 sm:text-xs ${activePane === 'summary' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  <ClipboardList className="hidden h-3.5 w-3.5 shrink-0 sm:block" /> Pedido ({itemCount})
                </button>
              </div>
            </div>
          </div>

          {tableComandas.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
              {tableComandas.length > 1 && orderedComandas.map((comanda) => {
                const status = orderStatusView(comanda.status);
                const active = comanda.id === selectedComanda?.id;
                return (
                  <button
                    key={comanda.id}
                    type="button"
                    onClick={() => onSelectComanda?.(comanda.id)}
                    aria-pressed={active}
                    title={status.label}
                    className={`flex max-w-[220px] shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${active ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card text-muted-foreground hover:bg-muted'}`}
                  >
                    <span className={`h-2 w-2 shrink-0 rounded-full ${status.className}`} />
                    <span className="truncate">
                      #{comanda.order_number} · {comanda.customer_name || 'Sem cliente'}
                    </span>
                  </button>
                );
              })}
              <Button
                variant="outline"
                size="sm"
                className="h-8 shrink-0 px-2.5 text-xs"
                onClick={() => onNewComanda?.()}
              >
                <Plus className="h-3.5 w-3.5" /> Nova
              </Button>
              {tableComandas.length > 1 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 shrink-0 px-2.5 text-xs"
                  onClick={() => onMergeComandas?.()}
                >
                  <Layers className="h-3.5 w-3.5" /> Juntar
                </Button>
              )}
            </div>
          )}

        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className={`${activePane === 'catalog' ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col`}>
            <div className="flex min-h-0 flex-1 flex-col p-3 sm:p-4">
              {autoProduct ? (
                <AutoAssemblyPanel
                  companyId={companyId}
                  product={autoProduct}
                  tableLabel={tableName}
                  onAdd={addAutoLine}
                  onCancel={cancelAuto}
                />
              ) : (
                <PdvProductCatalog
                  products={products}
                  categories={categories}
                  items={items}
                  search={search}
                  onSearchChange={onSearchChange}
                  filterCat={filterCat}
                  onFilterCatChange={onFilterCatChange}
                  onAdd={onAdd}
                  onQty={onQty}
                  onSelect={startAutoProduct}
                />
              )}
            </div>
            {!autoProduct && (
              <div className="shrink-0 border-t border-border bg-card px-3 pb-[calc(0.75rem_+_env(safe-area-inset-bottom))] pt-2.5 sm:hidden">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted-foreground">{itemCount} {itemCount === 1 ? 'item' : 'itens'}</p>
                    <p className="font-heading font-bold">{fmtCurrency(total)}</p>
                  </div>
                  <Button
                    type="button"
                    className="min-h-11 shrink-0 px-4 text-xs font-semibold uppercase tracking-wide"
                    onClick={() => setActivePane('summary')}
                    aria-label="Ver pedido"
                  >
                    VER pedido
                  </Button>
                </div>
              </div>
            )}
          </div>

          <aside className={`${activePane === 'summary' ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col overflow-hidden border-t border-border`}>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 pb-2 sm:p-4 sm:pb-3">
              <Button
                variant="ghost"
                size="sm"
                className="-ml-2 min-h-9 w-fit gap-1 px-2 text-xs sm:hidden"
                onClick={() => setActivePane('catalog')}
              >
                <ArrowLeft className="h-4 w-4" /> Voltar aos produtos
              </Button>
              <div className="flex items-center justify-between gap-2">
                <Label className="text-sm">Itens ({itemCount})</Label>
                <div className="flex min-w-0 items-center gap-1.5">
                  {comandaStatus && (
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${comandaStatus.className}`}>
                      {comandaStatus.label}
                    </span>
                  )}
                  {selectedComanda && (
                    <span className="max-w-[120px] truncate rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                      Comanda #{selectedComanda.order_number}
                    </span>
                  )}
                </div>
              </div>

              <PdvDraftItems
                items={items}
                products={products}
                onQty={onQty}
                onRemove={onRemove}
                onEdit={onEdit}
                noteOpenId={noteOpenId}
                onToggleNote={onToggleNote}
                onNotesChange={onNotesChange}
                emptyText="Adicione produtos para montar o pedido."
              />

              {depErrors.length > 0 && (
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-800" role="alert">
                  {depErrors.map((e) => (
                    <p key={e.productId}>{e.message}</p>
                  ))}
                </div>
              )}

              <div className="space-y-1.5 border-t border-border pt-3">
                <Label htmlFor="pdv-order-customer">Cliente (opcional)</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="pdv-order-customer"
                    value={customerSearch || customer.name}
                    onChange={(e) => onCustomerNameChange?.(e.target.value)}
                    placeholder="Buscar ou nome avulso"
                    className="h-9 pl-9"
                  />
                </div>
                {matchedCustomers.length > 0 && (
                  <div className="overflow-hidden rounded-xl border border-border">
                    {matchedCustomers.slice(0, 3).map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className="w-full truncate px-3 py-2 text-left text-sm hover:bg-muted"
                        onClick={() => onPickCustomer?.(c)}
                      >
                        {c.name} {c.phone && <span className="text-muted-foreground">� {c.phone}</span>}
                      </button>
                    ))}
                  </div>
                )}
                <Input
                  value={customer.phone}
                  onChange={(e) => onCustomerPhoneChange?.(e.target.value)}
                  placeholder="Telefone"
                  inputMode="tel"
                  className="h-9"
                />
              </div>

              <div className="space-y-1 border-t border-border pt-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span>{fmtCurrency(subtotal)}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Desconto</span>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground">R$</span>
                    <Input
                      value={discount}
                      onChange={(e) => onDiscountChange?.(e.target.value.replace(/[^0-9.,]/g, '').replace(',', '.'))}
                      placeholder="0,00"
                      inputMode="decimal"
                      className="h-8 w-24 text-right"
                      aria-label="Desconto em reais"
                    />
                  </div>
                </div>
                {discountValue > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span>Desconto aplicado</span>
                    <span>-{fmtCurrency(discountValue)}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="shrink-0 border-t border-border bg-card px-3 pb-[calc(0.75rem_+_env(safe-area-inset-bottom))] pt-2.5 sm:px-4 sm:pb-4 sm:pt-3">
              <div className="flex items-center gap-3">
                <Popover open={paymentOpen} onOpenChange={setPaymentOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="min-w-0 flex-1 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={`Total ${fmtCurrency(total)}. ${paymentMethod ? `Forma de recebimento: ${paymentMethod}` : 'Escolher forma de recebimento'}`}
                    >
                      <p className="text-xs text-muted-foreground">Total</p>
                      <p className="font-heading text-lg font-bold leading-tight">{fmtCurrency(total)}</p>
                      <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] font-medium text-primary">
                        <span className="truncate">{paymentMethod || 'Escolher recebimento'}</span>
                        <ChevronDown className="h-3 w-3 shrink-0" />
                      </p>
                    </button>
                  </PopoverTrigger>
                  <PopoverContent side="top" align="start" className="w-64 p-2">
                    <div className="space-y-1">
                      {payments.map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => {
                            onPaymentMethodChange?.(p);
                            if (p !== 'Dinheiro') setPaymentOpen(false);
                          }}
                          className={`flex min-h-11 w-full items-center justify-between rounded-md px-3 text-sm ${paymentMethod === p ? 'bg-primary/10 font-semibold text-primary' : 'hover:bg-muted'}`}
                        >
                          {p}
                          {paymentMethod === p && <Check className="h-4 w-4" />}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => {
                          onPaymentMethodChange?.('');
                          setPaymentOpen(false);
                        }}
                        className="flex min-h-11 w-full items-center justify-between rounded-md px-3 text-sm text-muted-foreground hover:bg-muted"
                      >
                        Não informar
                        {!paymentMethod && <Check className="h-4 w-4" />}
                      </button>
                    </div>
                    {paymentMethod === 'Dinheiro' && (
                      <div className="mt-2 border-t border-border pt-2">
                        <Label htmlFor="pdv-order-change" className="text-xs text-muted-foreground">Troco para R$</Label>
                        <Input
                          id="pdv-order-change"
                          value={changeFor}
                          onChange={(e) => onChangeForChange?.(e.target.value.replace(/[^0-9.,]/g, '').replace(',', '.'))}
                          placeholder="0,00"
                          inputMode="decimal"
                          className="mt-1 h-9 text-right"
                        />
                      </div>
                    )}
                  </PopoverContent>
                </Popover>
                <Button
                  className="min-h-11 shrink-0 whitespace-nowrap px-4 text-xs font-semibold"
                  onClick={handleSubmit}
                  disabled={submitting || items.length === 0}
                >
                  <Send className="h-4 w-4" />
                  {submitting ? 'Enviando...' : 'Enviar pedido'}
                </Button>
              </div>
            </div>
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}
