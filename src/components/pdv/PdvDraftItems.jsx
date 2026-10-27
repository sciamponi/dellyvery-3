import React from 'react';
import { Minus, Plus, Trash2, Package, SlidersHorizontal, Lock, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { getProductImages } from '@/lib/productMedia';

const fmtCurrency = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);

function ItemThumb({ src }) {
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) {
    return (
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-muted">
        <Package className="h-4 w-4 text-muted-foreground" />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      className="h-11 w-11 shrink-0 rounded-lg object-cover"
      onError={() => setFailed(true)}
    />
  );
}

export default function PdvDraftItems({
  items = [],
  products = [],
  onQty,
  onRemove,
  onEdit,
  noteOpenId,
  onToggleNote,
  onNotesChange,
  emptyText = 'Nenhum item no pedido.',
}) {
  const productById = React.useMemo(
    () => new Map((products || []).map((product) => [product.id, product])),
    [products],
  );

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border py-8 text-center">
        <SlidersHorizontal className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">{emptyText}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((it) => {
        const unit = Number(it.unit_price) || 0;
        const extras = (it.complements || []).reduce((s, c) => s + (Number(c.price) || 0) * (Number(c.quantity) || 0), 0);
        const lineTotal = unit * (Number(it.quantity) || 0) + extras;
        const locked = !!it.persisted;
        const pendingUpdate = !!it.pendingUpdate;
        const product = productById.get(it.product_id);
        const imageSrc = it.image_url || getProductImages(product)[0] || '';
        const complementsText = (it.complements || [])
          .map((c) => {
            const name = c?.option_name || c?.name || c?.group_name || 'Adicional';
            return `${c.quantity > 1 ? `${c.quantity}x ` : ''}${name}`;
          })
          .join(', ');

        return (
          <div key={it.id} className="group rounded-xl border border-border bg-card p-2.5">
            <button
              type="button"
              onClick={() => onEdit?.(it)}
              disabled={!onEdit}
              aria-label={onEdit ? `Editar ${it.name}` : undefined}
              className="flex w-full min-w-0 items-start gap-2 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
            >
              <ItemThumb src={imageSrc} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="text-[13px] font-medium leading-tight text-foreground">{it.name}</p>
                  {locked && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                      <Lock className="h-2.5 w-2.5" /> Enviado
                    </span>
                  )}
                  {pendingUpdate && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                      <Pencil className="h-2.5 w-2.5" /> Alterado
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">{fmtCurrency(unit)} un.</p>
                {complementsText && (
                  <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">+ {complementsText}</p>
                )}
                {it.notes && <p className="mt-0.5 line-clamp-2 text-[11px] italic text-muted-foreground">Obs: {it.notes}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <span className="text-sm font-semibold text-foreground">{fmtCurrency(lineTotal)}</span>
                {onEdit && <Pencil className="h-3.5 w-3.5 text-muted-foreground opacity-50 transition-opacity group-hover:opacity-100" />}
              </div>
            </button>

            {locked ? (
              <button
                type="button"
                onClick={() => onEdit?.(it)}
                disabled={!onEdit}
                aria-label={onEdit ? `Editar adicionais de ${it.name}` : undefined}
                className="mt-2 flex w-full items-center gap-1.5 rounded-md text-left text-[11px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
              >
                <Lock className="h-3 w-3 shrink-0" /> Enviado. Toque no item para editar os adicionais.
              </button>
            ) : (
              <>
                <div className="mt-2 flex items-center gap-1">
                  <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => onQty?.(it.id, -1)} aria-label="Diminuir">
                    <Minus className="h-3.5 w-3.5" />
                  </Button>
                  <span className="w-7 text-center text-sm font-medium">{it.quantity}</span>
                  <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => onQty?.(it.id, 1)} aria-label="Aumentar">
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                  {onEdit && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-1 h-8 px-2 text-xs"
                      onClick={() => onEdit(it)}
                      title="Abrir montagem do produto"
                    >
                      <SlidersHorizontal className="h-3.5 w-3.5" /> Montar
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto h-8 px-2 text-xs text-muted-foreground"
                    onClick={() => onToggleNote?.(it.id)}
                  >
                    Obs
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground"
                    onClick={() => onRemove?.(it.id)}
                    aria-label="Remover item"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>

                {pendingUpdate && (
                  <p className="mt-1 flex items-center gap-1.5 text-[11px] text-amber-700">
                    <Pencil className="h-3 w-3 shrink-0" /> Será aplicado ao atualizar a comanda.
                  </p>
                )}

                {noteOpenId === it.id && (
                  <Textarea
                    value={it.notes || ''}
                    onChange={(e) => onNotesChange?.(it.id, e.target.value)}
                    placeholder="Observações do item"
                    rows={2}
                    className="mt-2 text-xs"
                  />
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
