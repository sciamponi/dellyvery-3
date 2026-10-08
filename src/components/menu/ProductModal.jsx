import React, { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Image } from '@/components/ui/image';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Minus, Plus, ShoppingCart, Package } from 'lucide-react';
import { useCart } from '@/lib/CartContext';

const fmtCurrency = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);

export default function ProductModal({ product, primaryColor, isOpen, onClose, onAddToCart }) {
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');
  const [selectedComplements, setSelectedComplements] = useState({});
  // FASE 2: cardápio continua visível com loja fechada, mas não adiciona
  // (sempre dentro do CartProvider em /cardapio/:slug, como o CartDrawer).
  const { company: cartCompany } = useCart();
  const storeClosed = cartCompany?.is_open === false;

  // Reset state when product changes
  React.useEffect(() => {
    if (isOpen) {
      setQuantity(1);
      setNotes('');
      setSelectedComplements({});
    }
  }, [isOpen, product?.id]);

  const toggleComplement = (groupIndex, optionIndex, option, maxSelect) => {
    setSelectedComplements(prev => {
      const key = `${groupIndex}_${optionIndex}`;
      const current = prev[key];
      const groupSelections = Object.entries(prev)
        .filter(([k]) => k.startsWith(`${groupIndex}_`))
        .map(([k, v]) => ({ key: k, ...v }));

      if (current) {
        // Deselect
        const next = { ...prev };
        delete next[key];
        return next;
      }

      // Check max_select
      if (maxSelect && groupSelections.length >= maxSelect) {
        return prev; // Can't select more
      }

      return {
        ...prev,
        [key]: {
          group_name: option.groupName,
          option_name: option.name,
          price: option.price,
          quantity: 1
        }
      };
    });
  };

  const complementsArray = useMemo(() => Object.values(selectedComplements), [selectedComplements]);

  const complementsTotal = complementsArray.reduce((sum, c) => sum + c.price * c.quantity, 0);
  const unitPrice = product?.promotional_price != null ? product.promotional_price : product?.price || 0;
  const lineTotal = (unitPrice * quantity) + complementsTotal;

  if (!product) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        className="max-w-lg max-h-[90vh] overflow-y-auto"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="sr-only">{product.name}</DialogTitle>
        </DialogHeader>

        {/* Product image */}
        {product.image_url ? (
          <div className="relative -mx-6 -mt-6 h-48 overflow-hidden rounded-t-lg">
            <Image src={product.image_url} fittingType="fill" className="w-full h-full" alt={product.name} />
          </div>
        ) : (
          <div className="flex h-40 items-center justify-center rounded-xl bg-muted -mt-2">
            <Package className="h-12 w-12 text-muted-foreground" />
          </div>
        )}

        <div className="space-y-4">
          <div>
            <h2 className="font-heading text-xl font-bold text-foreground">{product.name}</h2>
            {product.description && (
              <p className="text-sm text-muted-foreground mt-1">{product.description}</p>
            )}
            <p className="font-heading text-lg font-bold mt-2" style={{ color: primaryColor }}>
              {fmtCurrency(unitPrice)}
            </p>
          </div>

          {/* Complements */}
          {product.complements && product.complements.length > 0 && (
            <div className="space-y-4">
              {product.complements.map((group, gi) => {
                const groupSelections = Object.entries(selectedComplements)
                  .filter(([k]) => k.startsWith(`${gi}_`)).length;
                return (
                  <div key={gi} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h3 className="font-medium text-sm text-foreground">{group.name}</h3>
                      {group.max_select && (
                        <span className="text-xs text-muted-foreground">
                          {groupSelections}/{group.max_select}
                        </span>
                      )}
                    </div>
                    <div className="space-y-2">
                      {group.options?.map((opt, oi) => {
                        const key = `${gi}_${oi}`;
                        const checked = !!selectedComplements[key];
                        return (
                          <label
                            key={oi}
                            className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 cursor-pointer hover:bg-muted/50 transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              <Checkbox
                                checked={checked}
                                onCheckedChange={() => toggleComplement(gi, oi, { ...opt, groupName: group.name }, group.max_select)}
                              />
                              <span className="text-sm text-foreground">{opt.name}</span>
                            </div>
                            {opt.price > 0 && (
                              <span className="text-sm font-medium text-muted-foreground">
                                +{fmtCurrency(opt.price)}
                              </span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Notes */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Observações</label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex: sem cebola, ponto da carne, etc."
              rows={2}
            />
          </div>

          {/* Quantity + Add button */}
          {storeClosed && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              🔴 Restaurante fechado no momento — você pode ver o cardápio, mas não é possível adicionar itens agora.
            </div>
          )}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={() => setQuantity(q => Math.max(1, q - 1))}
                disabled={storeClosed}
              >
                <Minus className="h-4 w-4" />
              </Button>
              <span className="w-10 text-center font-medium">{quantity}</span>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setQuantity(q => Math.min(99, q + 1))}
                disabled={storeClosed}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <Button
              className="flex-1"
              style={{ backgroundColor: primaryColor }}
              disabled={storeClosed}
              onClick={() => {
                onAddToCart(product, quantity, complementsArray, notes);
                onClose();
              }}
            >
              <ShoppingCart className="h-4 w-4" />
              {storeClosed ? 'Fechado agora' : `Adicionar • ${fmtCurrency(lineTotal)}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}