import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/api/supabaseClient';
import {
  listSteps, createStep, updateStep, deleteStep, moveStep,
  listCategorySteps, createCategoryStep,
  listOptions, createOption, updateOption, deleteOption,
  listIngredients,
} from '@/api/configurator';
import { validateConfigStep, validateConfigOption } from '@/lib/configEditor';
import { buildDuplicateOption, neighborSwapTargets } from '@/lib/configAssembly';
import { listCategories as sbListCategories, listProducts as sbListProducts } from '@/api/catalog';
import {
  FIXED_GROUP_DEFINITIONS, usesFixedGroups, fixedGroupsForCategory,
  findFixedStep, findFixedCategory, fixedStepPayload, planFixedGroupOptions,
} from '@/lib/fixedGroups';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/use-toast';
import { Plus, Pencil, Trash2, ChevronUp, ChevronDown, ChevronRight, X, Check, Copy, ArrowUp, ArrowDown } from 'lucide-react';

// Montagem V2 por produto OU por categoria: grupos (steps) + opções
// associadas por seleção (ingrediente ou produto existente — sem
// redigitar, sem duplicar). Escopo categoria = modelo reutilizável
// herdado pelos produtos (use_category_steps); passos próprios somam.
// Não toca em pedidos, RPCs ou legado products.options.
export default function ConfigStepsEditor({ companyId, productId, categoryId, products = [], refreshKey = 0 }) {
  const { toast } = useToast();
  // Escopo efetivo: categoria quando categoryId presente, senão produto.
  const scope = categoryId ? { kind: 'category', id: categoryId } : { kind: 'product', id: productId };
  const [steps, setSteps] = useState([]);
  const [optionsByStep, setOptionsByStep] = useState({});
  const [expanded, setExpanded] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editingStep, setEditingStep] = useState(null);
  const [stepForm, setStepForm] = useState(null);
  const [ingredients, setIngredients] = useState([]);
  const [companyProducts, setCompanyProducts] = useState(null);
  const [catalogCategories, setCatalogCategories] = useState([]);
  const [catalogProducts, setCatalogProducts] = useState([]);
  const [fixedDialog, setFixedDialog] = useState(null);
  const [fixedSaving, setFixedSaving] = useState(false);
  const [assocMode, setAssocMode] = useState('ingredient');
  const [assocQuery, setAssocQuery] = useState('');
  const [assocDraft, setAssocDraft] = useState(null);
  const [editingOption, setEditingOption] = useState(null);
  const [optionForm, setOptionForm] = useState(null);
  // Busca dentro do grupo expandido (só filtra a lista associada).
  const [optQuery, setOptQuery] = useState('');

  const syncFixedGroupOptions = async (step, definition, existing, categories, products) => {
    const category = findFixedCategory(categories, definition);
    if (!step || !category) return { created: 0, updated: 0, options: existing || [] };
    const plan = planFixedGroupOptions({
      stepId: step.id,
      categoryId: category.id,
      products,
      existingOptions: existing || [],
    });
    let next = [...(existing || [])];
    for (const data of plan.creates) {
      const row = await createOption(supabase, data);
      next = [...next, row];
    }
    for (const item of plan.updates) {
      const row = await updateOption(supabase, item.id, item.patch);
      next = next.map((option) => (option.id === item.id ? { ...option, ...row } : option));
    }
    return { created: plan.creates.length, updated: plan.updates.length, options: next };
  };

  const load = async () => {
    if (!companyId || !scope.id) return;
    setLoading(true);
    try {
      const [st, ings, cats, prods] = await Promise.all([
        scope.kind === 'category'
          ? listCategorySteps(supabase, companyId, scope.id)
          : listSteps(supabase, companyId, scope.id),
        listIngredients(supabase, companyId).catch(() => []),
        scope.kind === 'category' ? sbListCategories(supabase, companyId).catch(() => []) : [],
        scope.kind === 'category' ? sbListProducts(supabase, companyId).catch(() => []) : [],
      ]);
      setSteps(st);
      setIngredients(ings);
      setCatalogCategories(cats);
      setCatalogProducts(prods);
      const map = {};
      for (const s of st) {
        try {
          map[s.id] = await listOptions(supabase, s.id);
        } catch {
          map[s.id] = [];
        }
      }
      const currentCategory = scope.kind === 'category' ? cats.find((category) => category.id === scope.id) : null;
      if (usesFixedGroups(currentCategory)) {
        for (const definition of fixedGroupsForCategory(currentCategory)) {
          const step = findFixedStep(st, definition);
          if (!step || step.active === false) continue;
          try {
            const result = await syncFixedGroupOptions(step, definition, map[step.id] || [], cats, prods);
            if (result.created > 0 || result.updated > 0) map[step.id] = result.options;
          } catch (err) {
            toast({ title: `Erro ao sincronizar ${definition.title}`, description: err?.message, variant: 'destructive' });
          }
        }
      }
      setOptionsByStep(map);
    } catch (err) {
      toast({ title: 'Erro ao carregar montagem', description: err?.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [companyId, productId, categoryId, refreshKey]);

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
    setStepForm({ title: '', description: '', select_mode: 'single', min_select: 0, max_select: 1, free_qty: 0, required: false, active: true });
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
      else if (scope.kind === 'category') await createCategoryStep(supabase, companyId, scope.id, stepForm);
      else await createStep(supabase, companyId, scope.id, stepForm);
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

  const openFixedGroup = (definition) => {
    if (scope.kind !== 'category') return;
    const category = findFixedCategory(catalogCategories, definition);
    if (!category) {
      toast({ title: `Categoria ${definition.title} não encontrada`, variant: 'destructive' });
      return;
    }
    const step = findFixedStep(steps, definition);
    const existing = step ? (optionsByStep[step.id] || []) : [];
    const existingByProduct = new Map(
      existing.filter((option) => option.product_id).map((option) => [option.product_id, option]),
    );
    const categoryProducts = catalogProducts.filter((product) => product.category_id === category.id);
    const selected = {};
    categoryProducts.forEach((product) => {
      const option = existingByProduct.get(product.id);
      selected[product.id] = option
        ? option.active !== false
        : product.available !== false && product.out_of_stock !== true;
    });
    setFixedDialog({
      definition,
      step,
      category,
      categoryProducts,
      active: step ? step.active !== false : true,
      select_mode: step?.select_mode === 'multi' ? 'multi' : 'single',
      max_select: step?.select_mode === 'multi' ? Number(step?.max_select) || 1 : 1,
      required: !!step?.required,
      selected,
    });
  };

  const handleSaveFixedGroup = async () => {
    if (!fixedDialog || fixedSaving || scope.kind !== 'category') return;
    const { definition, step, categoryProducts, selected, active, select_mode, max_select, required } = fixedDialog;
    const normalizedMax = select_mode === 'single' ? 1 : Math.max(1, Number(max_select) || 1);
    setFixedSaving(true);
    try {
      const payload = {
        active: !!active,
        select_mode,
        min_select: Number(step?.min_select) || 0,
        max_select: normalizedMax,
        free_qty: Number(step?.free_qty) || 0,
        required: !!required,
      };
      let target = step;
      if (!target) {
        target = await createCategoryStep(supabase, companyId, scope.id, { ...fixedStepPayload(definition), ...payload });
      } else {
        await updateStep(supabase, target.id, payload);
      }
      const existing = await listOptions(supabase, target.id).catch(() => []);
      const result = await syncFixedGroupOptions(target, definition, existing, catalogCategories, catalogProducts);
      const optionsByProduct = new Map(
        (result.options || existing).filter((option) => option.product_id).map((option) => [option.product_id, option]),
      );
      for (const product of categoryProducts) {
        const option = optionsByProduct.get(product.id);
        if (!option) continue;
        const wantActive = !!selected[product.id]
          && product.available !== false
          && product.out_of_stock !== true;
        if ((option.active !== false) === wantActive) continue;
        await updateOption(supabase, option.id, { active: wantActive });
      }
      toast({ title: `${definition.title} atualizado!` });
      setFixedDialog(null);
      await load();
    } catch (err) {
      toast({ title: `Erro ao salvar ${definition.title}`, description: err?.message, variant: 'destructive' });
    } finally {
      setFixedSaving(false);
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
        .map((i) => ({ kind: 'ingredient', id: i.id, name: i.name, hint: i.description || '', price: Number(i.price) || 0 }));
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
      name: entry.name || '', description: '', price: entry.kind === 'ingredient' ? (Number(entry.price) || 0) : 0, active: true, sort_order: 0,
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

  // Duplica a opção no MESMO grupo com novo id, sem levar vínculos além
  // da origem (ingredient_id XOR product_id, como na criação). A cópia
  // nasce inativa para revisão antes de ir ao ar.
  const handleDuplicateOption = async (stepId, opt, siblings) => {
    if (busy) return;
    setBusy(true);
    try {
      const { data, error } = buildDuplicateOption({ ...opt, step_id: stepId }, siblings);
      if (error) throw new Error(error);
      await createOption(supabase, data);
      toast({ title: 'Opção duplicada (inativa para revisão)!' });
      await refreshOptions(stepId);
    } catch (e) {
      toast({ title: 'Erro ao duplicar', description: e?.message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  // Reordena opções trocando sort_order com o vizinho (mesmo padrão do
  // moveStep; falha parcial só recarrega sem corromper a ordem).
  const handleMoveOption = async (stepId, siblings, index, dir) => {
    const targets = neighborSwapTargets(siblings, index, dir);
    if (busy || !targets) return;
    setBusy(true);
    try {
      for (const t of targets) {
        await updateOption(supabase, t.id, { sort_order: t.sort_order });
      }
      await refreshOptions(stepId);
    } catch (e) {
      toast({ title: 'Erro ao reordenar', description: e?.message, variant: 'destructive' });
      await refreshOptions(stepId).catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <p className="text-sm text-muted-foreground text-center py-6">Carregando montagem...</p>;

  const currentCategory = scope.kind === 'category' ? catalogCategories.find((category) => category.id === scope.id) : null;
  const showFixedGroups = usesFixedGroups(currentCategory);
  const fixedDefinitions = showFixedGroups ? fixedGroupsForCategory(currentCategory) : [];
  const fixedStepIds = new Set(
    showFixedGroups
      ? FIXED_GROUP_DEFINITIONS.map((definition) => findFixedStep(steps, definition)?.id).filter(Boolean)
      : [],
  );
  const visibleSteps = steps.filter((step) => !fixedStepIds.has(step.id));
  const fixedCheckedCount = fixedDialog
    ? fixedDialog.categoryProducts.filter(
      (product) => fixedDialog.selected[product.id]
        && product.available !== false
        && product.out_of_stock !== true,
    ).length
    : 0;

  return (
    <div className="space-y-3 min-w-0">
      {scope.kind === 'category' && (
        <p className="text-[11px] text-muted-foreground">
          Modelo da categoria: vale para os produtos que herdam os grupos. Exceções individuais no cadastro do produto.
        </p>
      )}
      {showFixedGroups && (
        <div className="rounded-xl border border-primary/25 bg-primary/5 p-2 space-y-2">
          <div>
            <p className="text-sm font-semibold">Grupos fixos</p>
            <p className="text-[11px] text-muted-foreground">
              Clique em um grupo para ativar e escolher os produtos disponíveis.
            </p>
          </div>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {fixedDefinitions.map((definition) => {
              const step = findFixedStep(steps, definition);
              const active = !!step && step.active !== false;
              const targetCategory = findFixedCategory(catalogCategories, definition);
              const options = step ? (optionsByStep[step.id] || []) : [];
              const optionCount = options.length;
              const activeCount = options.filter((option) => option.active !== false).length;
              return (
                <button
                  key={definition.slug}
                  type="button"
                  onClick={() => openFixedGroup(definition)}
                  disabled={!targetCategory}
                  className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5 text-left transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="text-base leading-none">{targetCategory?.icon || '•'}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{definition.title}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {!targetCategory
                        ? 'Categoria não encontrada'
                        : !step
                          ? 'Não configurado'
                          : `${activeCount} de ${optionCount} ativos • ${active ? 'Ativo' : 'Inativo'}`}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              );
            })}
          </div>
        </div>
      )}
      {visibleSteps.length === 0 && !stepForm && !showFixedGroups && (
        <p className="text-xs text-muted-foreground">Nenhum grupo ainda. Crie o primeiro abaixo (ex.: Tamanhos, Molhos).</p>
      )}
      {visibleSteps.map((s, idx) => {
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
              <button type="button" onClick={() => { setExpanded(isOpen ? null : s.id); setOptQuery(''); }} className="flex flex-1 min-w-0 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg" aria-expanded={isOpen}>
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
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => handleMoveStep(s, +1)} disabled={idx === visibleSteps.length - 1} aria-label="Descer grupo">↓</Button>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => openEditStep(s)} aria-label="Editar grupo"><Pencil className="h-3.5 w-3.5" /></Button>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive" onClick={() => handleDeleteStep(s)} aria-label="Excluir grupo"><Trash2 className="h-4 w-4" /></Button>
              </div>
            </div>
            {isOpen && (
              <div className="border-t border-border px-3 py-3 space-y-2">
                <p className="text-xs text-muted-foreground">Opções do grupo (preço = adicional)</p>
                {opts.length === 0 && <p className="text-xs text-muted-foreground">Sem opções — associe abaixo.</p>}
                {opts.length > 1 && (
                  <Input value={optQuery} onChange={(e) => setOptQuery(e.target.value)} placeholder="Buscar nesta área..." className="h-8 text-sm" aria-label="Buscar opções do grupo" />
                )}
                {opts
                  .filter((o) => {
                    const q = optQuery.trim().toLowerCase();
                    return !q || (o.name || '').toLowerCase().includes(q);
                  })
                  .map((o) => {
                    const visibleIdx = opts.indexOf(o);
                    return (
                  <div key={o.id} className={`min-w-0 rounded-lg border border-border px-2.5 py-2 ${o.active === false ? 'opacity-60' : ''}`}>
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
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{o.name}{' '}
                            <span className="text-muted-foreground font-normal">
                              {Number(o.price) > 0 ? `+R$ ${Number(o.price).toFixed(2)}` : 'Grátis'}
                            </span>
                          </p>
                          {o.description && <p className="text-[11px] text-muted-foreground truncate">{o.description}</p>}
                        </div>
                        {/* Seleção da opção: reutiliza o cadastro, sem duplicar. */}
                        <Checkbox
                          checked={o.active !== false}
                          onCheckedChange={() => handleToggleOption(s.id, o)}
                          aria-label={o.active !== false ? `Inativar ${o.name}` : `Ativar ${o.name}`}
                          className="shrink-0"
                        />
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0" disabled={visibleIdx === 0} onClick={() => handleMoveOption(s.id, opts, visibleIdx, -1)} aria-label="Subir opção"><ArrowUp className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0" disabled={visibleIdx === opts.length - 1} onClick={() => handleMoveOption(s.id, opts, visibleIdx, +1)} aria-label="Descer opção"><ArrowDown className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0" onClick={() => handleDuplicateOption(s.id, o, opts)} aria-label="Duplicar opção"><Copy className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0" onClick={() => openEditOption(o)} aria-label="Editar opção"><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0 text-destructive" onClick={() => handleDeleteOption(s.id, o)} aria-label="Remover opção"><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    )}
                  </div>
                    );
                  })}
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

      <div className="flex justify-start pt-1">
        <Button className="h-9 px-5 text-sm" onClick={openNewStep}>
          <Plus className="h-4 w-4" /> Novo grupo
        </Button>
      </div>

      <Dialog
        open={!!stepForm}
        onOpenChange={(open) => {
          if (!open) {
            setStepForm(null);
            setEditingStep(null);
          }
        }}
      >
        <DialogContent className="w-[calc(100%-1rem)] max-w-md max-h-[90vh] overflow-y-auto overflow-x-hidden">
          <DialogHeader>
            <DialogTitle>{editingStep ? 'Editar grupo' : 'Novo grupo'}</DialogTitle>
          </DialogHeader>
          {stepForm && (
            <div className="space-y-3 min-w-0">
              <p className="text-[11px] text-muted-foreground">
                Padrão: seleção única, máximo 1. Altere abaixo se precisar.
              </p>
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
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setStepForm(null); setEditingStep(null); }} disabled={busy}>
              Cancelar
            </Button>
            <Button onClick={handleSaveStep} disabled={busy || !stepForm}>
              {busy ? 'Salvando...' : (editingStep ? 'Salvar grupo' : 'Criar grupo')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!fixedDialog}
        onOpenChange={(open) => {
          if (!open && !fixedSaving) setFixedDialog(null);
        }}
      >
        <DialogContent className="w-[calc(100%-1rem)] max-w-md max-h-[90vh] overflow-y-auto overflow-x-hidden">
          <DialogHeader>
            <DialogTitle>{fixedDialog?.definition.title || 'Grupo fixo'}</DialogTitle>
          </DialogHeader>
          {fixedDialog && (
            <div className="space-y-3 min-w-0">
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">Grupo ativo</p>
                  <p className="text-[11px] text-muted-foreground">Exibir este grupo nos produtos de Lanches.</p>
                </div>
                <Switch
                  checked={!!fixedDialog.active}
                  onCheckedChange={(value) => setFixedDialog((prev) => (prev ? { ...prev, active: value } : prev))}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label>Seleção</Label>
                  <Select
                    value={fixedDialog.select_mode}
                    onValueChange={(value) => setFixedDialog((prev) => (prev ? {
                      ...prev,
                      select_mode: value,
                      max_select: value === 'single' ? 1 : prev.max_select,
                    } : prev))}
                  >
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="multi">Múltipla</SelectItem>
                      <SelectItem value="single">Única</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Máximo</Label>
                  <Input
                    type="number"
                    min={1}
                    max={20}
                    value={fixedDialog.max_select}
                    onChange={(e) => setFixedDialog((prev) => (prev ? { ...prev, max_select: e.target.value } : prev))}
                    className="h-9 text-sm"
                    disabled={fixedDialog.select_mode === 'single'}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2">
                <Label className="text-sm">Obrigatório</Label>
                <Switch
                  checked={!!fixedDialog.required}
                  onCheckedChange={(value) => setFixedDialog((prev) => (prev ? { ...prev, required: value } : prev))}
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label>Produtos disponíveis</Label>
                  <span className="text-[11px] text-muted-foreground">
                    {fixedCheckedCount} de {fixedDialog.categoryProducts.length}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Marque os produtos da categoria {fixedDialog.definition.title} que podem ser escolhidos.
                </p>
                <div className="max-h-64 overflow-y-auto rounded-lg border border-border divide-y divide-border bg-background">
                  {fixedDialog.categoryProducts.length === 0 ? (
                    <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                      Nenhum produto nesta categoria.
                    </p>
                  ) : fixedDialog.categoryProducts.map((product) => {
                    const unavailable = product.available === false || product.out_of_stock === true;
                    const price = Number(
                      product.promotional_price != null ? product.promotional_price : product.price,
                    ) || 0;
                    return (
                      <label
                        key={product.id}
                        className={`flex items-center gap-2 px-2.5 py-2 ${unavailable ? 'opacity-50' : 'cursor-pointer hover:bg-muted/50'}`}
                      >
                        <Checkbox
                          checked={!!fixedDialog.selected[product.id]}
                          onCheckedChange={(value) => setFixedDialog((prev) => (prev ? {
                            ...prev,
                            selected: { ...prev.selected, [product.id]: !!value },
                          } : prev))}
                          disabled={unavailable}
                          aria-label={`${fixedDialog.selected[product.id] ? 'Desabilitar' : 'Habilitar'} ${product.name}`}
                          className="shrink-0"
                        />
                        <span className="min-w-0 flex-1 truncate text-sm">{product.name}</span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {unavailable ? 'Indisponível' : price > 0 ? `+R$ ${price.toFixed(2)}` : 'Grátis'}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setFixedDialog(null)} disabled={fixedSaving}>
              Cancelar
            </Button>
            <Button onClick={handleSaveFixedGroup} disabled={fixedSaving || !fixedDialog}>
              {fixedSaving ? 'Salvando...' : 'Salvar grupo'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
