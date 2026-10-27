import React, { useMemo } from 'react';
import { Search, Package, Plus, Minus, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const fmtCurrency = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);

export default function PdvProductCatalog({
  products = [],
  categories = [],
  items = [],
  search = '',
  onSearchChange,
  filterCat = 'all',
  onFilterCatChange,
  onAdd,
  onQty,
  onSelect = null,
}) {
  const counts = useMemo(() => {
    const map = {};
    for (const item of items) {
      const id = item.product_id;
      if (!id) continue;
      const entry = map[id] || { total: 0, editable: 0, lastLocalId: null };
      const quantity = Number(item.quantity) || 0;
      entry.total += quantity;
      if (!item.persisted) {
        entry.editable += quantity;
        entry.lastLocalId = item.id;
      }
      map[id] = entry;
    }
    return map;
  }, [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (p.available === false) return false;
      if (filterCat !== 'all' && p.category_id !== filterCat) return false;
      if (q && !(p.name || '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [products, filterCat, search]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="relative shrink-0">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => onSearchChange?.(e.target.value)}
          placeholder="Buscar produto..."
          className="h-10 pl-9"
        />
      </div>

      <div className="flex shrink-0 gap-1.5 overflow-x-auto pb-1">
        <button
          type="button"
          onClick={() => onFilterCatChange?.('all')}
          className={`h-8 shrink-0 whitespace-nowrap rounded-full border px-3 text-xs font-medium ${filterCat === 'all' ? 'border-primary bg-primary text-primary-foreground' : 'border-transparent bg-muted text-muted-foreground'}`}
        >
          Todos
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onFilterCatChange?.(c.id)}
            className={`h-8 shrink-0 whitespace-nowrap rounded-full border px-3 text-xs font-medium ${filterCat === c.id ? 'border-primary bg-primary text-primary-foreground' : 'border-transparent bg-muted text-muted-foreground'}`}
          >
            {c.icon} {c.name}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        <div className="space-y-2">
          {filtered.map((p) => {
            const entry = counts[p.id] || { total: 0, editable: 0, lastLocalId: null };
            const hasPersisted = entry.total > entry.editable;
            const media = p.image_url ? (
              <img src={p.image_url} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" loading="lazy" />
            ) : (
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-muted">
                <Package className="h-5 w-5 text-muted-foreground/60" />
              </div>
            );
            const info = (
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium leading-tight text-foreground">{p.name}</p>
                <p className="text-sm font-bold text-primary">{fmtCurrency(p.promotional_price ?? p.price)}</p>
                {hasPersisted && (
                  <p className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Lock className="h-2.5 w-2.5" /> inclui item já enviado
                  </p>
                )}
              </div>
            );
            return (
              <div key={p.id} className="flex min-w-0 items-center gap-2 rounded-xl border border-border bg-card p-2">
                {onSelect ? (
                  <button
                    type="button"
                    onClick={() => onSelect(p)}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`Abrir opções de ${p.name}`}
                  >
                    {media}
                    {info}
                  </button>
                ) : (
                  <>
                    {media}
                    {info}
                  </>
                )}

                <div className="flex shrink-0 items-center gap-1">
                  {entry.total > 0 && (
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      disabled={!entry.lastLocalId || !onQty}
                      onClick={() => entry.lastLocalId && onQty?.(entry.lastLocalId, -1)}
                      aria-label={`Diminuir ${p.name}`}
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <span className="w-6 text-center text-sm font-semibold text-foreground">{entry.total}</span>
                  <Button
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => onAdd?.(p)}
                    aria-label={`Adicionar ${p.name}`}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
        {filtered.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">Nenhum produto encontrado.</p>
        )}
      </div>
    </div>
  );
}
