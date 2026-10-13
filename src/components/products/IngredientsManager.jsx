import React, { useState, useEffect } from 'react';
import { supabase } from '@/api/supabaseClient';
import {
  listIngredients, createIngredient, updateIngredient, deleteIngredient,
} from '@/api/configurator';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/use-toast';
import { Plus, Pencil, Trash2, Search, X } from 'lucide-react';

// Biblioteca de ingredientes reutilizáveis (sem preço aqui: o adicional é
// definido por associação em cada grupo). RLS: escrita OWNER/ADMIN/MANAGER.
export default function IngredientsManager({ companyId }) {
  const { toast } = useToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', description: '', sort_order: 0, active: true });
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      setItems(await listIngredients(supabase, companyId));
    } catch (err) {
      toast({ title: 'Erro ao carregar ingredientes', description: err?.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [companyId]);

  const openNew = () => {
    setEditing(null);
    setForm({ name: '', description: '', sort_order: items.length, active: true });
  };

  const openEdit = (ing) => {
    setEditing(ing);
    setForm({
      name: ing.name || '', description: ing.description || '',
      sort_order: ing.sort_order ?? 0, active: ing.active !== false,
    });
  };

  const handleSave = async () => {
    setBusy(true);
    try {
      if (editing) {
        await updateIngredient(supabase, editing.id, form);
        toast({ title: 'Ingrediente atualizado!' });
      } else {
        await createIngredient(supabase, companyId, form);
        toast({ title: 'Ingrediente criado!' });
      }
      setEditing(null);
      setForm({ name: '', description: '', sort_order: 0, active: true });
      await load();
    } catch (err) {
      toast({ title: 'Erro ao salvar', description: err?.message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const handleToggle = async (ing) => {
    try {
      await updateIngredient(supabase, ing.id, { active: !(ing.active !== false) });
      await load();
    } catch (err) {
      toast({ title: 'Erro ao alterar', description: err?.message, variant: 'destructive' });
    }
  };

  const handleDelete = async (ing) => {
    if (!window.confirm(`Excluir "${ing.name}" da biblioteca? (Só possível se não estiver em uso.)`)) return;
    try {
      await deleteIngredient(supabase, ing.id);
      toast({ title: 'Ingrediente excluído!' });
      await load();
    } catch (err) {
      toast({ title: 'Exclusão bloqueada', description: err?.message, variant: 'destructive' });
    }
  };

  const q = search.trim().toLowerCase();
  const visible = items.filter((i) => !q || (i.name || '').toLowerCase().includes(q));

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar ingrediente..." className="pl-9 h-9 text-sm" />
        </div>
        <Button onClick={openNew} className="shrink-0 h-9">
          <Plus className="h-4 w-4" /> Novo ingrediente
        </Button>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-heading font-semibold text-sm">{editing ? 'Editar ingrediente' : 'Novo ingrediente'}</h3>
          {(editing || form.name) && (
            <Button variant="ghost" size="sm" onClick={() => { setEditing(null); setForm({ name: '', description: '', sort_order: 0, active: true }); }} aria-label="Limpar formulário">
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Nome *</Label>
              <Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="Ex.: Bacon extra" maxLength={80} />
            </div>
            <div className="space-y-1.5">
              <Label>Ordem</Label>
              <Input type="number" min={0} value={form.sort_order} onChange={(e) => setForm((p) => ({ ...p, sort_order: e.target.value }))} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Descrição (opcional)</Label>
            <Textarea value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} rows={2} placeholder="Ex.: fatias crocantes" />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
            <Label>Ativo</Label>
            <Switch checked={form.active !== false} onCheckedChange={(v) => setForm((p) => ({ ...p, active: v }))} />
          </div>
          <Button onClick={handleSave} disabled={busy} className="w-full min-h-11">
            {busy ? 'Salvando...' : (editing ? 'Salvar alterações' : 'Criar ingrediente')}
          </Button>
        </div>

      {loading ? (
        <p className="text-sm text-muted-foreground text-center py-8">Carregando...</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          {items.length === 0 ? 'Nenhum ingrediente cadastrado. Crie o primeiro acima.' : 'Nenhum ingrediente encontrado.'}
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {visible.map((ing) => (
            <div key={ing.id} className={`rounded-xl border border-border bg-card p-3 ${ing.active === false ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">{ing.name}</p>
                  {ing.description && <p className="text-xs text-muted-foreground truncate">{ing.description}</p>}
                </div>
                <span className={`shrink-0 text-[11px] font-medium ${ing.active !== false ? 'text-green-700' : 'text-muted-foreground'}`}>
                  {ing.active !== false ? 'Ativo' : 'Inativo'}
                </span>
              </div>
              <div className="flex items-center gap-1.5 mt-2">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => openEdit(ing)}>
                  <Pencil className="h-3.5 w-3.5" /> Editar
                </Button>
                <Button variant="outline" size="sm" className="flex-1" onClick={() => handleToggle(ing)}>
                  {ing.active !== false ? 'Inativar' : 'Ativar'}
                </Button>
                <Button variant="ghost" size="sm" className="shrink-0 text-destructive" onClick={() => handleDelete(ing)} aria-label={`Excluir ${ing.name}`}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
