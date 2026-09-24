import React from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Image } from '@/components/ui/image';
import { Minus, Plus, Trash2, ShoppingCart, Package } from 'lucide-react';
import { useCart } from '@/lib/CartContext';
import { useNavigate } from 'react-router-dom';

const fmtCurrency = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);

export default function CartDrawer({ open, onClose }) {
  const { items, updateItemQuantity, removeItem, clearCart, getSubtotal, getTotalItems, company } = useCart();
  const navigate = useNavigate();

  const handleCheckout = () => {
    onClose();
    navigate(`/checkout/${company.slug}`);
  };

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent className="w-full sm:max-w-md flex flex-col">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5" />
            Seu carrinho
            <span className="text-sm font-normal text-muted-foreground">
              ({getTotalItems()})
            </span>
          </SheetTitle>
        </SheetHeader>

        {items.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center py-12">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted mb-4">
              <ShoppingCart className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="font-medium text-foreground">Carrinho vazio</p>
            <p className="text-sm text-muted-foreground mt-1">Adicione produtos do cardápio.</p>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto space-y-3 py-4">
              {items.map(item => (
                <div key={item.id} className="flex gap-3 rounded-xl border border-border p-3">
                  {item.image_url ? (
                    <Image src={item.image_url} fittingType="fill" className="h-14 w-14 rounded-lg shrink-0" alt={item.name} />
                  ) : (
                    <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-muted shrink-0">
                      <Package className="h-6 w-6 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm text-foreground truncate">{item.name}</p>
                    {item.complements && item.complements.length > 0 && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                        {item.complements.map(c => c.option_name).join(', ')}
                      </p>
                    )}
                    {item.notes && (
                      <p className="text-xs text-muted-foreground mt-0.5 italic line-clamp-1">📝 {item.notes}</p>
                    )}
                    <div className="flex items-center justify-between mt-2">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => updateItemQuantity(item.id, item.quantity - 1)}
                          disabled={item.quantity <= 1}
                          className="flex h-7 w-7 items-center justify-center rounded-md border border-border hover:bg-muted disabled:opacity-50"
                        >
                          <Minus className="h-3 w-3" />
                        </button>
                        <span className="w-8 text-center text-sm font-medium">{item.quantity}</span>
                        <button
                          onClick={() => updateItemQuantity(item.id, item.quantity + 1)}
                          className="flex h-7 w-7 items-center justify-center rounded-md border border-border hover:bg-muted"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">{fmtCurrency(item.line_total)}</span>
                        <button
                          onClick={() => removeItem(item.id)}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-red-600 hover:bg-red-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <SheetFooter className="flex-col gap-3">
              <Button
                variant="outline"
                className="w-full min-h-11"
                onClick={onClose}
              >
                <Plus className="h-4 w-4" /> Adicionar mais itens
              </Button>
              <div className="flex items-center justify-between w-full">
                <button
                  onClick={clearCart}
                  className="text-xs text-muted-foreground hover:text-red-600"
                >
                  Limpar carrinho
                </button>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Subtotal</p>
                  <p className="font-heading text-lg font-bold">{fmtCurrency(getSubtotal())}</p>
                </div>
              </div>
              <Button
                className="w-full"
                style={{ backgroundColor: company?.primary_color || '#DC2626' }}
                onClick={handleCheckout}
              >
                Finalizar pedido
              </Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}