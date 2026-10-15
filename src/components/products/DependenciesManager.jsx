import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/api/supabaseClient';
import {
  listDependenciesWithNames, createDependency,
  setDependencyActive, deleteDependency,
} from '@/api/configurator';
import { listProducts } from '@/api/catalog';
import { updateProduct as sbUpdateProduct } from '@/api/catalog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { Plus, Trash2, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';

// Regras comerciais opt-in: produto exige ao menos um dos exigidos no
// mesmo pedido (OR). Sem regra, tudo funciona como hoje. RLS: escrita
// OWNER/ADMIN/MANAGER; trigger garante mesma empresa.
export default function DependenciesManager({ companyId }) {
  const { toast } = useToast();
  const [rules, setRules] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [dependentId, setDependentId] = useState('');
  const [selectedRequires, setSelectedRequires] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const [rls, prods] = await Promise.all([
        listDependenciesWithNames(supabase, companyId),
        listProducts(supabase, companyId).catch(() => []),
      ]);
      setRules(rls);
      setProducts(prods);
    } catch (err) {
      toast({ title: 'Erro ao carregar regras', description: err?.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [companyId]);

  const toggleRequire = (id) => {
    setSelectedRequires((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleCreate = async () => {
    if (!dependentId) { toast({ title: 'Escolha o produto com restrição', variant: 'destructive' }); return; }
    if (selectedRequires.length === 0) { toast({ title: 'Escolha ao menos um produto exigido', variant: 'destructive' }); return; }
    setBusy(true);
    try {
      for (const reqId of selectedRequires) {
        try {
          await createDependency(supabase, companyId, dependentId, reqId);
        } catch (err) {
          if (!/já existe/i.test(err?.message || '')) throw err;
        }
      }
      toast({ title: 'Regra salva!' });
      setDependentId('');
      setSelectedRequires([]);
      await load();
    } catch (err) {
      toast({ title: 'Erro ao salvar', description: err?.message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const handleToggle = async (rule) => {
    try {
      await setDependencyActive(supabase, rule.id, !(rule.active !== false));
      await load();
    } catch (err) {
      toast({ title: 'Erro ao alterar', description: err?.message, variant: 'destructive' });
    }
  };

  const handleDelete = async (rule) => {
    const dep = rule.product_name || 'este produto';
    if (!window.confirm(`Remover a exigência de "${dep}"? Pedidos voltam a aceitar o item sozinho.`)) return;
    try {
      await deleteDependency(supabase, rule.id);
      toast({ title: 'Regra removida!' });
      await load();
    } catch (err) {
      toast({ title: 'Erro ao remover', description: err?.message, variant: 'destructive' });
    }
  };

  const q = search.trim().toLowerCase();
  const pool = useMemo(() => (products || [])
    .filter((p) => p.id !== dependentId && (!q || (p.name || '').toLowerCase().includes(q)))
    .slice(0, 12), [products, dependentId, q]);

  const grouped = useMemo(() => {
    const map = new Map();
    for (const r of rules) {
      if (!map.has(r.product_id)) map.set(r.product_id, { product_id: r.product_id, name: r.product_name || 'Produto', items: [] });
      map.get(r.product_id).items.push(r);
    }
    return [...map.values()];
  }, [rules]);

  const modeOf = (productId) =>
    (products || []).find((p) => p.id === productId)?.dependency_mode === 'all' ? 'all' : 'any';

  // Modo da regra do produto: 'any' (basta um exigido) ou 'all' (todos
  // exigidos — combos com componentes obrigatórios). Servidor revalida.
  const handleMode = async (productId, mode) => {
    try {
      await sbUpdateProduct(supabase, companyId, productId, { dependency_mode: mode });
      setProducts((prev) => (prev || []).map((p) => (p.id === productId ? { ...p, dependency_mode: mode } : p)));
      toast({ title: mode === 'all' ? 'Exige todos os itens!' : 'Basta um dos itens!' });
    } catch (err) {
      toast({ title: 'Erro ao alterar modo', description: err?.message, variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Ex.: batata frita exige um lanche ou combo no mesmo pedido. Sem regra, o produto vende sozinho normalmente.
      </p>

      <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <h3 className="font-heading font-semibold text-sm">Nova regra</h3>
        <div className="space-y-1.5">
          <Label>Produto com restrição</Label>
          <Select value={dependentId || 'none'} onValueChange={(v) => { setDependentId(v === 'none' ? '' : v); setSelectedRequires([]); }}>
            <SelectTrigger><SelectValue placeholder="Ex.: Batata frita" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Selecione...</SelectItem>
              {(products || []).map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {dependentId && (
          <div className="space-y-2">
            <Label>Exige ao menos um destes no pedido</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar produto..." className="pl-9 h-9 text-sm" />
            </div>
            {pool.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhum outro produto encontrado.</p>
            ) : (
              <div className="max-h-44 overflow-y-auto rounded-xl border border-border divide-y divide-border">
                {pool.map((p) => {
                  const on = selectedRequires.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => toggleRequire(p.id)}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-muted"
                      aria-pressed={on}
                    >
                      <span
                        aria-hidden
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] font-bold ${on ? 'bg-primary border-primary text-primary-foreground' : 'border-primary/40 bg-transparent'}`}
                      >
                        {on ? '✓' : ''}
                      </span>
                      <span className="truncate">{p.name}</span>
                    </button>
                  );
                })}
              </div>
            )}
            <Button onClick={handleCreate} disabled={busy || selectedRequires.length === 0} className="w-full min-h-11">
              <Plus className="h-4 w-4" /> {busy ? 'Salvando...' : `Criar regra (${selectedRequires.length})`}
            </Button>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="font-heading font-semibold text-sm">Regras configuradas ({rules.length})</h3>
        {loading ? (
          <p className="text-sm text-muted-foreground text-center py-6">Carregando...</p>
        ) : grouped.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">Nenhuma regra — todos os produtos vendem sozinhos.</p>
        ) : grouped.map((g) => (
          <div key={g.product_id} className="rounded-xl border border-border bg-card p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium min-w-0 flex-1">
                {g.name} <span className="text-muted-foreground font-normal">exige</span>{' '}
                {g.items.filter((r) => r.active !== false).map((r) => r.requires_name || '?').join(modeOf(g.product_id) === 'all' ? ', ' : ' ou ') || '—'}
              </p>
              <Select value={modeOf(g.product_id)} onValueChange={(v) => handleMode(g.product_id, v)}>
                <SelectTrigger className="h-7 w-32 shrink-0 text-[11px]" aria-label="Modo da regra">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Qualquer um</SelectItem>
                  <SelectItem value="all">Todos</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="mt-2 space-y-1.5">
              {g.items.map((r) => (
                <div key={r.id} className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${r.active === false ? 'opacity-60 border-border' : 'border-border'}`}>
                  <span className="flex-1 truncate">
                    {(r.requires_name || '?')}
                    {r.active === false && <span className="ml-1.5 text-muted-foreground">(inativa)</span>}
                  </span>
                  <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => handleToggle(r)}>
                    {r.active !== false ? 'Inativar' : 'Ativar'}
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => handleDelete(r)} aria-label="Remover regra">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
