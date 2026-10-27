import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertCircle, Loader2, RotateCcw, Search, Table2 } from 'lucide-react';

export default function PdvTableView({
  tableCards = [],
  search = '',
  onSearchChange,
  error = '',
  loading = false,
  onRetry,
  onOpenTable,
}) {
  const query = search.trim().toLowerCase();
  const visibleCards = query
    ? tableCards.filter((card) => (card.name || '').toLowerCase().includes(query)
      || (card.code || '').toLowerCase().includes(query)
      || card.comandas.some((c) => (c.customerName || '').toLowerCase().includes(query)))
    : tableCards;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="min-w-0">
        <h2 className="font-heading text-lg font-bold text-foreground">Mesas</h2>
        <p className="text-xs text-muted-foreground">Toque em uma mesa para abrir o pedido.</p>
      </div>

      {error && (
        <div className="shrink-0 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive" role="alert">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="min-w-0 flex-1">Não foi possível carregar as mesas/comandas. {error}</p>
            <Button variant="outline" size="sm" className="min-h-8 shrink-0" onClick={onRetry} disabled={loading}>
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />} Tentar
            </Button>
          </div>
        </div>
      )}

      {tableCards.length > 0 && (
        <div className="relative shrink-0">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => onSearchChange?.(e.target.value)} placeholder="Buscar mesa..." className="h-10 pl-9" />
          {loading && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
        </div>
      )}

      {tableCards.length === 0 && loading ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-2xl border border-border p-6 text-center">
          <Loader2 className="h-7 w-7 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Carregando mesas...</p>
        </div>
      ) : tableCards.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border p-6 text-center">
          <Table2 className="h-9 w-9 text-muted-foreground/60" />
          <div>
            <p className="text-sm font-medium text-foreground">Nenhuma mesa cadastrada</p>
            <p className="mt-1 text-xs text-muted-foreground">Cadastre as mesas em Configurações &gt; PDV.</p>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {visibleCards.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma mesa encontrada para “{search}”.</p>
          )}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-[repeat(auto-fill,minmax(200px,1fr))]">
            {visibleCards.map((card) => {
              const occupied = card.comandas.length > 0;
              return (
                <button
                  key={card.key}
                  type="button"
                  onClick={() => onOpenTable(card)}
                  className={`min-h-14 min-w-0 rounded-2xl border bg-card p-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${occupied ? 'border-amber-200' : 'border-border'}`}
                  aria-label={`Abrir mesa ${card.name} (${occupied ? 'ocupada' : 'livre'})`}
                >
                  <div className="flex items-center gap-2">
                    <Table2 className="h-5 w-5 shrink-0 text-primary" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-heading text-base font-bold leading-tight text-foreground">Mesa {card.name}</p>
                      <span className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${occupied ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                        {occupied ? 'Ocupada' : 'Livre'}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
