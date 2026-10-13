import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/api/supabaseClient';
import {
  listSteps, createStep, updateStep, deleteStep, moveStep,
  listOptions, createOption, updateOption, deleteOption,
  listIngredients,
} from '@/api/configurator';
import { validateConfigStep, validateConfigOption } from '@/lib/configEditor';
import { listProducts as sbListProducts } from '@/api/catalog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/use-toast';
import { Plus, Pencil, Trash2, ChevronUp, ChevronDown, X, Check } from 'lucide-react';

// Montagem V2 por produto: grupos (steps) + opções associadas por seleção
// (ingrediente ou produto existente — sem redigitar, sem duplicar).
// Não toca em pedidos, RPCs ou legado products.options.
export default function ConfigStepsEditor({ companyId, productId, products = [] }) {
  const { toast } = useToast();
  const [steps, setSteps] = useState([]);
  const [optionsByStep, setOptionsByStep] = useState({});
  const [expanded, setExpanded] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editingStep, setEditingStep] = useState(null);
  const [stepForm, setStepForm] = useState(null);
  const [ingredients, setIngredients] = useState([]);
  const [companyProducts, setCompanyProducts] = useState(null);
  const [assocMode, setAssocMode] = useState('ingredient');
  const [assocQuery, setAssocQuery] = useState('');
  const [assocDraft, setAssocDraft] = useState(null);
  const [editingOption, setEditingOption] = useState(null);
  const [optionForm, setOptionForm] = useState(null);

  const load = async () => {
    if (!companyId || !productId) return;
    setLoading(true);
    try {
      const [st, ings] = await Promise.all([
        listSteps(supabase, companyId, productId),
        listIngredients(supabase, companyId).catch(() => []),
      ]);
      setSteps(st);
      setIngredients(ings);
      const map = {};
      for (const s of st) {
        try {
          map[s.id] = await listOptions(supabase, s.id);
        } catch {
          map[s.id] = [];
        }
      }
      setOptionsByStep(map);
      if (st.length > 0 && !expanded) setExpanded(st[0].id);
    } catch (err) {
      toast({ title: 'Erro ao carregar montagem', description: err?.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [companyId, productId]);

  const refreshOptions = async (stepId) => {
    try {
      const list = await listOptions(supabase, stepId);
      setOptionsByStep((prev) => ({ ...prev, [stepId]: list }));
    } catch (err) {
      toast({ title: 'Erro ao carregar opções', description: err?.message, variant: 'destructive' });
    }
  };

  const openNewStep = () => {
    setEditingStep(null);
    setStepForm({ title: '', description: '', select_mode: 'multi', min_select: 0, max_select: 1, free_qty: 0, required: false, active: true });
  };

  const openEditStep = (s) => {
    setEditingStep(s);
    setStepForm({
      title: s.title || '', description: s.description || '', select_mode: s.select_mode || 'multi',
      min_select: s.min_select ?? 0, max_select: s.max_select ?? 1, free_qty: s.free_qty ?? 0,
      required: !!s.required, active: s.active !== false,
    });
  };

  const handleSaveStep = async () => {
    const err = validateConfigStep(stepForm || {});
    if (err) { toast({ title: err, variant: 'destructive' }); return; }
    setBusy(true);
    try {
      if (editingStep) await updateStep(supabase, editingStep.id, stepForm);
      else await createStep(supabase, companyId, productId, stepForm);
      toast({ title: editingStep ? 'Grupo atualizado!' : 'Grupo criado!' });
      setEditingStep(null);
      setStepForm(null);
      await load();
    } catch (e) {
      toast({ title: 'Erro ao salvar grupo', description: e?.message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteStep = async (s) => {
    const n = (optionsByStep[s.id] || []).length;
    if (!window.confirm(`Excluir o grupo "${s.title}"${n > 0 ? ` e suas ${n} opção(ões)` : ''}? Pedidos antigos usam snapshot e não são afetados.`)) return;
    try {
      await deleteStep(supabase, s.id);
      toast({ title: 'Grupo excluído!' });
      await load();
    } catch (err) {
      toast({ title: 'Erro ao excluir', description: err?.message, variant: 'destructive' });
    }
  };

  const handleMoveStep = async (s, dir) => {
    try {
      if (await moveStep(supabase, s.id, dir)) await load();
    } catch (err) {
      toast({ title: 'Erro ao reordenar', description: err?.message, variant: 'destructive' });
    }
  };

  const handleToggleStep = async (s) => {
    try {
      await updateStep(supabase, s.id, { active: !(s.active !== false) });
      await load();
    } catch (err) {
      toast({ title: 'Erro ao alterar', description: err?.message, variant: 'destructive' });
    }
  };

  // Associação: origem por seleção (ingrediente ou produto da empresa,
  // exceto o próprio produto). Lista de produtos carrega sob demanda.
  const assocPool = useMemo(() => {
    const q = assocQuery.trim().toLowerCase();
    if (assocMode === 'ingredient') {
      return ingredients
        .filter((i) => i.active !== false && (!q || (i.name || '').toLowerCase().includes(q)))
        .slice(0, 8)
        .map((i) => ({ kind: 'ingredient', id: i.id, name: i.name, hint: i.description || '' }));
    }
    const list = companyProducts || products || [];
    return list
      .filter((p) => p.id !== productId && (!q || (p.name || '').toLowerCase().includes(q)))
      .slice(0, 8)
      .map((p) => ({ kind: 'product', id: p.id, name: p.name, hint: '' }));
  }, [assocMode, assocQuery, ingredients, companyProducts, products, productId]);

  const switchAssocMode = async (mode) => {
    setAssocMode(mode);
    setAssocQuery('');
    if (mode === 'product' && companyProducts === null && (products || []).length === 0) {
      try {
        setCompanyProducts(await sbListProducts(supabase, companyId));
      } catch {
        setCompanyProducts([]);
      }
    }
  };

  const startAssoc = (stepId, entry) => {
    setAssocDraft({
      step_id: stepId,
      ingredient_id: entry.kind === 'ingredient' ? entry.id : null,
      product_id: entry.kind === 'product' ? entry.id : null,
      name: entry.name || '', description: '', price: 0, active: true, sort_order: 0,
    });
    setEditingOption(null);
    setOptionForm(null);
  };

  const openEditOption = (opt) => {
    setEditingOption(opt);
    setOptionForm({
      name: opt.name || '', description: opt.description || '',
      price: opt.price ?? 0, active: opt.active !== false, sort_order: opt.sort_order ?? 0,
    });
    setAssocDraft(null);
  };

  const handleSaveOption = async (isEdit) => {
    const data = isEdit ? { ...optionForm } : { ...assocDraft };
    const err = validateConfigOption(data);
    if (err) { toast({ title: err, variant: 'destructive' }); return; }
    setBusy(true);
    try {
      if (isEdit) await updateOption(supabase, editingOption.id, data);
      else await createOption(supabase, data);
      toast({ title: isEdit ? 'Opção atualizada!' : 'Opção associada!' });
      setAssocDraft(null);
      setEditingOption(null);
      setOptionForm(null);
      await refreshOptions(data.step_id || editingOption?.step_id);
    } catch (e) {
      toast({ title: 'Erro ao salvar opção', description: e?.message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteOption = async (stepId, opt) => {
    if (!window.confirm(`Remover "${opt.name}" deste grupo? (Histórico de pedidos preservado.)`)) return;
    try {
      await deleteOption(supabase, opt.id);
      toast({ title: 'Opção removida!' });
      await refreshOptions(stepId);
    } catch (err) {
      toast({ title: 'Erro ao remover', description: err?.message, variant: 'destructive' });
    }
  };

  const handleToggleOption = async (stepId, opt) => {
    try {
      await updateOption(supabase, opt.id, { active: !(opt.active !== false) });
      await refreshOptions(stepId);
    } catch (err) {
      toast({ title: 'Erro ao alterar', description: err?.message, variant: 'destructive' });
    }
  };

  if (loading) return <p className="text-sm text-muted-foreground text-center py-6">Carregando montagem...</p>;

  return (
    <div className="space-y-3">
      {steps.length === 0 && !stepForm && (
        <p className="text-xs text-muted-foreground">Nenhum grupo ainda. Crie o primeiro abaixo (ex.: Tamanhos, Molhos).</p>
      )}
      {steps.map((s, idx) => {
        const opts = optionsByStep[s.id] || [];
        const isOpen = expanded === s.id;
        return (
          <div key={s.id} className={`rounded-xl border ${s.active === false ? 'opacity-60' : 'border-border'} bg-background`}>
            <div className="flex items-center gap-1.5 px-2.5 py-1.5">
              {/* Seleção do grupo: ativa/inativa sem duplicar nem excluir. */}
              <Checkbox
                checked={s.active !== false}
                onCheckedChange={() => handleToggleStep(s)}
                aria-label={s.active !== false ? `Inativar grupo ${s.title}` : `Ativar grupo ${s.title}`}
                className="shrink-0"
              />
              <button type="button" onClick={() => setExpanded(isOpen ? null : s.id)} className="flex flex-1 min-w-0 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg" aria-expanded={isOpen}>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium truncate">
                    {s.title}
                    {s.required && <span className="ml-1.5 text-[10px] font-bold text-primary">obrigatório</span>}
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    {s.select_mode === 'single' ? 'única escolha' : `até ${s.max_select}`} • mín {s.min_select}
                    {s.free_qty > 0 ? ` • ${s.free_qty} grátis` : ''} • {opts.length} {opts.length === 1 ? 'opção' : 'opções'}
                  </span>
                </span>
                {isOpen ? <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />}
              </button>
              <div className="flex shrink-0 items-center gap-1">
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => handleMoveStep(s, -1)} disabled={idx === 0} aria-label="Subir grupo">↑</Button>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => handleMoveStep(s, +1)} disabled={idx === steps.length - 1} aria-label="Descer grupo">↓</Button>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => openEditStep(s)} aria-label="Editar grupo"><Pencil className="h-3.5 w-3.5" /></Button>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive" onClick={() => handleDeleteStep(s)} aria-label="Excluir grupo"><Trash2 className="h-4 w-4" /></Button>
              </div>
            </div>
            {isOpen && (
              <div className="border-t border-border px-3 py-3 space-y-2">
                <p className="text-xs text-muted-foreground">Opções do grupo (preço = adicional)</p>
                {opts.length === 0 && <p className="text-xs text-muted-foreground">Sem opções — associe abaixo.</p>}
                {opts.map((o) => (
                  <div key={o.id} className={`rounded-lg border border-border px-2.5 py-2 ${o.active === false ? 'opacity-60' : ''}`}>
                    {editingOption?.id === o.id ? (
                      <div className="space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <Label>Nome</Label>
                            <Input value={optionForm.name} onChange={(e) => setOptionForm((p) => ({ ...p, name: e.target.value }))} className="h-9 text-sm" />
                          </div>
                          <div className="space-y-1">
                            <Label>Adicional (R$)</Label>
                            <Input type="number" min={0} step="0.01" value={optionForm.price} onChange={(e) => setOptionForm((p) => ({ ...p, price: e.target.value }))} className="h-9 text-sm" />
                          </div>
                        </div>
                        <div className="space-y-1">
                          <Label>Descrição</Label>
                          <Input value={optionForm.description} onChange={(e) => setOptionForm((p) => ({ ...p, description: e.target.value }))} className="h-9 text-sm" />
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" className="flex-1" onClick={() => handleSaveOption(true)} disabled={busy}>
                            <Check className="h-4 w-4" /> Salvar
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => { setEditingOption(null); setOptionForm(null); }}><X className="h-4 w-4" /></Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{o.name} <span className="text-muted-foreground font-normal">+R$ {Number(o.price || 0).toFixed(2)}</span></p>
                          {o.description && <p className="text-[11px] text-muted-foreground truncate">{o.description}</p>}
                        </div>
                        {/* Seleção da opção: reutiliza o cadastro, sem duplicar. */}
                        <Checkbox
                          checked={o.active !== false}
                          onCheckedChange={() => handleToggleOption(s.id, o)}
                          aria-label={o.active !== false ? `Inativar ${o.name}` : `Ativar ${o.name}`}
                          className="shrink-0"
                        />
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0" onClick={() => openEditOption(o)} aria-label="Editar opção"><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0 text-destructive" onClick={() => handleDeleteOption(s.id, o)} aria-label="Remover opção"><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    )}
                  </div>
                ))}
                {/* Associar existente */}
                {!assocDraft || assocDraft.step_id !== s.id ? (
                  <div className="space-y-2 rounded-lg bg-muted/40 p-2.5">
                    <div className="flex gap-1.5">
                      <Button variant={assocMode === 'ingredient' ? 'default' : 'outline'} size="sm" className="flex-1 h-8 text-xs" onClick={() => switchAssocMode('ingredient')}>Ingrediente</Button>
                      <Button variant={assocMode === 'product' ? 'default' : 'outline'} size="sm" className="flex-1 h-8 text-xs" onClick={() => switchAssocMode('product')}>Produto</Button>
                    </div>
                    <Input value={assocQuery} onChange={(e) => setAssocQuery(e.target.value)} placeholder={assocMode === 'ingredient' ? 'Buscar ingrediente...' : 'Buscar produto...'} className="h-9 text-sm" />
                    {assocPool.length === 0 ? (
                      <p className="text-[11px] text-muted-foreground">
                        {assocMode === 'ingredient' ? 'Nenhum ingrediente ativo — cadastre na aba Complementos.' : 'Nenhum produto encontrado.'}
                      </p>
                    ) : (
                      <div className="max-h-36 overflow-y-auto rounded-lg border border-border divide-y divide-border bg-background">
                        {assocPool.map((entry) => (
                          <button key={`${entry.kind}:${entry.id}`} type="button" onClick={() => startAssoc(s.id, entry)}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-muted">
                            {entry.name}
                            {entry.hint && <span className="text-muted-foreground"> • {entry.hint}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2 rounded-lg bg-muted/40 p-2.5">
                    <p className="text-xs font-medium">Associar: {assocDraft.name}</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label>Nome exibido</Label>
                        <Input value={assocDraft.name} onChange={(e) => setAssocDraft((p) => ({ ...p, name: e.target.value }))} className="h-9 text-sm" />
                      </div>
                      <div className="space-y-1">
                        <Label>Adicional (R$)</Label>
                        <Input type="number" min={0} step="0.01" value={assocDraft.price} onChange={(e) => setAssocDraft((p) => ({ ...p, price: e.target.value }))} className="h-9 text-sm" />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label>Descrição</Label>
                      <Input value={assocDraft.description} onChange={(e) => setAssocDraft((p) => ({ ...p, description: e.target.value }))} className="h-9 text-sm" />
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" className="flex-1" onClick={() => handleSaveOption(false)} disabled={busy}>
                        <Check className="h-4 w-4" /> Associar
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setAssocDraft(null)}><X className="h-4 w-4" /></Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Novo/editar grupo */}
      {!stepForm ? (
        <Button variant="outline" className="w-full min-h-11" onClick={openNewStep}>
          <Plus className="h-4 w-4" /> Novo grupo
        </Button>
      ) : (
        <div className="rounded-xl border border-border bg-muted/30 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold">{editingStep ? 'Editar grupo' : 'Novo grupo'}</h4>
            <Button variant="ghost" size="sm" onClick={() => { setEditingStep(null); setStepForm(null); }}><X className="h-4 w-4" /></Button>
          </div>
          <div className="space-y-1.5">
            <Label>Título *</Label>
            <Input value={stepForm.title} onChange={(e) => setStepForm((p) => ({ ...p, title: e.target.value }))} placeholder="Ex.: Escolha o molho" className="h-9 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label>Descrição</Label>
            <Input value={stepForm.description} onChange={(e) => setStepForm((p) => ({ ...p, description: e.target.value }))} className="h-9 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label>Seleção</Label>
              <Select value={stepForm.select_mode} onValueChange={(v) => setStepForm((p) => ({ ...p, select_mode: v, max_select: v === 'single' ? 1 : p.max_select }))}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="multi">Múltipla</SelectItem>
                  <SelectItem value="single">Única</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Máximo</Label>
              <Input type="number" min={1} max={20} value={stepForm.max_select} onChange={(e) => setStepForm((p) => ({ ...p, max_select: e.target.value }))} className="h-9 text-sm" disabled={stepForm.select_mode === 'single'} />
            </div>
            <div className="space-y-1.5">
              <Label>Mínimo</Label>
              <Input type="number" min={0} value={stepForm.min_select} onChange={(e) => setStepForm((p) => ({ ...p, min_select: e.target.value }))} className="h-9 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label>Gratuitas</Label>
              <Input type="number" min={0} value={stepForm.free_qty} onChange={(e) => setStepForm((p) => ({ ...p, free_qty: e.target.value }))} className="h-9 text-sm" />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2">
            <Label className="text-sm">Obrigatório</Label>
            <Switch checked={!!stepForm.required} onCheckedChange={(v) => setStepForm((p) => ({ ...p, required: v }))} />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2">
            <Label className="text-sm">Ativo</Label>
            <Switch checked={stepForm.active !== false} onCheckedChange={(v) => setStepForm((p) => ({ ...p, active: v }))} />
          </div>
          <Button onClick={handleSaveStep} disabled={busy} className="w-full min-h-11">
            {busy ? 'Salvando...' : (editingStep ? 'Salvar grupo' : 'Criar grupo')}
          </Button>
        </div>
      )}
    </div>
  );
}
