import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/api/supabaseClient';
import { createProduct as sbCreateProduct, updateProduct as sbUpdateProduct } from '@/api/catalog';
import { uploadImage as sbUploadImage } from '@/api/storage';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { Image } from '@/components/ui/image';
import ConfigStepsEditor from '@/components/products/ConfigStepsEditor';
import {
  listSteps as sbListSteps, createStep as sbCreateStep, updateStep as sbUpdateStep,
  listOptions as sbListOptions, createOption as sbCreateOption,
  updateOption as sbUpdateOption, deleteOption as sbDeleteOption,
  listIngredients as sbListIngredients, createIngredient as sbCreateIngredient,
} from '@/api/configurator';
import { QUICK_GROUP_TITLE, findQuickStep, buildQuickRows } from '@/lib/quickExtras';
import { INGREDIENT_SECTIONS, groupRowsBySection, validateNewIngredient } from '@/lib/ingredientSections';
import { usesFixedGroups } from '@/lib/fixedGroups';
import { Upload, Loader2, X, Package, Search, Plus, ChevronDown, ChevronUp, Circle, Trash2 } from 'lucide-react';

const MAX_IMAGE_MB = 5;

// Quatro grupos fixos do combo. Cada um eh um step proprio do produto,
// sem compartilhamento automatico entre grupos e sem herdar da categoria.
const COMBO_GROUPS = [
  { key: 'acompanhamento', title: 'Acompanhamento', required: true, min_select: 1, max_select: 1, select_mode: 'single', allow_repeat: false, free_qty: 0 },
  { key: 'bebida', title: 'Bebida', required: true, min_select: 1, max_select: 1, select_mode: 'single', allow_repeat: false, free_qty: 0 },
  { key: 'sobremesa', title: 'Sobremesa', required: false, min_select: 0, max_select: 1, select_mode: 'single', allow_repeat: false, free_qty: 0 },
  { key: 'extra', title: 'Extra', required: false, min_select: 0, max_select: 20, select_mode: 'multi', allow_repeat: true, free_qty: 0 },
];

function sectionRef(section) {
  return {
    step_id: null,
    ingredient_id: null,
    product_id: null,
    name: '',
    description: '',
    price: 0,
    active: true,
    sort_order: 0,
  };
}

function Section({ title, children }) {
  return (
    <section className="rounded-xl border border-border bg-muted/30 p-2.5">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">{title}</h3>
      {children}
    </section>
  );
}

function FlagRow({ label, checked, onChange }) {
  return (
    <label className="flex min-w-0 cursor-pointer items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5">
      <Switch checked={!!checked} onCheckedChange={onChange} className="shrink-0" />
      <span className="min-w-0 flex-1 text-[13px] leading-tight">{label}</span>
    </label>
  );
}

export default function ProductFormDialog({ open, onOpenChange, product, categories, companyId, onSaved, products = [] }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({});

  useEffect(() => {
    if (product) {
      setForm({
        ...product,
        price: String(product.price ?? ''),
        promotional_price: String(product.promotional_price ?? ''),
        preparation_time: product.preparation_time ?? 15,
        sort_order: product.sort_order ?? 0,
        stock: product.stock ?? -1,
        use_category_steps: product.use_category_steps !== false,
        is_combo: !!product.is_combo,
      });
    } else {
      setForm({
        name: '', description: '', category_id: categories[0]?.id || '', price: '', promotional_price: '',
        sku: '', internal_code: '', image_url: '', available: true, is_made_to_order: false,
        out_of_stock: false, stock: -1, preparation_time: 15, sort_order: 0,         is_featured: false,
        is_bestseller: false, ingredients: '', nutritional_info: '',
        is_combo: false,
      });
    }
  }, [product, open, categories]);

  const update = (field, value) => setForm(prev => ({ ...prev, [field]: value }));
  const productCategory = categories.find((category) => category.id === form.category_id);

  // Seleção rápida de extras: associa ingredientes existentes ao grupo
  // "Extras" DESTE produto (checkbox por associação; independente por
  // produto). Regras finas continuam na Montagem abaixo.
  const [quickIngredients, setQuickIngredients] = useState([]);
  const [quickStep, setQuickStep] = useState(null);
  const [quickOptions, setQuickOptions] = useState([]);
  const [quickSearch, setQuickSearch] = useState('');
  const [quickBusy, setQuickBusy] = useState(false);
  const [priceDraft, setPriceDraft] = useState({});
  const [refreshKey, setRefreshKey] = useState(0);
  // Combo: quatro grupos isolados por produto (Acompanhamento, Bebida,
  // Sobremesa, Extra). Cada grupo eh um step proprio do produto
  // (product_id preenchido, category_id null), sem herdar da categoria.
  const [comboSteps, setComboSteps] = useState({}); // chave do grupo -> step
  const [comboOptions, setComboOptions] = useState({}); // step_id -> opcoes[]
  const [comboLoading, setComboLoading] = useState(false);
  const [comboBusy, setComboBusy] = useState(false);
  const [comboDraft, setComboDraft] = useState(null); // { stepKey, product, name, price }
  const [comboSearch, setComboSearch] = useState('');
  // Cadastro rápido de ingrediente na biblioteca desta empresa. O preço
  // vira o padrão da biblioteca e o adicional da associação a ESTE produto.
  const [showAddIng, setShowAddIng] = useState(false);
  const [newIng, setNewIng] = useState({ name: '', category: '', price: '', active: true, associate: true });
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState('');
  // Seções recolhidas por id (padrão: todas expandidas).
  const [collapsedSections, setCollapsedSections] = useState({});

  const loadQuick = async () => {
    if (!open || !companyId || !product?.id) {
      setQuickIngredients([]);
      setQuickStep(null);
      setQuickOptions([]);
      return;
    }
    try {
      const [ings, steps] = await Promise.all([
        sbListIngredients(supabase, companyId).catch(() => []),
        sbListSteps(supabase, companyId, product.id).catch(() => []),
      ]);
      setQuickIngredients(ings);
      const qs = findQuickStep(steps);
      setQuickStep(qs);
      setQuickOptions(qs ? await sbListOptions(supabase, qs.id).catch(() => []) : []);
    } catch {
      // Biblioteca indisponível: seção exibe aviso, sem quebrar o diálogo.
    }
  };

  // Carrega/garante os 4 grupos fixos do combo quando o produto ja esta salvo.
  const loadCombo = async () => {
    if (!open || !companyId || !product?.id || !form.is_combo) {
      setComboSteps({});
      setComboOptions({});
      return;
    }
    setComboLoading(true);
    try {
      const steps = await sbListSteps(supabase, companyId, product.id).catch(() => []);
      const byKey = {};
      for (const g of COMBO_GROUPS) {
        const existing = steps.find((s) => s.product_id === product.id && s.title === g.title);
        if (existing) {
          byKey[g.key] = existing;
        } else {
          const created = await sbCreateStep(supabase, companyId, product.id, {
            title: g.title,
            description: 'Grupo do combo — ' + g.title,
            select_mode: g.select_mode,
            min_select: g.min_select,
            max_select: g.max_select,
            free_qty: g.free_qty,
            required: g.required,
            active: true,
          });
          byKey[g.key] = created;
        }
      }
      setComboSteps(byKey);
      const opts = {};
      for (const s of Object.values(byKey)) {
        try {
          opts[s.id] = await sbListOptions(supabase, s.id).catch(() => []);
        } catch {
          opts[s.id] = [];
        }
      }
      setComboOptions(opts);
    } catch (err) {
      toast({ title: 'Erro ao carregar grupos do combo', description: err?.message, variant: 'destructive' });
    } finally {
      setComboLoading(false);
    }
  };

  const refreshComboOptions = async (stepId) => {
    try {
      const list = await sbListOptions(supabase, stepId);
      setComboOptions((prev) => ({ ...prev, [stepId]: list }));
    } catch (err) {
      toast({ title: 'Erro ao carregar opcoes', description: err?.message, variant: 'destructive' });
    }
  };

  const comboPool = useMemo(() => {
    const q = comboSearch.trim().toLowerCase();
    return (products || [])
      .filter((p) => p && p.id !== product?.id && (!q || (p.name || '').toLowerCase().includes(q)))
      .slice(0, 12);
  }, [products, product?.id, comboSearch]);

  const startComboAssoc = (stepKey, productEntry) => {
    setComboDraft({ stepKey, product: productEntry, name: productEntry.name, price: 0 });
  };

  const clearComboDraft = () => setComboDraft(null);

  const saveComboOption = async () => {
    if (!comboDraft || comboBusy) return;
    const { stepKey, product: entry, name, price } = comboDraft;
    const step = comboSteps[stepKey];
    if (!step) return;
    setComboBusy(true);
    try {
      await sbCreateOption(supabase, {
        step_id: step.id,
        ingredient_id: null,
        product_id: entry.id,
        name: String(name || entry.name).trim(),
        description: '',
        price: Number(price) || 0,
        active: true,
        sort_order: 0,
      });
      setComboDraft(null);
      await refreshComboOptions(step.id);
      setRefreshKey((k) => k + 1);
      toast({ title: `"${entry.name}" adicionado ao grupo ${step.title}` });
    } catch (err) {
      toast({ title: 'Erro ao adicionar opcao', description: err?.message, variant: 'destructive' });
    } finally {
      setComboBusy(false);
    }
  };

  const updateComboOption = async (stepId, opt, patch) => {
    if (comboBusy) return;
    setComboBusy(true);
    try {
      await sbUpdateOption(supabase, opt.id, patch);
      await refreshComboOptions(stepId);
    } catch (err) {
      toast({ title: 'Erro ao atualizar opcao', description: err?.message, variant: 'destructive' });
    } finally {
      setComboBusy(false);
    }
  };

  const deleteComboOption = async (stepId, opt) => {
    if (!window.confirm(`Remover "${opt.name}" do grupo? Pedidos antigos nao sao afetados.`)) return;
    try {
      await sbDeleteOption(supabase, opt.id);
      await refreshComboOptions(stepId);
      toast({ title: 'Opcao removida!' });
    } catch (err) {
      toast({ title: 'Erro ao remover opcao', description: err?.message, variant: 'destructive' });
    }
  };

  const toggleComboStep = async (step) => {
    if (comboBusy) return;
    try {
      await sbUpdateStep(supabase, step.id, { active: !(step.active !== false) });
      await loadCombo();
    } catch (err) {
      toast({ title: 'Erro ao alterar grupo', description: err?.message, variant: 'destructive' });
    }
  };

  useEffect(() => { loadQuick(); loadCombo(); setQuickSearch(''); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open, product?.id, companyId, form.is_combo]);

  const ensureQuickStep = async () => {
    if (quickStep) return quickStep;
    const created = await sbCreateStep(supabase, companyId, product.id, {
      title: QUICK_GROUP_TITLE, description: 'Seleção rápida de ingredientes',
      select_mode: 'multi', min_select: 0, max_select: 20, free_qty: 0,
      required: false, active: true,
    });
    setQuickStep(created);
    return created;
  };

  const toggleQuick = async (ing, row) => {
    if (!product?.id || quickBusy) return;
    setQuickBusy(true);
    try {
      if (row.option) {
        await sbDeleteOption(supabase, row.option.id);
        toast({ title: `"${ing.name}" removido deste produto` });
      } else {
        const step = await ensureQuickStep();
        const price = Number(priceDraft[ing.id] ?? ing.price ?? 0) || 0;
        await sbCreateOption(supabase, {
          step_id: step.id, ingredient_id: ing.id, product_id: null,
          name: ing.name, description: ing.description || '', price, active: true, sort_order: 0,
        });
        toast({ title: `"${ing.name}" ativado neste produto!` });
      }
      setPriceDraft((prev) => {
        const next = { ...prev };
        delete next[ing.id];
        return next;
      });
      await loadQuick();
      setRefreshKey((k) => k + 1);
    } catch (err) {
      toast({ title: 'Erro ao associar', description: err?.message, variant: 'destructive' });
    } finally {
      setQuickBusy(false);
    }
  };

  const saveQuickPrice = async (row, value) => {
    if (!row.option || quickBusy) return;
    const price = Number(value);
    if (!Number.isFinite(price) || price < 0) {
      toast({ title: 'Preço inválido', variant: 'destructive' });
      return;
    }
    setQuickBusy(true);
    try {
      await sbUpdateOption(supabase, row.option.id, { price });
      await loadQuick();
      setRefreshKey((k) => k + 1);
    } catch (err) {
      toast({ title: 'Erro ao salvar preço', description: err?.message, variant: 'destructive' });
    } finally {
      setQuickBusy(false);
    }
  };

  const quickRows = buildQuickRows(quickIngredients, quickOptions)
    .filter((r) => {
      const q = quickSearch.trim().toLowerCase();
      return !q || (r.ingredient.name || '').toLowerCase().includes(q);
    });
  const quickGroups = groupRowsBySection(quickRows);

  const saveNewIngredient = async () => {
    if (!product?.id || addBusy) return;
    const err = validateNewIngredient({
      name: newIng.name,
      price: newIng.price,
      existingNames: quickIngredients.map((i) => i.name),
    });
    if (err) {
      setAddError(err);
      return;
    }
    setAddError('');
    setAddBusy(true);
    try {
      const created = await sbCreateIngredient(supabase, companyId, {
        name: newIng.name.trim(),
        category: newIng.category || '',
        price: Number(newIng.price) || 0,
        active: newIng.active !== false,
      });
      if (newIng.associate) {
        const step = await ensureQuickStep();
        await sbCreateOption(supabase, {
          step_id: step.id, ingredient_id: created.id, product_id: null,
          name: created.name, description: '', price: Number(newIng.price) || 0,
          active: true, sort_order: 0,
        });
      }
      setNewIng({ name: '', category: '', price: '', active: true, associate: true });
      setShowAddIng(false);
      await loadQuick();
      setRefreshKey((k) => k + 1);
      toast({ title: `"${created.name}" cadastrado!` });
    } catch (e) {
      setAddError(e?.message || 'Erro ao cadastrar ingrediente');
    } finally {
      setAddBusy(false);
    }
  };

  // Imagem no bucket catalog (pasta da empresa).
  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_IMAGE_MB * 1024 * 1024) {
      toast({ title: `Imagem maior que ${MAX_IMAGE_MB}MB`, variant: 'destructive' });
      e.target.value = '';
      return;
    }
    setUploading(true);
    try {
      if (!companyId) throw new Error('Empresa não identificada');
      const { file_url } = await sbUploadImage(supabase, 'catalog', companyId, file);
      update('image_url', file_url);
    } catch (err) {
      toast({ title: 'Erro no upload', description: err?.message, variant: 'destructive' });
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleSubmit = async () => {
    if (!form.name?.trim()) {
      toast({ title: 'Nome é obrigatório', variant: 'destructive' });
      return;
    }
    if (!form.price || Number(form.price) <= 0) {
      toast({ title: 'Preço é obrigatório', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      const data = {
        ...form,
        company_id: companyId,
        price: Number(form.price) || 0,
        promotional_price: form.promotional_price ? Number(form.promotional_price) : null,
        // Tempo de preparo saiu da interface (coluna preservada no banco).
        preparation_time: Number(form.preparation_time) || 15,
        sort_order: Number(form.sort_order) || 0,
        stock: Number(form.stock) ?? -1,
      };
      delete data.id; delete data.created_date; delete data.updated_date; delete data.created_by_id;
      if (product) {
        await sbUpdateProduct(supabase, companyId, product.id, data);
        toast({ title: 'Produto atualizado!' });
      } else {
        await sbCreateProduct(supabase, companyId, data);
        toast({ title: 'Produto criado!' });
      }
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      toast({ title: 'Erro ao salvar', description: err?.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const busy = loading || uploading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-[calc(100vw-2rem)] p-0 gap-0 flex flex-col overflow-visible max-h-[calc(100dvh-2rem)] top-[1rem] translate-y-0 sm:top-[50%] sm:translate-y-[-50%] sm:max-h-[calc(100dvh-2rem)] sm:max-w-2xl">
        <DialogHeader className="px-5 py-4 border-b border-border shrink-0 text-left">
          <DialogTitle>{product ? 'Editar produto' : 'Novo produto'}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-5 py-3 sm:py-4 space-y-2.5">
          {/* Topo compacto: foto + nome/categoria (lado a lado no desktop). */}
          <Section title="Produto">
            <div className="flex flex-col sm:flex-row gap-3 sm:items-start">
              <div className="shrink-0">
                {form.image_url ? (
                  <div className="relative">
                    <div className="h-20 w-20 sm:h-24 sm:w-24 rounded-xl overflow-hidden bg-muted border border-border">
                      <Image src={form.image_url} fittingType="fill" className="h-full w-full" alt="Preview" />
                    </div>
                    <button
                      type="button"
                      onClick={() => update('image_url', '')}
                      aria-label="Remover imagem"
                      className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="flex h-20 w-20 sm:h-24 sm:w-24 items-center justify-center rounded-xl border-2 border-dashed border-border bg-muted">
                    <Package className="h-7 w-7 text-muted-foreground/60" />
                  </div>
                )}
                <Label htmlFor="product-image" className="cursor-pointer">
                  <span className="mt-1.5 inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs font-medium hover:bg-muted transition-colors">
                    {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                    {uploading ? 'Enviando...' : form.image_url ? 'Alterar' : 'Foto'}
                  </span>
                </Label>
                <Input id="product-image" type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleUpload} disabled={uploading} />
              </div>
              <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-5">
                <div className="space-y-1.5 sm:col-span-3">
                  <Label>Nome *</Label>
                  <Input value={form.name || ''} onChange={e => update('name', e.target.value)} placeholder="Ex: Hão Burger Clássico" />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Categoria</Label>
                  <Select value={form.category_id || ''} onValueChange={v => update('category_id', v)}>
                    <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                    <SelectContent>
                      {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5 sm:col-span-5">
                  <Label>Descrição</Label>
                  <Textarea value={form.description || ''} onChange={e => update('description', e.target.value)} placeholder="Descrição do produto..." rows={2} />
                </div>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1.5">JPG, PNG, WebP até 5MB</p>
          </Section>

          <Section title="Preço">
              <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Preço (R$) *</Label>
                <Input type="number" min="0" step="0.50" value={form.price || ''} onChange={e => update('price', e.target.value)} placeholder="0,00" />
              </div>
              <div className="space-y-1.5">
                <Label>Preço promocional (R$)</Label>
                <Input type="number" min="0" step="0.50" value={form.promotional_price || ''} onChange={e => update('promotional_price', e.target.value)} placeholder="Opcional" />
              </div>
              <div className="space-y-1.5">
                <Label>SKU</Label>
                <Input value={form.sku || ''} onChange={e => update('sku', e.target.value)} placeholder="Ex: HBC001" />
              </div>
              <div className="space-y-1.5">
                <Label>Código interno</Label>
                <Input value={form.internal_code || ''} onChange={e => update('internal_code', e.target.value)} placeholder="Opcional" />
              </div>
            </div>
          </Section>

          <Section title="Disponibilidade">
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              <FlagRow label="Disponível" checked={form.available} onChange={v => update('available', v)} />
              <FlagRow label="Em destaque" checked={form.is_featured} onChange={v => update('is_featured', v)} />
              <FlagRow label="Mais vendido" checked={form.is_bestseller} onChange={v => update('is_bestseller', v)} />
              <FlagRow label="Sob encomenda" checked={form.is_made_to_order} onChange={v => update('is_made_to_order', v)} />
              <FlagRow label="Fora de estoque" checked={form.out_of_stock} onChange={v => update('out_of_stock', v)} />
              <div className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5">
                <Label className="shrink-0 text-[13px]">Ordem</Label>
                <Input type="number" value={form.sort_order ?? 0} onChange={e => update('sort_order', e.target.value)} className="h-7 min-w-0 flex-1 border-0 bg-transparent p-0 text-[13px]" aria-label="Ordem de exibição" />
              </div>
            </div>
          </Section>

          <Section title="Ingredientes e extras disponíveis">
            {!product?.id ? (
              <p className="text-xs text-muted-foreground">Salve o produto para selecionar ingredientes.</p>
            ) : quickRows.length === 0 && !quickSearch ? (
              <p className="text-xs text-muted-foreground">
                Nenhum ingrediente ativo na biblioteca. Cadastre em Cardápio → clique em Extras.
              </p>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full h-8 text-xs mb-2"
                  disabled={quickBusy}
                  onClick={() => { setAddError(''); setShowAddIng((v) => !v); }}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" /> Adicionar ingrediente ou extra
                </Button>
                {showAddIng && (
                  <div className="rounded-xl border border-border p-2.5 mb-2 space-y-1.5 bg-muted/30">
                    <div>
                      <Label htmlFor="new-ing-name">Nome *</Label>
                      <Input
                        id="new-ing-name"
                        value={newIng.name}
                        onChange={(e) => setNewIng((p) => ({ ...p, name: e.target.value }))}
                        placeholder="Ex.: Bacon crocante"
                        className="h-9 text-sm mt-1"
                        maxLength={80}
                      />
                    </div>
                    <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-1.5">
                      <div>
                        <Label htmlFor="new-ing-section">Seção</Label>
                        <Select value={newIng.category} onValueChange={(v) => setNewIng((p) => ({ ...p, category: v === '__none' ? '' : v }))}>
                          <SelectTrigger id="new-ing-section" className="h-9 text-sm mt-1"><SelectValue placeholder="Outros" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none">Outros</SelectItem>
                            {INGREDIENT_SECTIONS.map((s) => (
                              <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label htmlFor="new-ing-price">Preço padrão (R$)</Label>
                        <Input
                          id="new-ing-price"
                          type="number"
                          min={0}
                          step="0.01"
                          value={newIng.price}
                          onChange={(e) => setNewIng((p) => ({ ...p, price: e.target.value }))}
                          placeholder="0,00"
                          className="h-9 text-sm mt-1"
                        />
                      </div>
                    </div>
                    <label className="flex cursor-pointer items-center gap-2 text-[13px]">
                      <Switch checked={!!newIng.active} onCheckedChange={(v) => setNewIng((p) => ({ ...p, active: v }))} />
                      Disponível na biblioteca
                    </label>
                    <label className="flex cursor-pointer items-center gap-2 text-[13px]">
                      <Switch checked={!!newIng.associate} onCheckedChange={(v) => setNewIng((p) => ({ ...p, associate: v }))} />
                      Associar a este produto
                    </label>
                    {addError && <p className="text-xs text-destructive">{addError}</p>}
                    <div className="flex gap-1.5">
                      <Button type="button" size="sm" className="flex-1 h-8 px-3 text-xs" disabled={addBusy} onClick={saveNewIngredient}>
                        {addBusy ? 'Salvando...' : 'Salvar ingrediente'}
                      </Button>
                      <Button type="button" size="sm" variant="ghost" className="h-8 px-3 text-xs" disabled={addBusy} onClick={() => { setShowAddIng(false); setAddError(''); }}>
                        Cancelar
                      </Button>
                    </div>
                  </div>
                )}
                <div className="relative mb-2">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <Input value={quickSearch} onChange={(e) => setQuickSearch(e.target.value)} placeholder="Buscar ingrediente..." className="pl-9 h-9 text-sm" />
                </div>
                <div className="max-h-52 overflow-y-auto rounded-xl border border-border divide-y divide-border">
                  {quickRows.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-4">Nenhum ingrediente encontrado.</p>
                  ) : quickGroups.map((g) => (
                  <div key={g.id || 'outros'}>
                    <button
                      type="button"
                      onClick={() => setCollapsedSections((prev) => ({ ...prev, [g.id]: !prev[g.id] }))}
                      aria-expanded={!collapsedSections[g.id]}
                      className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{g.label} ({g.rows.length})</span>
                      {collapsedSections[g.id] ? (
                        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                    </button>
                    {!collapsedSections[g.id] && g.rows.map((row) => {
                    const on = !!row.option;
                    return (
                      <div key={row.ingredient.id} className="flex items-center gap-2.5 px-3 py-1.5 min-h-[44px]">
                        <button
                          type="button"
                          onClick={() => toggleQuick(row.ingredient, row)}
                          disabled={quickBusy}
                          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                          aria-pressed={on}
                        >
                          <span
                            aria-hidden
                            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] font-bold ${on ? 'bg-primary border-primary text-primary-foreground' : 'border-primary/40 bg-transparent'}`}
                          >
                            {on ? '✓' : ''}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-sm">{row.ingredient.name}</span>
                        </button>
                        <div className="flex shrink-0 items-center gap-1">
                          <span className="text-[11px] text-muted-foreground">R$</span>
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            className="h-8 w-20 text-right text-xs"
                            aria-label={`Adicional de ${row.ingredient.name}`}
                            value={row.option ? (row.option.price ?? 0) : (priceDraft[row.ingredient.id] ?? row.ingredient.price ?? '')}
                            placeholder="0,00"
                            disabled={quickBusy}
                            onChange={(e) => {
                              if (row.option) {
                                setQuickOptions((prev) => prev.map((o) => (o.id === row.option.id ? { ...o, price: e.target.value } : o)));
                              } else {
                                setPriceDraft((prev) => ({ ...prev, [row.ingredient.id]: e.target.value }));
                              }
                            }}
                            onBlur={(e) => { if (row.option) saveQuickPrice(row, e.target.value); }}
                          />
                        </div>
                      </div>
                    );
                  })}
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground mt-2">
                  Ativação por produto: marcar aqui não altera outros produtos. Regras finas na Montagem abaixo.
                </p>
              </>
            )}
          </Section>

          {form.is_combo && product?.id && (
            <Section title="Combo — grupos de opções">
              <p className="text-[11px] text-muted-foreground mb-3">
                Quatro grupos isolados por produto. As opções são produtos da mesma empresa (exceto este); o preço da opção é um adicional.
              </p>
              {comboLoading ? (
                <p className="text-xs text-muted-foreground">Carregando grupos...</p>
              ) : (
                <div className="space-y-2">
                  {COMBO_GROUPS.map((g) => {
                    const step = comboSteps[g.key];
                    const opts = comboOptions[step?.id] || [];
                    return (
                      <div key={g.key} className="rounded-xl border border-border p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm font-medium truncate flex-1">{g.title}</span>
                              <span className={`text-[10px] font-bold rounded-md px-1.5 py-0.5 ${g.required ? 'bg-primary/10 text-primary' : 'bg-amber/10 text-amber-800'}`}>
                                {g.required ? 'Obrigatório' : 'Opcional'}
                              </span>
                              <span className="text-[10px] text-muted-foreground">
                                {g.select_mode === 'single' ? '1 escolha' : 'Múltipla escolha'} • até {g.max_select}
                              </span>
                            </div>
                            {step && (
                              <div className="flex items-center gap-2 mt-1">
                                <span className="text-xs text-muted-foreground">{step.active !== false ? 'Ativo' : 'Inativo'}</span>
                                <button
                                  type="button"
                                  onClick={() => toggleComboStep(step)}
                                  disabled={comboBusy}
                                  className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                                >
                                  {step.active !== false ? 'Desativar' : 'Ativar'}
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="space-y-1">
                          <p className="text-[11px] text-muted-foreground">
                            Opções: {opts.length} {opts.length === 1 ? 'produto' : 'produtos'}
                          </p>
                          {opts.length === 0 ? (
                            <p className="text-xs text-muted-foreground">Nenhuma opção associada. Adicione abaixo.</p>
                          ) : (
                            <div className="max-h-40 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                              {opts.map((o) => (
                                <div key={o.id} className="flex items-center gap-2 px-2.5 py-1.5 text-sm">
                                  <span className="min-w-0 flex-1 truncate">{o.name}</span>
                                  {Number(o.price) > 0 ? (
                                    <span className="text-[11px] font-medium text-muted-foreground min-w-[40px] text-right">+R$ {Number(o.price).toFixed(2)}</span>
                                  ) : (
                                    <span className="text-[11px] font-medium text-green-700 min-w-[40px] text-right">Grátis</span>
                                  )}
                                  <div className="flex items-center gap-1">
                                    <Input
                                      type="number"
                                      min={0}
                                      step="0.01"
                                      value={o.price}
                                      className="h-6 w-20 text-xs text-right border-0 bg-transparent p-0 focus:ring-0"
                                      onChange={(e) => updateComboOption(step.id, o, { price: e.target.value })}
                                      disabled={comboBusy}
                                      aria-label={`Preço de ${o.name}`}
                                    />
                                    <button
                                      type="button"
                                      onClick={() => updateComboOption(step.id, o, { active: !(o.active !== false) })}
                                      disabled={comboBusy}
                                      className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground disabled:opacity-50"
                                      aria-label={o.active !== false ? 'Desativar opção' : 'Ativar opção'}
                                    >
                                      <Circle className="h-3 w-3" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => deleteComboOption(step.id, o)}
                                      disabled={comboBusy}
                                      className="h-6 w-6 p-0 text-destructive hover:bg-destructive/10 disabled:opacity-50"
                                      aria-label="Remover opção"
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                          {!comboDraft || comboDraft.stepKey !== g.key ? (
                            <div className="relative mb-2">
                              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                              <Input
                                value={comboSearch}
                                onChange={(e) => setComboSearch(e.target.value)}
                                placeholder={`Buscar produto para ${g.title}...`}
                                className="pl-9 h-8 text-sm"
                                disabled={comboBusy}
                              />
                            </div>
                          ) : (
                            <div className="space-y-1">
                              <p className="text-xs font-medium">Adicionar: {comboDraft.product.name}</p>
                              <Input
                                value={comboDraft.name}
                                onChange={(e) => setComboDraft((p) => p ? { ...p, name: e.target.value } : null)}
                                className="h-8 text-sm"
                                placeholder="Nome exibido"
                                disabled={comboBusy}
                              />
                              <Input
                                type="number"
                                min={0}
                                step="0.01"
                                value={comboDraft.price ?? ''}
                                onChange={(e) => setComboDraft((p) => p ? { ...p, price: e.target.value } : null)}
                                className="h-8 w-32 text-sm text-right"
                                placeholder="0,00"
                                disabled={comboBusy}
                              />
                              <div className="flex gap-1.5">
                                <button
                                  type="button"
                                  onClick={saveComboOption}
                                  disabled={comboBusy}
                                  className="h-8 px-3 text-xs flex-1"
                                >
                                  Associar
                                </button>
                                <button
                                  type="button"
                                  onClick={clearComboDraft}
                                  className="h-8 px-3 text-xs text-muted-foreground"
                                >
                                  Cancelar
                                </button>
                              </div>
                            </div>
                          )}
                          <div className="flex gap-1">
                            {comboPool.map((p) => (
                              <button
                                key={p.id}
                                type="button"
                                onClick={() => startComboAssoc(g.key, p)}
                                disabled={comboBusy || !!comboDraft}
                                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-xs text-left hover:bg-muted disabled:opacity-50"
                              >
                                <span className="w-6 text-center">{p.icon || '🏷️'}</span>
                                <span className="min-w-0 truncate">{p.name}</span>
                              </button>
                            ))}
                            {comboPool.length === 0 && (
                              <p className="text-[11px] text-muted-foreground">Nenhum produto disponível nesta empresa.</p>
                            )}
                          </div>
                         </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Section>
          )}

          {form.is_combo && !product?.id && (
            <Section title="Combo — grupos de opções">
              <p className="text-xs text-muted-foreground">Salve o produto para configurar os grupos do combo.</p>
            </Section>
          )}

          <Section title="Montagem (complementos V2)">
            {/* Exceção individual: desliga a herança dos grupos da categoria. */}
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5 mb-2">
              <Switch checked={form.use_category_steps !== false} onCheckedChange={v => update('use_category_steps', v)} className="shrink-0" />
              <span className="min-w-0 flex-1 text-[13px] leading-tight">Usar grupos da categoria</span>
            </label>
            {usesFixedGroups(productCategory) && (
              <p className="text-[11px] text-muted-foreground mb-2">
                Os grupos fixos são ativados na edição da categoria; o grupo da própria categoria não aparece.
              </p>
            )}
            {product?.id ? (
              <ConfigStepsEditor companyId={companyId} productId={product.id} products={products} refreshKey={refreshKey} />
            ) : (
              <p className="text-xs text-muted-foreground">Salve o produto antes de montar grupos de complementos.</p>
            )}
            <p className="text-[11px] text-muted-foreground mt-2">
              Grupos reutilizáveis por seleção (ingredientes na aba Complementos). Não afeta pedidos já registrados.
            </p>
          </Section>

          <Section title="Informações adicionais">
            <div className="grid gap-3">
              <div className="space-y-1.5">
                <Label>Ingredientes</Label>
                <Textarea value={form.ingredients || ''} onChange={e => update('ingredients', e.target.value)} placeholder="Alface, Tomate, Cebola..." rows={2} />
                <p className="text-[11px] text-muted-foreground">Separe os itens por vírgula.</p>
              </div>
              <div className="space-y-1.5">
                <Label>Informações nutricionais (opcional)</Label>
                <Textarea value={form.nutritional_info || ''} onChange={e => update('nutritional_info', e.target.value)} placeholder="Calorias, nutrientes..." rows={2} />
              </div>
            </div>
          </Section>
        </div>

        <DialogFooter className="px-4 sm:px-5 py-3 border-t border-border shrink-0 flex flex-col sm:flex-row sm:justify-end gap-2">
          <Button variant="outline" className="h-10 px-4 sm:px-5" onClick={() => onOpenChange(false)} disabled={loading}>Cancelar</Button>
          <Button className="h-10 px-4 sm:px-5" onClick={handleSubmit} disabled={busy}>
            {loading ? (<span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Salvando...</span>) : 'Salvar produto'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
