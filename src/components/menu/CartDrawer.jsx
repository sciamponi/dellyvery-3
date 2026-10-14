import React, { useMemo } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Image } from '@/components/ui/image';
import { Minus, Plus, Trash2, ShoppingCart, Package, X, Pencil } from 'lucide-react';
import { useCart } from '@/lib/CartContext';
import { useNavigate } from 'react-router-dom';
import { buildDepRulesFromProducts, buildDepModesFromProducts, checkCartDependencies } from '@/lib/productDependencies';

const fmtCurrency = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);

export default function CartDrawer({ open, onClose, products = [], onEditItem }) {
  const { items, updateItemQuantity, removeItem, clearCart, getSubtotal, getTotalItems, company } = useCart();
  const navigate = useNavigate();
  // FASE 2: com loja fechada o cliente vê o carrinho, mas não finaliza.
  const storeClosed = company?.is_open === false;
  // Gate 3: aviso reativo (não remove nada). Ex.: remover o lanche deixa
  // a batata órfã — o checkout/servidor barram; aqui só avisamos.
  const depRules = useMemo(() => buildDepRulesFromProducts(products), [products]);
  const depModes = useMemo(() => buildDepModesFromProducts(products), [products]);
  const depErrors = useMemo(
    () => checkCartDependencies(items, depRules, depModes),
    [items, depRules, depModes],
  );
  const depByProduct = useMemo(() => {
    const map = new Map();
    for (const e of depErrors) {
      if (e && e.productId && !map.has(e.productId)) map.set(e.productId, e);
    }
    return map;
  }, [depErrors]);
  // Indisponível: sumiu do cardápio ativo (só avalia com catálogo carregado).
  const isUnavailable = (item) =>
    products.length > 0 && !products.some((p) => p && p.id === item.product_id);

  const handleCheckout = () => {
    if (storeClosed) return;
    onClose();
    // Preserva a mesa do QR Code (?mesa=token) até o checkout.
    const mesa = new URLSearchParams(window.location.search).get('mesa');
    navigate(`/checkout/${company.slug}${mesa ? `?mesa=${encodeURIComponent(mesa)}` : ''}`);
  };

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent className="w-full sm:max-w-md p-0 gap-0 flex flex-col">
        <SheetHeader className="px-4 py-3 border-b border-border shrink-0 text-left">
          <div className="flex items-center justify-between gap-2 pr-8">
            <SheetTitle className="flex items-center gap-2 text-base">
              <ShoppingCart className="h-5 w-5" />
              Seu carrinho
              <span className="text-sm font-normal text-muted-foreground">
                ({getTotalItems()})
              </span>
            </SheetTitle>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar carrinho"
              className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </SheetHeader>

        {items.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center py-12 px-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted mb-4">
              <ShoppingCart className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="font-medium text-foreground">Carrinho vazio</p>
            <p className="text-sm text-muted-foreground mt-1">Adicione produtos do cardápio.</p>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
              {items.map(item => {
                const depErr = depByProduct.get(item.product_id) || null;
                const unavailable = !depErr && isUnavailable(item);
                return (
                <div
                  key={item.id}
                  className={`flex gap-2.5 rounded-xl border bg-card p-2.5 ${
                    depErr ? 'border-amber-300' : unavailable ? 'border-red-300 opacity-75' : 'border-border'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onEditItem && onEditItem(item)}
                    disabled={!onEditItem}
                    aria-label={onEditItem ? `Editar ${item.name}` : item.name}
                    className={`shrink-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${onEditItem ? 'cursor-pointer' : 'cursor-default'}`}
                  >
                  {item.image_url ? (
                    <div className="h-12 w-12 rounded-lg overflow-hidden bg-muted">
                      <Image src={item.image_url} fittingType="fill" className="h-full w-full" alt={item.name} />
                    </div>
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-muted">
                      <Package className="h-5 w-5 text-muted-foreground/60" />
                    </div>
                  )}
                  </button>
                  <div className="flex-1 min-w-0">
                    <button
                      type="button"
                      onClick={() => onEditItem && onEditItem(item)}
                      disabled={!onEditItem}
                      className={`block w-full min-w-0 text-left rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${onEditItem ? 'cursor-pointer' : 'cursor-default'}`}
                      aria-label={onEditItem ? `Editar ${item.name}` : undefined}
                    >
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium text-sm text-foreground truncate flex-1 min-w-0">{item.name}</p>
                      <span className="font-semibold text-sm shrink-0">{fmtCurrency(item.line_total)}</span>
                    </div>
                    {item.complements && item.complements.length > 0 && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                        {item.complements.map(c => c.option_name).join(', ')}
                      </p>
                    )}
                    {item.notes && (
                      <p className="text-xs text-muted-foreground mt-0.5 italic line-clamp-1">📝 {item.notes}</p>
                    )}
                    </button>
                    {(depErr || unavailable) && (
                      <p className={`mt-1 rounded-lg border p-1.5 text-[11px] ${depErr ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-red-200 bg-red-50 text-red-700'}`} role="alert">
                        {depErr ? `⚠️ ${depErr.message}` : '⛔ Produto indisponível no momento — remova para continuar.'}
                      </p>
                    )}
                    <div className="flex items-center justify-between mt-1.5">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => updateItemQuantity(item.id, item.quantity - 1)}
                          disabled={item.quantity <= 1}
                          aria-label="Diminuir quantidade"
                          className="flex h-9 w-9 items-center justify-center rounded-md border border-border hover:bg-muted disabled:opacity-50 transition-colors"
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                        <span className="w-8 text-center text-sm font-medium">{item.quantity}</span>
                        <button
                          type="button"
                          onClick={() => updateItemQuantity(item.id, item.quantity + 1)}
                          aria-label="Aumentar quantidade"
                          className="flex h-9 w-9 items-center justify-center rounded-md border border-border hover:bg-muted transition-colors"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="flex items-center gap-1">
                      {onEditItem && (
                        <button
                          type="button"
                          onClick={() => onEditItem(item)}
                          aria-label={`Editar ${item.name}`}
                          className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => removeItem(item.id)}
                        aria-label={`Remover ${item.name}`}
                        className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      >
                      <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
                );
              })}
            </div>

            <SheetFooter className="px-4 py-3 border-t border-border shrink-0 flex-col gap-2 sm:flex-col">
              <div className="flex items-center justify-between w-full">
                <span className="text-sm text-muted-foreground">Subtotal</span>
                <span className="font-heading text-base font-bold">{fmtCurrency(getSubtotal())}</span>
              </div>
              {depErrors.length > 0 && (
                <div className="w-full rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-800" role="alert">
                  {depErrors.map((e) => (
                    <p key={e.productId}>⚠️ {e.message}</p>
                  ))}
                </div>
              )}
              {storeClosed && (
                <p className="w-full rounded-lg border border-red-200 bg-red-50 p-2.5 text-center text-sm text-red-700">
                  🔴 Restaurante fechado — Estamos fechados no momento.
                </p>
              )}
              <Button
                variant="outline"
                className="w-full h-10"
                onClick={onClose}
              >
                <Plus className="h-4 w-4" /> Adicionar mais itens
              </Button>
              <Button
                className="w-full h-11 font-semibold"
                style={{ backgroundColor: company?.primary_color || '#DC2626' }}
                disabled={storeClosed}
                onClick={handleCheckout}
              >
                {storeClosed ? 'Fechado agora' : 'Finalizar pedido'}
              </Button>
              <button
                type="button"
                onClick={clearCart}
                className="text-xs text-muted-foreground hover:text-destructive transition-colors mx-auto py-0.5"
              >
                Limpar carrinho
              </button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
