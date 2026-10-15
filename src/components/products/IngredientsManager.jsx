import React, { useState, useEffect } from 'react';
import { supabase } from '@/api/supabaseClient';
import {
  listIngredients, createIngredient, updateIngredient, deleteIngredient,
} from '@/api/configurator';
import { uploadImage as sbUploadImage } from '@/api/storage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/use-toast';
import { Image } from '@/components/ui/image';
import { Plus, Pencil, Trash2, Search, X, Upload, Loader2, Copy, LayoutGrid, List } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import BulkActionsBar from '@/components/products/BulkActionsBar';
import { INGREDIENT_SECTIONS, buildIngredientDuplicate, sectionOf } from '@/lib/ingredientSections';
import { getViewMode, setViewMode as persistViewMode } from '@/lib/viewPrefs';
import { toggleSelected, toggleAllVisible, pruneSelected, runBulk } from '@/lib/bulkSelect';

// Biblioteca de ingredientes reutilizáveis (sem preço aqui: o adicional é
// definido por associação em cada grupo). RLS: escrita OWNER/ADMIN/MANAGER.
export default function IngredientsManager({ companyId, viewKey = 'complementos' }) {
  const { toast } = useToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', description: '', image_url: '', sort_order: 0, active: true, category: '' });
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [viewMode, setViewModeState] = useState(() => getViewMode(viewKey));
  const setViewMode = (v) => { setViewModeState(v); persistViewMode(viewKey, v); };
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkBusy, setBulkBusy] = useState(false);

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
    setForm({ name: '', description: '', image_url: '', sort_order: items.length, active: true, category: '' });
  };

  const openEdit = (ing) => {
    setEditing(ing);
    setForm({
      name: ing.name || '', description: ing.description || '', image_url: ing.image_url || '',
      sort_order: ing.sort_order ?? 0, active: ing.active !== false, category: sectionOf(ing),
    });
  };

  // Foto opcional no bucket catalog (pasta da empresa); preço segue por
  // associação (opção do grupo), sem corromper a biblioteca.
  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: 'Imagem maior que 5MB', variant: 'destructive' });
      e.target.value = '';
      return;
    }
    setUploading(true);
    try {
      if (!companyId) throw new Error('Empresa não identificada');
      const { file_url } = await sbUploadImage(supabase, 'catalog', companyId, file);
      setForm((p) => ({ ...p, image_url: file_url }));
    } catch (err) {
      toast({ title: 'Erro no upload', description: err?.message, variant: 'destructive' });
    } finally {
      setUploading(false);
      e.target.value = '';
    }
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
      setForm({ name: '', description: '', image_url: '', sort_order: 0, active: true, category: '' });
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

  // Duplica na biblioteca com novo id, sem levar associações; abre para revisão.
  const handleDuplicate = async (ing) => {
    if (!ing?.id || busy) return;
    setBusy(true);
    try {
      const created = await createIngredient(supabase, companyId, buildIngredientDuplicate(ing));
      toast({ title: 'Ingrediente duplicado (inativo para revisão)!' });
      await load();
      openEdit({ ...buildIngredientDuplicate(ing), id: created.id });
    } catch (err) {
      toast({ title: 'Erro ao duplicar', description: err?.message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  // Reconcilia a seleção quando registros somem.
  useEffect(() => {
    setSelectedIds((prev) => pruneSelected(prev, items.map((i) => i.id)));
  }, [items]);

  const summarizeBulk = (label, ok, fail) => {
    if (fail.length === 0) toast({ title: `${ok.length} ${label} com sucesso!` });
    else {
      toast({
        title: `${ok.length} ok, ${fail.length} falharam`,
        description: fail.slice(0, 3).map((f) => f.error).join(' • '),
        variant: 'destructive',
      });
    }
  };

  const bulkSetActive = async (ids, active) => {
    if (!ids.length || bulkBusy) return;
    setBulkBusy(true);
    const targets = items.filter((i) => ids.includes(i.id));
    const { ok, fail } = await runBulk(targets, (ing) =>
      updateIngredient(supabase, ing.id, { active }),
    );
    if (ok.length > 0) {
      const okSet = new Set(ok);
      setItems((prev) => prev.map((i) => (okSet.has(i.id) ? { ...i, active } : i)));
      setSelectedIds((prev) => prev.filter((id) => !okSet.has(id)));
    }
    setBulkBusy(false);
    summarizeBulk(active ? 'ativados' : 'inativados', ok, fail);
  };

  const bulkDelete = async (ids) => {
    if (!ids.length || bulkBusy) return;
    if (!window.confirm(`Excluir ${ids.length} ${ids.length === 1 ? 'ingrediente' : 'ingredientes'}? Só possível se não estiverem em uso.`)) return;
    setBulkBusy(true);
    const targets = items.filter((i) => ids.includes(i.id));
    const { ok, fail } = await runBulk(targets, (ing) => deleteIngredient(supabase, ing.id));
    if (ok.length > 0) {
      const okSet = new Set(ok);
      setItems((prev) => prev.filter((i) => !okSet.has(i.id)));
      setSelectedIds((prev) => prev.filter((id) => !okSet.has(id)));
    }
    setBulkBusy(false);
    summarizeBulk('excluídos', ok, fail);
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
            <Button variant="ghost" size="sm" onClick={() => { setEditing(null); setForm({ name: '', description: '', image_url: '', sort_order: 0, active: true, category: '' }); }} aria-label="Limpar formulário">
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
          <div className="flex items-center gap-3">
            {form.image_url ? (
              <div className="relative shrink-0">
                <div className="h-14 w-14 rounded-lg overflow-hidden bg-muted border border-border">
                  <Image src={form.image_url} fittingType="fill" className="h-full w-full" alt="Preview" />
                </div>
                <button
                  type="button"
                  onClick={() => setForm((p) => ({ ...p, image_url: '' }))}
                  aria-label="Remover foto"
                  className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border-2 border-dashed border-border bg-muted text-xl">
                🧂
              </div>
            )}
            <div className="min-w-0">
              <Label htmlFor="ingredient-image" className="cursor-pointer inline-block">
                <span className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-muted transition-colors">
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  {uploading ? 'Enviando...' : form.image_url ? 'Alterar foto' : 'Foto (opcional)'}
                </span>
              </Label>
              <Input id="ingredient-image" type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleUpload} disabled={uploading} />
            </div>
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
            <Label>Seção (para organizar por categoria)</Label>
            <Select value={form.category || '__none'} onValueChange={(v) => setForm((p) => ({ ...p, category: v === '__none' ? '' : v }))}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Outros" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">Outros</SelectItem>
                {INGREDIENT_SECTIONS.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
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

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {visible.length} {visible.length === 1 ? 'ingrediente' : 'ingredientes'}
        </p>
        <div className="flex gap-1.5">
          <button onClick={() => setViewMode('cards')} aria-pressed={viewMode === 'cards'} title="Modo cards" className={`flex items-center gap-1.5 rounded-full px-3 h-8 text-xs font-medium transition-colors border ${viewMode === 'cards' ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted text-muted-foreground border-transparent hover:bg-muted/70'}`}>
            <LayoutGrid className="h-3.5 w-3.5" /> Cards
          </button>
          <button onClick={() => setViewMode('lista')} aria-pressed={viewMode === 'lista'} title="Modo lista" className={`flex items-center gap-1.5 rounded-full px-3 h-8 text-xs font-medium transition-colors border ${viewMode === 'lista' ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted text-muted-foreground border-transparent hover:bg-muted/70'}`}>
            <List className="h-3.5 w-3.5" /> Lista
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground text-center py-8">Carregando...</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          {items.length === 0 ? 'Nenhum ingrediente cadastrado. Crie o primeiro acima.' : 'Nenhum ingrediente encontrado.'}
        </p>
      ) : viewMode === 'lista' ? (
        <>
        <BulkActionsBar
          count={selectedIds.length}
          entityLabel="ingredientes"
          busy={bulkBusy}
          onActivate={() => bulkSetActive(selectedIds, true)}
          onDeactivate={() => bulkSetActive(selectedIds, false)}
          onDelete={() => bulkDelete(selectedIds)}
          onClear={() => setSelectedIds([])}
        />
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[620px] text-sm">
            <thead>
              <tr className="bg-muted/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2 w-10">
                  <Checkbox
                    checked={(() => {
                      const ids = visible.map((i) => i.id);
                      if (ids.length > 0 && ids.every((id) => selectedIds.includes(id))) return true;
                      if (ids.some((id) => selectedIds.includes(id))) return 'indeterminate';
                      return false;
                    })()}
                    onCheckedChange={(v) => setSelectedIds((prev) => toggleAllVisible(prev, visible.map((i) => i.id), !!v))}
                    aria-label="Selecionar ingredientes visíveis"
                    className="shrink-0"
                  />
                </th>
                <th className="px-3 py-2 font-semibold">Ingrediente</th>
                <th className="px-3 py-2 font-semibold">Seção</th>
                <th className="px-3 py-2 font-semibold text-center">Ativo</th>
                <th className="px-3 py-2 font-semibold text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visible.map((ing) => (
                <tr key={ing.id} className="align-middle hover:bg-muted/30">
                  <td className="px-3 py-2">
                    <Checkbox
                      checked={selectedIds.includes(ing.id)}
                      onCheckedChange={() => setSelectedIds((prev) => toggleSelected(prev, ing.id))}
                      aria-label={`Selecionar ${ing.name}`}
                      className="shrink-0"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {ing.image_url ? (
                        <div className="h-8 w-8 shrink-0 rounded-lg overflow-hidden bg-muted border border-border">
                          <Image src={ing.image_url} fittingType="fill" className="h-full w-full" alt={ing.name} />
                        </div>
                      ) : null}
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{ing.name}</p>
                        {ing.description && <p className="text-xs text-muted-foreground truncate">{ing.description}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span className="text-xs text-muted-foreground">
                      {(INGREDIENT_SECTIONS.find((s) => s.id === sectionOf(ing)) || { label: 'Outros' }).label}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <Switch checked={ing.active !== false} onCheckedChange={() => handleToggle(ing)} aria-label={ing.active !== false ? 'Inativar' : 'Ativar'} />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => openEdit(ing)}>
                        <Pencil className="h-3.5 w-3.5" /> Editar
                      </Button>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0" onClick={() => handleDuplicate(ing)} aria-label={`Duplicar ${ing.name}`} title="Duplicar ingrediente">
                        <Copy className="h-4 w-4 text-muted-foreground" />
                      </Button>
                      <Button variant="ghost" size="sm" className="shrink-0 text-destructive" onClick={() => handleDelete(ing)} aria-label={`Excluir ${ing.name}`}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {visible.map((ing) => (
            <div key={ing.id} className={`rounded-xl border border-border bg-card p-3 ${ing.active === false ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 flex-1 items-center gap-2.5">
                  {ing.image_url ? (
                    <div className="h-10 w-10 shrink-0 rounded-lg overflow-hidden bg-muted border border-border">
                      <Image src={ing.image_url} fittingType="fill" className="h-full w-full" alt={ing.name} />
                    </div>
                  ) : null}
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{ing.name}</p>
                    {ing.description && <p className="text-xs text-muted-foreground truncate">{ing.description}</p>}
                  </div>
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
                <Button variant="ghost" size="sm" className="shrink-0" onClick={() => handleDuplicate(ing)} aria-label={`Duplicar ${ing.name}`} title="Duplicar ingrediente">
                  <Copy className="h-4 w-4 text-muted-foreground" />
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
