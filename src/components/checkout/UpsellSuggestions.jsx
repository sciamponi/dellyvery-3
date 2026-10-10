import React, { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Image } from '@/components/ui/image';
import { useCart } from '@/lib/CartContext';
import { suggestUpsell, hasConfigurableOptions } from '@/lib/upsell';
import { Plus, Minus, Package, Sparkles } from 'lucide-react';

const fmtCurrency = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);

// Etapa compacta de venda adicional no checkout (bebidas, sobremesas,
// relacionados). Usa dados reais do catálogo; configuráveis abrem o
// ProductModal via onCustomize (preserva o motor de personalização).
// Modo wizard (Fase B): passe `section` (uma etapa de suggestUpsellSteps)
// para renderizar só ela; sem `section`, calcula todas (legado).
export default function UpsellSuggestions({ products, categories, primaryColor, onCustomize, onSkip, section = null }) {
  const { items, addItem, updateItemQuantity, removeItem } = useCart();

  const allSections = useMemo(
    () => suggestUpsell({ products, categories, cartItems: items }),
    [products, categories, items],
  );
  const sections = section ? [section] : allSections;

  // Linha do carrinho correspondente ao produto base (sem personalização),
  // para stepper de quantidade direto na sugestão.
  const baseLineOf = (productId) => items.find(
    (i) => i.product_id === productId && (!i.complements || i.complements.length === 0) && !i.notes,
  );

  if (sections.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">Nenhuma sugestão disponível no momento.</p>
        <Button className="w-full h-10 text-sm" style={{ backgroundColor: primaryColor }} onClick={onSkip}>
          Continuar
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-heading text-base font-bold flex items-center gap-1.5">
          <Sparkles className="h-4 w-4" style={{ color: primaryColor }} /> Quer adicionar?
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">Sugestões do cardápio — opcional, pode pular.</p>
      </div>

      {sections.map(section => (
        <div key={section.id}>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">{section.title}</p>
          <div className="space-y-1.5">
            {section.items.map(product => {
              const price = product.promotional_price != null ? product.promotional_price : product.price;
              const configurable = hasConfigurableOptions(product);
              const line = baseLineOf(product.id);
              return (
                <div key={product.id} className="flex items-center gap-2 rounded-xl border border-border bg-card p-2">
                  {product.image_url ? (
                    <Image src={product.image_url} fittingType="fill" className="h-11 w-11 rounded-lg shrink-0 object-cover" alt={product.name} />
                  ) : (
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-muted">
                      <Package className="h-5 w-5 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{product.name}</p>
                    <p className="text-xs font-semibold" style={{ color: primaryColor }}>{fmtCurrency(price)}</p>
                  </div>
                  {line ? (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => (line.quantity <= 1 ? removeItem(line.id) : updateItemQuantity(line.id, line.quantity - 1))}
                        className="flex h-7 w-7 items-center justify-center rounded-md border border-border"
                        aria-label={`Diminuir ${product.name}`}
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                      <span className="w-6 text-center text-xs font-medium">{line.quantity}</span>
                      <button
                        type="button"
                        onClick={() => updateItemQuantity(line.id, line.quantity + 1)}
                        className="flex h-7 w-7 items-center justify-center rounded-md border border-border"
                        aria-label={`Aumentar ${product.name}`}
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>
                  ) : configurable ? (
                    <Button size="sm" variant="outline" className="h-7 text-xs shrink-0" onClick={() => onCustomize(product)}>
                      Opções
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      className="h-7 text-xs shrink-0"
                      style={{ backgroundColor: primaryColor }}
                      onClick={() => addItem(product, 1, [], '')}
                      aria-label={`Adicionar ${product.name}`}
                    >
                      <Plus className="h-3 w-3" /> Add
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <Button variant="ghost" className="w-full h-9 text-xs text-muted-foreground" onClick={onSkip}>
        Pular sugestões
      </Button>
    </div>
  );
}
