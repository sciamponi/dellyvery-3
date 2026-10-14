import React, { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Image } from '@/components/ui/image';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Minus, Plus, ShoppingCart, Package, Check } from 'lucide-react';
import { useCart } from '@/lib/CartContext';
import { validateProductConfig } from '@/lib/productConfig';
import { checkCartDependencies } from '@/lib/productDependencies';

const fmtCurrency = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);

// Montagem V2 (Gate 2): passos vindos do storefront (só ativos). Semântica
// de quantidades = POR LINHA (paridade com legado/servidor): o servidor
// cobra o total calculado uma vez por linha, sem multiplicar pela
// quantidade do produto. Preços sempre do banco no servidor.
function v2SelectionOf(v2sel) {
  return {
    steps: Object.entries(v2sel || {})
      .map(([step_id, opts]) => ({
        step_id,
        items: Object.entries(opts || {})
          .filter(([, qty]) => (Number(qty) || 0) > 0)
          .map(([option_id, quantity]) => ({ option_id, quantity: Number(quantity) || 1 })),
      }))
      .filter((s) => s.items.length > 0),
  };
}

function v2PreviewLines(snapshot) {
  const lines = [];
  for (const st of snapshot?.steps || []) {
    for (const it of st.items || []) {
      lines.push({
        group_name: st.title || '',
        option_name: it.name || '',
        price: it.free ? 0 : (Number(it.price) || 0),
        quantity: Number(it.quantity) || 1,
      });
    }
  }
  return lines;
}

export default function ProductModal({ product, primaryColor, isOpen, onClose, onAddToCart }) {
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');
  const [selectedComplements, setSelectedComplements] = useState({});
  // V2: { [step_id]: { [option_id]: qty } }.
  const [v2sel, setV2sel] = useState({});
  // V2: passos vindos do storefront (config = ARRAY de steps) ou do PDV
  // (config = { steps }). Normaliza para { steps }.
  const v2config = (() => {
    const raw = product?.config;
    const steps = Array.isArray(raw) ? raw : raw?.steps;
    return Array.isArray(steps) && steps.length > 0 ? { steps } : null;
  })();
  // FASE 2: cardápio continua visível com loja fechada, mas não adiciona
  // (sempre dentro do CartProvider em /cardapio/:slug, como o CartDrawer).
  const { company: cartCompany, items: cartItems } = useCart();
  const storeClosed = cartCompany?.is_open === false;

  // Reset state when product changes
  React.useEffect(() => {
    if (isOpen) {
      setQuantity(1);
      setNotes('');
      setSelectedComplements({});
      setV2sel({});
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

  // V2: valida pelas regras (obrigatório/min/max/single/repeat) e deriva
  // prévia no formato legado para carrinho/impressão. Servidor revalida tudo.
  const v2calc = useMemo(() => {
    if (!v2config) return null;
    try {
      const snapshot = validateProductConfig({
        product,
        steps: v2config.steps,
        options: v2config.steps.flatMap((s) => s.options || []),
        selection: v2SelectionOf(v2sel),
        quantity: 1,
        flags: { requireActiveProduct: false },
      }).snapshot;
      const preview = v2PreviewLines(snapshot);
      const previewTotal = preview.reduce((s, c) => s + c.price * c.quantity, 0);
      return { preview, previewTotal, error: '' };
    } catch (err) {
      return { preview: [], previewTotal: 0, error: err?.message || 'Seleção inválida' };
    }
  }, [v2config, v2sel, product]);

  const toggleV2Option = (step, option) => {
    setV2sel((prev) => {
      const cur = { ...(prev[step.id] || {}) };
      const has = (cur[option.id] || 0) > 0;
      if (step.select_mode === 'single') {
        return has ? { ...prev, [step.id]: {} } : { ...prev, [step.id]: { [option.id]: 1 } };
      }
      if (has) {
        delete cur[option.id];
      } else {
        const totalQty = Object.values(cur).reduce((s, q) => s + q, 0);
        if (totalQty >= (Number(step.max_select) || 1)) return prev;
        cur[option.id] = 1;
      }
      return { ...prev, [step.id]: cur };
    });
  };

  const stepV2OptionQty = (step, option, delta) => {
    setV2sel((prev) => {
      const cur = { ...(prev[step.id] || {}) };
      const next = Math.max(0, (cur[option.id] || 0) + delta);
      if (next <= 0) delete cur[option.id];
      else cur[option.id] = next;
      return { ...prev, [step.id]: cur };
    });
  };

  const lineTotal = v2config
    ? (unitPrice * quantity) + (v2calc?.previewTotal || 0)
    : (unitPrice * quantity) + complementsTotal;

  // Gate 3: aviso de dependência (OR). Considera o carrinho atual + este
  // produto como se já adicionado; não bloqueia aqui — checkout/servidor
  // barram. Sem `requires`, nada muda.
  const depWarning = useMemo(() => {
    const reqs = Array.isArray(product?.requires) ? product.requires : [];
    if (reqs.length === 0 || !product?.id) return '';
    const rules = reqs.map((r) => ({
      product_id: product.id,
      product_name: product.name,
      requires_product_id: r.id,
      requires_name: r.name,
      active: true,
    }));
    const errs = checkCartDependencies(
      [...(cartItems || []), { product_id: product.id, quantity }],
      rules,
      product.dependency_mode === 'all' ? { [product.id]: 'all' } : undefined,
    );
    return errs.length > 0 ? errs[0].message : '';
  }, [product, quantity, cartItems]);

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
            {depWarning && (
              <p className="text-xs text-amber-700 rounded-lg border border-amber-300 bg-amber-50 p-2.5 mt-2" role="alert">
                ⚠️ {depWarning} — adicione um deles para finalizar o pedido.
              </p>
            )}
          </div>

          {/* Complements: V2 (montagem) ou legado */}
          {v2config ? (
            <div className="space-y-4">
              {v2config.steps.map((step) => {
                const sel = v2sel[step.id] || {};
                const totalQty = Object.values(sel).reduce((s, q) => s + q, 0);
                const effectiveMin = step.required ? Math.max(Number(step.min_select) || 0, 1) : (Number(step.min_select) || 0);
                return (
                  <div key={step.id} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h3 className="font-medium text-sm text-foreground">
                        {step.title}
                        {step.required && <span className="ml-1.5 text-[10px] font-bold text-primary">obrigatório</span>}
                      </h3>
                      <span className="text-xs text-muted-foreground">
                        {totalQty}/{step.max_select}
                        {effectiveMin > 0 ? ` (mín ${effectiveMin})` : ''}
                      </span>
                    </div>
                    {step.free_qty > 0 && (
                      <p className="text-[11px] text-green-700">
                        {step.free_qty} {step.free_qty === 1 ? 'mais barata grátis' : 'mais baratas grátis'}
                      </p>
                    )}
                    <div className="space-y-2">
                      {(step.options || []).map((opt) => {
                        const qty = sel[opt.id] || 0;
                        const checked = qty > 0;
                        return (
                          <div
                            key={opt.id}
                            className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
                          >
                            <button
                              type="button"
                              onClick={() => toggleV2Option(step, opt)}
                              className="flex flex-1 min-w-0 items-center gap-3 text-left cursor-pointer"
                              aria-pressed={checked}
                            >
                              <span
                                aria-hidden
                                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${checked ? 'bg-primary border-primary text-primary-foreground' : 'border-primary/40 bg-transparent'}`}
                              >
                                {checked && <Check className="h-3 w-3" />}
                              </span>
                              <span className="min-w-0">
                                <span className="block text-sm text-foreground truncate">{opt.name}</span>
                                {opt.description && (
                                  <span className="block text-xs text-muted-foreground truncate">{opt.description}</span>
                                )}
                              </span>
                            </button>
                            <div className="flex shrink-0 items-center gap-2">
                              {checked && step.allow_repeat ? (
                                <>
                                  <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => stepV2OptionQty(step, opt, -1)} aria-label="Diminuir">
                                    <Minus className="h-3.5 w-3.5" />
                                  </Button>
                                  <span className="w-6 text-center text-sm font-medium">{qty}</span>
                                  <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => stepV2OptionQty(step, opt, +1)} aria-label="Aumentar">
                                    <Plus className="h-3.5 w-3.5" />
                                  </Button>
                                </>
                              ) : null}
                              <span className="text-sm font-medium text-muted-foreground min-w-12 text-right">
                                {Number(opt.price) > 0 ? `+${fmtCurrency(opt.price)}` : 'Grátis'}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              {v2calc?.error && (
                <p className="text-xs text-amber-700 rounded-lg border border-amber-300 bg-amber-50 p-2.5" role="alert">
                  {v2calc.error}
                </p>
              )}
            </div>
          ) : product.complements && product.complements.length > 0 && (
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
              disabled={storeClosed || !!(v2config && v2calc?.error)}
              onClick={() => {
                if (v2config) {
                  if (v2calc?.error) return;
                  onAddToCart(product, quantity, v2calc.preview, notes, v2SelectionOf(v2sel));
                } else {
                  onAddToCart(product, quantity, complementsArray, notes);
                }
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