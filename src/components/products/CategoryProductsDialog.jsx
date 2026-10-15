import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/api/supabaseClient';
import { updateProduct as sbUpdateProduct } from '@/api/catalog';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/components/ui/use-toast';
import { ArrowLeft, ArrowRight, Search } from 'lucide-react';
import { runBulk } from '@/lib/bulkSelect';

// Gerencia produtos vinculados a uma categoria em duas colunas:
// esquerda = vinculados, direita = disponíveis. Buscas e seleções
// independentes por coluna; setas movem 1 ou N por vez via updateProduct
// (vínculo = category_id; mover para fora = null — sem duplicidade
// possível por construção). Empilha em telas estreitas.
export default function CategoryProductsDialog({ open, onOpenChange, category, products, companyId, onSaved }) {
  const { toast } = useToast();
  const [queryIn, setQueryIn] = useState('');
  const [queryOut, setQueryOut] = useState('');
  const [selIn, setSelIn] = useState([]);
  const [selOut, setSelOut] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setQueryIn('');
      setQueryOut('');
      setSelIn([]);
      setSelOut([]);
    }
  }, [open, category?.id]);

  const linked = useMemo(
    () => (products || []).filter((p) => p.category_id === category?.id),
    [products, category?.id],
  );
  const available = useMemo(
    () => (products || []).filter((p) => p.category_id !== category?.id),
    [products, category?.id],
  );
  const matchQ = (p, q) => !q.trim() || (p.name || '').toLowerCase().includes(q.trim().toLowerCase());
  const linkedView = linked.filter((p) => matchQ(p, queryIn));
  const availableView = available.filter((p) => matchQ(p, queryOut));

  const toggle = (setter) => (id) => setter((prev) => (
    prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
  ));

  const move = async (ids, toCategoryId, clear) => {
    if (!ids.length || busy || !category?.id) return;
    setBusy(true);
    const targets = (products || []).filter((p) => ids.includes(p.id));
    const { ok, fail } = await runBulk(targets, (p) => sbUpdateProduct(
      supabase, companyId, p.id, { category_id: toCategoryId },
    ));
    clear();
    await onSaved?.();
    setBusy(false);
    if (fail.length === 0) {
      toast({ title: `${ok.length} ${ok.length === 1 ? 'produto movido' : 'produtos movidos'}!` });
    } else {
      toast({
        title: `${ok.length} movidos, ${fail.length} falharam`,
        description: fail.slice(0, 3).map((f) => f.error).join(' • '),
        variant: 'destructive',
      });
    }
  };

  const Column = ({ title, count, query, setQuery, view, selected, setSelected, empty }) => (
    <div className="min-w-0 flex-1 rounded-xl border border-border p-3 space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title} ({count})
      </p>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por nome..." className="pl-8 h-8 text-sm" />
      </div>
      <div className="max-h-64 overflow-y-auto rounded-lg border border-border divide-y divide-border">
        {view.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">{empty}</p>
        ) : view.map((p) => (
          <label key={p.id} className="flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-muted/50">
            <Checkbox
              checked={selected.includes(p.id)}
              onCheckedChange={() => toggle(setSelected)(p.id)}
              aria-label={`Selecionar ${p.name}`}
              className="shrink-0"
            />
            <span className="min-w-0 flex-1 truncate text-sm">{p.name}</span>
          </label>
        ))}
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Produtos de {category?.name || '—'}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col md:flex-row gap-2 md:items-stretch">
          <Column
            title="Vinculados" count={linked.length}
            query={queryIn} setQuery={setQueryIn}
            view={linkedView} selected={selIn} setSelected={setSelIn}
            empty="Nenhum produto vinculado."
          />
          <div className="flex md:flex-col flex-row items-center justify-center gap-1.5 shrink-0">
            <Button
              size="sm" variant="outline" className="h-8 w-8 p-0"
              disabled={busy || selIn.length === 0}
              onClick={() => move(selIn, null, () => setSelIn([]))}
              aria-label="Remover da categoria"
              title="Remover da categoria"
            >
              <ArrowRight className="h-4 w-4 md:rotate-0 rotate-90" />
            </Button>
            <Button
              size="sm" variant="outline" className="h-8 w-8 p-0"
              disabled={busy || selOut.length === 0}
              onClick={() => move(selOut, category?.id, () => setSelOut([]))}
              aria-label="Adicionar à categoria"
              title="Adicionar à categoria"
            >
              <ArrowLeft className="h-4 w-4 md:rotate-0 rotate-90" />
            </Button>
          </div>
          <Column
            title="Disponíveis" count={available.length}
            query={queryOut} setQuery={setQueryOut}
            view={availableView} selected={selOut} setSelected={setSelOut}
            empty="Nenhum produto disponível."
          />
        </div>
        <p className="text-[11px] text-muted-foreground">
          Mover para fora remove o vínculo (sem excluir o produto). Montagem e regras existentes são preservadas.
        </p>
      </DialogContent>
    </Dialog>
  );
}
