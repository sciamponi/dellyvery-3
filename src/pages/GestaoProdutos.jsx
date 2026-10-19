import React, { useState, useEffect } from 'react';
import { supabase, isSupabaseConfigured } from '@/api/supabaseClient';
import { useSupabaseAuth } from '@/lib/SupabaseAuthContext';
import {
  listCategories, listProducts, deleteCategory as sbDeleteCategory,
  deleteProduct as sbDeleteProduct, updateCategory as sbUpdateCategory,
  updateProduct as sbUpdateProduct, ensureDefaultCategories as sbEnsureDefaults,
  createProduct as sbCreateProduct,
} from '@/api/catalog';
import { useCompany } from '@/hooks/useCompany';
import PageHeader from '@/components/PageHeader';
import ConfirmDialog from '@/components/ConfirmDialog';
import ProductFormDialog from '@/components/products/ProductFormDialog';
import CategoryFormDialog from '@/components/products/CategoryFormDialog';
import IngredientsManager from '@/components/products/IngredientsManager';
import DependenciesManager from '@/components/products/DependenciesManager';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Image } from '@/components/ui/image';
import { useToast } from '@/components/ui/use-toast';
import { validateQuickProductEdit, quickProductPatch } from '@/lib/productQuickEdit';
import { Plus, Search, Pencil, Trash2, Package, Star, Tag, Clock, LayoutGrid, List, Copy, Settings2 } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import BulkActionsBar from '@/components/products/BulkActionsBar';
import CategoryProductsDialog from '@/components/products/CategoryProductsDialog';
import { getViewMode, setViewMode as persistViewMode } from '@/lib/viewPrefs';
import { toggleSelected, toggleAllVisible, pruneSelected, allVisibleSelected, runBulk } from '@/lib/bulkSelect';
import { buildProductDuplicate } from '@/lib/productQuickEdit';

const fmtCurrency = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);

function Spinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-4 border-border border-t-primary rounded-full animate-spin" />
    </div>
  );
}

export default function GestaoProdutos() {
  const { loading } = useCompany();
  const { toast } = useToast();
  // Catálogo via Supabase (RLS) com sessão + empresa atual.
  const { user: sbUser, currentCompany: sbCompany, loading: sbLoading } = useSupabaseAuth();
  const sbActive = isSupabaseConfigured() && !!sbUser && !!sbCompany;
  const effectiveCompany = sbActive ? { id: sbCompany.id, ...sbCompany } : null;
  const [tab, setTab] = useState('produtos');
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  // Vista por área com persistência (sobrevive a navegação e reload).
  const [viewMode, setViewModeState] = useState(() => getViewMode('produtos'));
  const [catViewMode, setCatViewModeState] = useState(() => getViewMode('categorias'));
  const setViewMode = (v) => { setViewModeState(v); persistViewMode('produtos', v); };
  const setCatViewMode = (v) => { setCatViewModeState(v); persistViewMode('categorias', v); };
  // Seleção em massa (só ids visíveis pelo "todos"; reconciliada ao mudar dados).
  const [selectedIds, setSelectedIds] = useState([]);
  const [catSelectedIds, setCatSelectedIds] = useState([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  // Gerenciador de produtos da categoria (duas colunas).
  const [manageCat, setManageCat] = useState(null);
  // Edição rápida (modo lista): rascunho, erro e salvamento por id — falha
  // em uma linha nunca descarta as outras.
  const [editingId, setEditingId] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [rowErrors, setRowErrors] = useState({});
  const [savingId, setSavingId] = useState(null);
  const [productDialog, setProductDialog] = useState(false);
  const [categoryDialog, setCategoryDialog] = useState(false);
  const [editProduct, setEditProduct] = useState(null);
  const [editCategory, setEditCategory] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [restoringDefaults, setRestoringDefaults] = useState(false);
  // Modal de Extras: gerencia a biblioteca de ingredientes reutilizáveis
  // sem sair do Cardápio e sem redirecionar para cadastro de produto.
  const [ingredientsOpen, setIngredientsOpen] = useState(false);

  // Clique no card: Extras abre o modal de ingredientes; demais
  // categorias abrem a listagem de produtos filtrada.
  const openCategory = (cat) => {
    if (cat?.slug === 'extras') {
      setIngredientsOpen(true);
      return;
    }
    setFilterCat(cat.id);
    setSearch('');
    setTab('produtos');
  };

  const loadData = async () => {
    const comp = sbActive ? sbCompany : null;
    if (!comp) return;
    try {
      const [prods, cats] = await Promise.all([
        listProducts(supabase, comp.id),
        listCategories(supabase, comp.id),
      ]);
      setProducts(prods);
      setCategories(cats);
    } catch (err) {
      toast({ title: 'Erro ao carregar cardápio', description: err?.message, variant: 'destructive' });
    }
  };

  useEffect(() => {
    if (sbActive) loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sbActive, sbCompany?.id]);

  // Reconcilia a seleção quando registros somem (exclusão em outra sessão).
  useEffect(() => {
    setSelectedIds((prev) => pruneSelected(prev, products.map((p) => p.id)));
    setCatSelectedIds((prev) => pruneSelected(prev, categories.map((c) => c.id)));
  }, [products, categories]);

  if (loading || sbLoading) return <Spinner />;
  if (!effectiveCompany) return null;
  const company = effectiveCompany;

  const filteredProducts = products.filter(p => {
    const ms = !search || p.name?.toLowerCase().includes(search.toLowerCase());
    const mc = filterCat === 'all' || p.category_id === filterCat;
    const st = filterStatus === 'all'
      || (filterStatus === 'active' && !!p.available)
      || (filterStatus === 'inactive' && !p.available);
    return ms && mc && st;
  });

  const startQuickEdit = (product) => {
    setEditingId(product.id);
    setDrafts((prev) => ({
      ...prev,
      [product.id]: {
        name: product.name || '',
        category_id: product.category_id || '',
        price: product.price ?? '',
      },
    }));
    setRowErrors((prev) => ({ ...prev, [product.id]: '' }));
  };

  const cancelQuickEdit = (id) => {
    setEditingId((cur) => (cur === id ? null : cur));
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setRowErrors((prev) => ({ ...prev, [id]: '' }));
  };

  const saveQuickEdit = async (product) => {
    const draft = drafts[product.id] || {};
    const err = validateQuickProductEdit(draft);
    if (err) {
      setRowErrors((prev) => ({ ...prev, [product.id]: err }));
      return;
    }
    setSavingId(product.id);
    try {
      const updated = await sbUpdateProduct(
        supabase, effectiveCompany.id, product.id, quickProductPatch(draft),
      );
      setProducts((prev) => prev.map((p) => (
        p.id === product.id ? { ...p, ...(updated || {}), name: draft.name.trim(), category_id: draft.category_id || null, price: Number(draft.price) } : p
      )));
      setEditingId(null);
      toast({ title: 'Produto atualizado!' });
    } catch (e) {
      setRowErrors((prev) => ({ ...prev, [product.id]: e?.message || 'Erro ao salvar' }));
    } finally {
      setSavingId(null);
    }
  };

  const openEditProduct = (product) => {
    setEditProduct(product);
    setProductDialog(true);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      if (deleteTarget.type === 'product') {
        await sbDeleteProduct(supabase, effectiveCompany.id, deleteTarget.id);
        setProducts(prev => prev.filter(p => p.id !== deleteTarget.id));
      } else {
        await sbDeleteCategory(supabase, effectiveCompany.id, deleteTarget.id);
        setCategories(prev => prev.filter(c => c.id !== deleteTarget.id));
      }
      toast({ title: 'Excluído com sucesso' });
    } catch (err) {
      toast({ title: 'Erro ao excluir', description: err?.message, variant: 'destructive' });
    } finally {
      setDeleteTarget(null);
    }
  };

  const toggleAvailable = async (product) => {
    try {
      await sbUpdateProduct(supabase, effectiveCompany.id, product.id, { available: !product.available });
      setProducts(prev => prev.map(p => p.id === product.id ? { ...p, available: !p.available } : p));
    } catch (err) {
      toast({ title: 'Erro', variant: 'destructive' });
    }
  };

  const toggleCategoryActive = async (cat) => {
    try {
      await sbUpdateCategory(supabase, effectiveCompany.id, cat.id, { active: !cat.active });
      setCategories(prev => prev.map(c => c.id === cat.id ? { ...c, active: !cat.active } : c));
    } catch (err) {
      toast({ title: 'Erro', variant: 'destructive' });
    }
  };

  const summarizeBulk = (label, ok, fail) => {
    if (fail.length === 0) {
      toast({ title: `${ok.length} ${label} com sucesso!` });
    } else {
      toast({
        title: `${ok.length} ok, ${fail.length} falharam`,
        description: fail.slice(0, 3).map((f) => f.error).join(' • '),
        variant: 'destructive',
      });
    }
  };

  // Ativa/inativa em massa (só empresa atual; falha por registro).
  const bulkSetAvailable = async (ids, active) => {
    if (!ids.length || bulkBusy) return;
    setBulkBusy(true);
    const targets = products.filter((p) => ids.includes(p.id));
    const { ok, fail } = await runBulk(targets, (p) =>
      sbUpdateProduct(supabase, effectiveCompany.id, p.id, { available: active }),
    );
    if (ok.length > 0) {
      const okSet = new Set(ok);
      setProducts((prev) => prev.map((p) => (okSet.has(p.id) ? { ...p, available: active } : p)));
      setSelectedIds((prev) => prev.filter((id) => !okSet.has(id)));
    }
    setBulkBusy(false);
    summarizeBulk(active ? 'ativados' : 'inativados', ok, fail);
  };

  const bulkDeleteProducts = async (ids) => {
    if (!ids.length || bulkBusy) return;
    if (!window.confirm(`Excluir ${ids.length} ${ids.length === 1 ? 'produto' : 'produtos'}? Esta ação é irreversível.`)) return;
    setBulkBusy(true);
    const targets = products.filter((p) => ids.includes(p.id));
    const { ok, fail } = await runBulk(targets, (p) =>
      sbDeleteProduct(supabase, effectiveCompany.id, p.id),
    );
    if (ok.length > 0) {
      const okSet = new Set(ok);
      setProducts((prev) => prev.filter((p) => !okSet.has(p.id)));
      setSelectedIds((prev) => prev.filter((id) => !okSet.has(id)));
    }
    setBulkBusy(false);
    summarizeBulk('excluídos', ok, fail);
  };

  const bulkSetCategoryActive = async (ids, active) => {
    if (!ids.length || bulkBusy) return;
    setBulkBusy(true);
    const targets = categories.filter((c) => ids.includes(c.id));
    const { ok, fail } = await runBulk(targets, (c) =>
      sbUpdateCategory(supabase, effectiveCompany.id, c.id, { active }),
    );
    if (ok.length > 0) {
      const okSet = new Set(ok);
      setCategories((prev) => prev.map((c) => (okSet.has(c.id) ? { ...c, active } : c)));
      setCatSelectedIds((prev) => prev.filter((id) => !okSet.has(id)));
    }
    setBulkBusy(false);
    summarizeBulk(active ? 'ativadas' : 'inativadas', ok, fail);
  };

  const bulkDeleteCategories = async (ids) => {
    if (!ids.length || bulkBusy) return;
    if (!window.confirm(`Excluir ${ids.length} ${ids.length === 1 ? 'categoria' : 'categorias'}? Esta ação é irreversível.`)) return;
    setBulkBusy(true);
    const targets = categories.filter((c) => ids.includes(c.id));
    const { ok, fail } = await runBulk(targets, (c) =>
      sbDeleteCategory(supabase, effectiveCompany.id, c.id),
    );
    if (ok.length > 0) {
      const okSet = new Set(ok);
      setCategories((prev) => prev.filter((c) => !okSet.has(c.id)));
      setCatSelectedIds((prev) => prev.filter((id) => !okSet.has(id)));
    }
    setBulkBusy(false);
    summarizeBulk('excluídas', ok, fail);
  };

  // Duplica o produto com novo id, sem levar vínculos; abre para revisão.
  const duplicateProduct = async (p) => {
    if (!p?.id || bulkBusy) return;
    setBulkBusy(true);
    try {
      const created = await sbCreateProduct(supabase, effectiveCompany.id, buildProductDuplicate(p));
      setProducts((prev) => [...prev, { ...buildProductDuplicate(p), id: created.id }]);
      setEditProduct({ ...buildProductDuplicate(p), id: created.id });
      setProductDialog(true);
      toast({ title: 'Produto duplicado (inativo para revisão)!' });
    } catch (err) {
      toast({ title: 'Erro ao duplicar', description: err?.message, variant: 'destructive' });
    } finally {
      setBulkBusy(false);
    }
  };

  // Categorias padrão (Lanches, Acompanhamentos, ...): restaura as 5 sem
  // duplicar (upsert por slug) e sem tocar nas personalizadas.
  const handleRestoreDefaults = async () => {
    if (!company?.id || restoringDefaults) return;
    setRestoringDefaults(true);
    try {
      await sbEnsureDefaults(supabase, company.id);
      await loadData();
      toast({ title: 'Categorias padrão restauradas!' });
    } catch (err) {
      toast({ title: 'Erro ao restaurar', description: err?.message, variant: 'destructive' });
    } finally {
      setRestoringDefaults(false);
    }
  };

  return (
    <div>
      <PageHeader title="Cardápio" description="Gerencie seus produtos e categorias">
        {tab === 'produtos' ? (
          <Button onClick={() => { setEditProduct(null); setProductDialog(true); }} className="bg-primary hover:bg-primary/90 h-9 px-4">
            <Plus className="h-4 w-4" /> Novo produto
          </Button>
        ) : tab === 'categorias' ? (
          <Button onClick={() => { setEditCategory(null); setCategoryDialog(true); }} className="bg-primary hover:bg-primary/90 h-9 px-4">
            <Plus className="h-4 w-4" /> Nova categoria
          </Button>
        ) : null}
      </PageHeader>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="max-w-full justify-start overflow-x-auto no-scrollbar sm:justify-center sm:overflow-visible">
          <TabsTrigger value="produtos">Produtos ({products.length})</TabsTrigger>
          <TabsTrigger value="categorias">Categorias ({categories.length})</TabsTrigger>
          <TabsTrigger value="complementos">Complementos</TabsTrigger>
          <TabsTrigger value="dependencias">Dependências</TabsTrigger>
        </TabsList>

        {/* Products tab */}
        <TabsContent value="produtos" className="mt-4">
          <div className="flex flex-col gap-2 mb-4 lg:flex-row lg:items-center">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar produto..." className="pl-9 h-9 text-sm" />
            </div>
            <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 lg:max-w-[60%] lg:justify-end lg:flex-wrap lg:overflow-visible">
              <button onClick={() => setFilterCat('all')} className={`shrink-0 whitespace-nowrap rounded-full px-3 h-8 text-xs font-medium transition-colors border ${filterCat === 'all' ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted text-muted-foreground border-transparent hover:bg-muted/70'}`}>Todos</button>
              {categories.map(c => (
                <button key={c.id} onClick={() => setFilterCat(c.id)} title={c.name} className={`shrink-0 whitespace-nowrap rounded-full px-3 h-8 text-xs font-medium transition-colors border ${filterCat === c.id ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted text-muted-foreground border-transparent hover:bg-muted/70'}`}>
                  {c.icon} {c.name}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <div className="flex gap-1.5">
              {[['all', 'Todos'], ['active', 'Ativos'], ['inactive', 'Inativos']].map(([v, label]) => (
                <button key={v} onClick={() => setFilterStatus(v)} className={`shrink-0 whitespace-nowrap rounded-full px-3 h-8 text-xs font-medium transition-colors border ${filterStatus === v ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted text-muted-foreground border-transparent hover:bg-muted/70'}`}>{label}</button>
              ))}
            </div>
            <div className="ml-auto flex gap-1.5">
              <button onClick={() => setViewMode('cards')} aria-pressed={viewMode === 'cards'} title="Modo cards" className={`flex items-center gap-1.5 rounded-full px-3 h-8 text-xs font-medium transition-colors border ${viewMode === 'cards' ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted text-muted-foreground border-transparent hover:bg-muted/70'}`}>
                <LayoutGrid className="h-3.5 w-3.5" /> Cards
              </button>
              <button onClick={() => setViewMode('lista')} aria-pressed={viewMode === 'lista'} title="Modo lista" className={`flex items-center gap-1.5 rounded-full px-3 h-8 text-xs font-medium transition-colors border ${viewMode === 'lista' ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted text-muted-foreground border-transparent hover:bg-muted/70'}`}>
                <List className="h-3.5 w-3.5" /> Lista
              </button>
            </div>
          </div>

          {filteredProducts.length === 0 ? (
            <div className="text-center py-16">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
                <Package className="h-8 w-8 text-muted-foreground" />
              </div>
              <p className="font-medium text-foreground">{search || filterCat !== 'all' ? 'Nenhum produto encontrado' : 'Nenhum produto cadastrado'}</p>
              <p className="text-sm text-muted-foreground mt-1">{search || filterCat !== 'all' ? 'Tente ajustar a busca ou filtros.' : 'Adicione seu primeiro produto ao cardápio.'}</p>
              {!search && filterCat === 'all' && (
                <Button onClick={() => { setEditProduct(null); setProductDialog(true); }} className="mt-4 bg-primary hover:bg-primary/90">
                  <Plus className="h-4 w-4" /> Novo produto
                </Button>
              )}
            </div>
          ) : viewMode === 'lista' ? (
            <>
            <BulkActionsBar
              count={selectedIds.length}
              entityLabel="produtos"
              busy={bulkBusy}
              onActivate={() => bulkSetAvailable(selectedIds, true)}
              onDeactivate={() => bulkSetAvailable(selectedIds, false)}
              onDelete={() => bulkDeleteProducts(selectedIds)}
              onClear={() => setSelectedIds([])}
            />
            <ProductListTable
              products={filteredProducts}
              categories={categories}
              editingId={editingId}
              drafts={drafts}
              rowErrors={rowErrors}
              savingId={savingId}
              onStartEdit={startQuickEdit}
              onCancelEdit={cancelQuickEdit}
              onDraftChange={(id, field, value) => setDrafts((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), [field]: value } }))}
              onSave={saveQuickEdit}
              onToggle={toggleAvailable}
              onEditFull={openEditProduct}
              onDelete={(p) => setDeleteTarget({ type: 'product', id: p.id, name: p.name })}
              onDuplicate={duplicateProduct}
              selectedIds={selectedIds}
              onToggleSelect={(id) => setSelectedIds((prev) => toggleSelected(prev, id))}
              onToggleAll={(v) => setSelectedIds((prev) => toggleAllVisible(prev, filteredProducts.map((p) => p.id), v))}
              allChecked={allVisibleSelected(selectedIds, filteredProducts.map((p) => p.id))}
              someChecked={filteredProducts.some((p) => selectedIds.includes(p.id))}
            />
            </>
          ) : (
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filteredProducts.map(product => {
                const cat = categories.find(c => c.id === product.category_id);
                return (
                  <div
                    key={product.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openEditProduct(product)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEditProduct(product); } }}
                    className="rounded-xl border border-border bg-card overflow-hidden cursor-pointer transition-all hover:shadow-md hover:border-primary/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className="relative aspect-[16/10] overflow-hidden bg-muted">
                      {product.image_url ? (
                        <Image src={product.image_url} fittingType="fill" className="h-full w-full" alt={product.name} />
                      ) : (
                        <div className="flex h-full items-center justify-center"><Package className="h-8 w-8 text-muted-foreground/60" /></div>
                      )}
                      <div className="absolute top-2 left-2 flex gap-1">
                        {product.is_featured && <span className="rounded-md bg-yellow-100 text-yellow-700 px-1.5 py-0.5 text-[11px] font-medium flex items-center gap-0.5 shadow-sm"><Star className="h-3 w-3" /> Destaque</span>}
                        {product.is_bestseller && <span className="rounded-md bg-green-100 text-green-700 px-1.5 py-0.5 text-[11px] font-medium shadow-sm">Mais vendido</span>}
                      </div>
                      {!product.available && <span className="absolute top-2 right-2 rounded-md bg-red-100 text-red-700 px-1.5 py-0.5 text-[11px] font-medium shadow-sm">Indisponível</span>}
                      {product.is_made_to_order && <span className="absolute bottom-2 right-2 rounded-md bg-blue-100 text-blue-700 px-1.5 py-0.5 text-[11px] font-medium flex items-center gap-0.5 shadow-sm"><Clock className="h-3 w-3" /> Encomenda</span>}
                    </div>
                    <div className="p-3">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-heading font-semibold text-sm text-foreground truncate flex-1 min-w-0">{product.name}</h3>
                        <div className="text-right shrink-0">
                          {product.promotional_price ? (
                            <>
                              <p className="text-[11px] text-muted-foreground line-through leading-tight">{fmtCurrency(product.price)}</p>
                              <p className="font-heading font-bold text-sm text-primary leading-tight">{fmtCurrency(product.promotional_price)}</p>
                            </>
                          ) : (
                            <p className="font-heading font-bold text-sm text-foreground leading-tight">{fmtCurrency(product.price)}</p>
                          )}
                        </div>
                      </div>
                      {cat && <p className="text-xs text-muted-foreground mt-0.5 truncate">{cat.icon} {cat.name}</p>}
                      {product.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2 min-h-[2rem] leading-snug">{product.description}</p>}
                      <div className="flex items-center justify-between mt-2 pt-2 border-t border-border">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); toggleAvailable(product); }}
                          className="flex items-center gap-1.5 rounded-full px-1.5 py-1 -ml-1.5 hover:bg-muted transition-colors"
                          aria-label={product.available ? 'Desativar produto' : 'Ativar produto'}
                        >
                          <span onClick={(e) => e.stopPropagation()}>
                            <Switch checked={!!product.available} onCheckedChange={() => toggleAvailable(product)} onClick={(e) => e.stopPropagation()} />
                          </span>
                          <span className={`text-[11px] font-medium flex items-center gap-1 ${product.available ? 'text-green-700' : 'text-muted-foreground'}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${product.available ? 'bg-green-500' : 'bg-muted-foreground/50'}`} />
                            {product.available ? 'Ativo' : 'Inativo'}
                          </span>
                        </button>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 px-3 text-xs font-medium"
                            onClick={(e) => { e.stopPropagation(); openEditProduct(product); }}
                          >
                            <Pencil className="h-3.5 w-3.5" /> Editar
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 shrink-0"
                            aria-label={`Duplicar ${product.name}`}
                            title="Duplicar produto"
                            onClick={(e) => { e.stopPropagation(); duplicateProduct(product); }}
                          >
                            <Copy className="h-4 w-4 text-muted-foreground" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                            aria-label={`Excluir ${product.name}`}
                            onClick={(e) => { e.stopPropagation(); setDeleteTarget({ type: 'product', id: product.id, name: product.name }); }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* Categories tab */}
        <TabsContent value="categorias" className="mt-6">
          {categories.length > 0 && (
            <div className="flex items-center justify-between gap-2 mb-3">
              <p className="text-xs text-muted-foreground">
                {categories.some(c => c.slug) ? 'Inclui categorias padrão da plataforma.' : 'Sem categorias padrão.'}
              </p>
              <Button variant="outline" size="sm" className="h-8 text-xs shrink-0" onClick={handleRestoreDefaults} disabled={restoringDefaults}>
                {restoringDefaults ? 'Restaurando...' : 'Restaurar padrão'}
              </Button>
            </div>
          )}
          {categories.length === 0 ? (
            <div className="text-center py-16">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
                <Tag className="h-8 w-8 text-muted-foreground" />
              </div>
              <p className="font-medium text-foreground">Nenhuma categoria cadastrada</p>
              <p className="text-sm text-muted-foreground mt-1">Crie categorias para organizar seus produtos.</p>
              <Button onClick={() => { setEditCategory(null); setCategoryDialog(true); }} className="mt-4 bg-primary hover:bg-primary/90">
                <Plus className="h-4 w-4" /> Nova categoria
              </Button>
            </div>
          ) : (
            <>
            <div className="ml-auto flex gap-1.5 mb-3 w-fit">
              <button onClick={() => setCatViewMode('cards')} aria-pressed={catViewMode === 'cards'} title="Modo cards" className={`flex items-center gap-1.5 rounded-full px-3 h-8 text-xs font-medium transition-colors border ${catViewMode === 'cards' ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted text-muted-foreground border-transparent hover:bg-muted/70'}`}>
                <LayoutGrid className="h-3.5 w-3.5" /> Cards
              </button>
              <button onClick={() => setCatViewMode('lista')} aria-pressed={catViewMode === 'lista'} title="Modo lista" className={`flex items-center gap-1.5 rounded-full px-3 h-8 text-xs font-medium transition-colors border ${catViewMode === 'lista' ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted text-muted-foreground border-transparent hover:bg-muted/70'}`}>
                <List className="h-3.5 w-3.5" /> Lista
              </button>
            </div>
            {catViewMode === 'lista' ? (
            <>
            <BulkActionsBar
              count={catSelectedIds.length}
              entityLabel="categorias"
              busy={bulkBusy}
              onActivate={() => bulkSetCategoryActive(catSelectedIds, true)}
              onDeactivate={() => bulkSetCategoryActive(catSelectedIds, false)}
              onDelete={() => bulkDeleteCategories(catSelectedIds)}
              onClear={() => setCatSelectedIds([])}
            />
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="bg-muted/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="px-3 py-2 w-10">
                      <Checkbox
                        checked={(() => {
                          const ids = categories.map((c) => c.id);
                          if (allVisibleSelected(catSelectedIds, ids)) return true;
                          if (ids.some((id) => catSelectedIds.includes(id))) return 'indeterminate';
                          return false;
                        })()}
                        onCheckedChange={(v) => setCatSelectedIds((prev) => toggleAllVisible(prev, categories.map((c) => c.id), !!v))}
                        aria-label="Selecionar categorias visíveis"
                        className="shrink-0"
                      />
                    </th>
                    <th className="px-3 py-2 font-semibold">Categoria</th>
                    <th className="px-3 py-2 font-semibold text-right">Produtos</th>
                    <th className="px-3 py-2 font-semibold text-center">Ativa</th>
                    <th className="px-3 py-2 font-semibold text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {categories.map((cat) => {
                    const count = products.filter((p) => p.category_id === cat.id).length;
                    return (
                      <tr key={cat.id} className="align-middle hover:bg-muted/30">
                        <td className="px-3 py-2">
                          <Checkbox
                            checked={catSelectedIds.includes(cat.id)}
                            onCheckedChange={() => setCatSelectedIds((prev) => toggleSelected(prev, cat.id))}
                            aria-label={`Selecionar ${cat.name}`}
                            className="shrink-0"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <span className="font-medium text-foreground">{cat.icon} {cat.name}</span>
                          {cat.slug && <span className="ml-1.5 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary align-middle">Padrão</span>}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold whitespace-nowrap">{count}</td>
                        <td className="px-3 py-2 text-center">
                          <Switch checked={!!cat.active} onCheckedChange={() => toggleCategoryActive(cat)} aria-label={cat.active ? 'Desativar categoria' : 'Ativar categoria'} />
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setManageCat(cat)}>
                              <Settings2 className="h-3.5 w-3.5" /> Gerenciar
                            </Button>
                            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => { setEditCategory(cat); setCategoryDialog(true); }}>
                              <Pencil className="h-3.5 w-3.5" /> Editar
                            </Button>
                            <Button
                              size="sm" variant="ghost"
                              className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                              aria-label={`Excluir ${cat.name}`}
                              onClick={() => setDeleteTarget({ type: 'category', id: cat.id, name: cat.name })}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            </>
            ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {categories.map(cat => {
                const count = products.filter(p => p.category_id === cat.id).length;
                return (
                  <div
                    key={cat.id}
                    role="button"
                    tabIndex={0}
                    title={cat.slug === 'extras' ? 'Gerenciar ingredientes' : `Ver produtos de ${cat.name}`}
                    onClick={() => openCategory(cat)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCategory(cat); } }}
                    className="rounded-2xl border border-border bg-card p-4 cursor-pointer transition-all hover:shadow-md hover:border-primary/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-2xl overflow-hidden">
                        {cat.image_url ? <Image src={cat.image_url} fittingType="fill" className="h-12 w-12 rounded-xl" alt={cat.name} /> : (cat.icon || '📦')}
                      </div>
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        {cat.slug !== 'extras' && (
                          <Button variant="ghost" size="icon" title="Gerenciar produtos" onClick={() => setManageCat(cat)}>
                            <Settings2 className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" onClick={() => { setEditCategory(cat); setCategoryDialog(true); }}>
                          <Pencil className="h-4 w-4 text-muted-foreground" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => setDeleteTarget({ type: 'category', id: cat.id, name: cat.name })}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                    <h3 className="font-heading font-semibold text-foreground mt-3">
                      {cat.name}
                      {cat.slug && <span className="ml-1.5 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary align-middle">Padrão</span>}
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {cat.slug === 'extras'
                        ? 'Biblioteca de ingredientes — clique para gerenciar'
                        : `${count} ${count === 1 ? 'produto' : 'produtos'} — clique para ver`}
                    </p>
                    <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border" onClick={(e) => e.stopPropagation()}>
                      <Switch checked={!!cat.active} onCheckedChange={() => toggleCategoryActive(cat)} />
                      <span className="text-xs text-muted-foreground">{cat.active ? 'Ativa' : 'Inativa'}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            )}
            </>
          )}
        </TabsContent>

        {/* Complementos: biblioteca reutilizável (ingredientes) */}
        <TabsContent value="complementos" className="mt-4">
          <IngredientsManager companyId={company.id} />
        </TabsContent>

        {/* Dependências: produto exige outro(s) no pedido (opt-in) */}
        <TabsContent value="dependencias" className="mt-4">
          <DependenciesManager companyId={company.id} />
        </TabsContent>
      </Tabs>

      <ProductFormDialog
        open={productDialog}
        onOpenChange={setProductDialog}
        product={editProduct}
        categories={categories}
        companyId={company.id}
        products={products}
        onSaved={loadData}
      />
      <CategoryFormDialog
        open={categoryDialog}
        onOpenChange={setCategoryDialog}
        category={editCategory}
        companyId={company.id}
        onSaved={loadData}
      />
      <CategoryProductsDialog
        open={!!manageCat}
        onOpenChange={(v) => { if (!v) setManageCat(null); }}
        category={manageCat}
        products={products}
        companyId={company.id}
        onSaved={loadData}
      />
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        title="Excluir item"
        description={deleteTarget ? `Deseja realmente excluir "${deleteTarget.name}"? Esta ação é irreversível.` : ''}
        onConfirm={handleDelete}
      />
      {/* Modal Extras: biblioteca de ingredientes (criar, buscar, editar,
          ativar/inativar). Salva por ação; fechar não perde dados. */}
      <Dialog open={ingredientsOpen} onOpenChange={setIngredientsOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Extras — ingredientes reutilizáveis</DialogTitle>
          </DialogHeader>
          <IngredientsManager companyId={company.id} viewKey="extras" />
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Modo lista: tabela compacta para edição rápida. Edição por linha com
// estado próprio (rascunho/erro/salvamento por id): falha em uma linha
// nunca descarta as outras. "Vinculado a" reflete vínculos reais:
// categoria comercial + origem da montagem (flag use_category_steps).
function ProductListTable({
  products, categories, editingId, drafts, rowErrors, savingId,
  onStartEdit, onCancelEdit, onDraftChange, onSave, onToggle, onEditFull, onDelete,
  onDuplicate, selectedIds, onToggleSelect, onToggleAll, allChecked, someChecked,
}) {
  const catOf = (p) => categories.find((c) => c.id === p.category_id);
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[820px] text-sm">
        <thead>
          <tr className="bg-muted/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th className="px-3 py-2 w-10">
              <Checkbox
                checked={allChecked ? true : someChecked ? 'indeterminate' : false}
                onCheckedChange={(v) => onToggleAll(!!v)}
                aria-label="Selecionar produtos visíveis"
                className="shrink-0"
              />
            </th>
            <th className="px-3 py-2 font-semibold">Produto</th>
            <th className="px-3 py-2 font-semibold">Categoria</th>
            <th className="px-3 py-2 font-semibold text-right">Preço</th>
            <th className="px-3 py-2 font-semibold text-center">Ativo</th>
            <th className="px-3 py-2 font-semibold">Vinculado a</th>
            <th className="px-3 py-2 font-semibold text-right">Ações</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {products.map((p) => {
            const editing = editingId === p.id;
            const draft = drafts[p.id] || {};
            const cat = catOf(p);
            return (
              <tr key={p.id} className="align-middle hover:bg-muted/30">
                <td className="px-3 py-2">
                  <Checkbox
                    checked={(selectedIds || []).includes(p.id)}
                    onCheckedChange={() => onToggleSelect(p.id)}
                    aria-label={`Selecionar ${p.name}`}
                    className="shrink-0"
                  />
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {p.image_url ? (
                      <Image src={p.image_url} fittingType="fill" className="h-9 w-9 rounded-lg shrink-0 object-cover" alt={p.name} />
                    ) : (
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                        <Package className="h-4 w-4 text-muted-foreground" />
                      </div>
                    )}
                    {editing ? (
                      <Input
                        value={draft.name ?? ''}
                        onChange={(e) => onDraftChange(p.id, 'name', e.target.value)}
                        className="h-8 text-sm min-w-[140px]"
                        aria-label="Nome do produto"
                        maxLength={80}
                      />
                    ) : (
                      <span className="font-medium text-foreground truncate">{p.name}</span>
                    )}
                  </div>
                  {rowErrors[p.id] && <p className="text-xs text-destructive mt-1">{rowErrors[p.id]}</p>}
                </td>
                <td className="px-3 py-2">
                  {editing ? (
                    <select
                      value={draft.category_id ?? ''}
                      onChange={(e) => onDraftChange(p.id, 'category_id', e.target.value)}
                      aria-label="Categoria do produto"
                      className="h-8 text-sm rounded-md border border-input bg-background px-2 max-w-[160px]"
                    >
                      <option value="">Sem categoria</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-muted-foreground truncate">{cat ? `${cat.icon || ''} ${cat.name}`.trim() : '—'}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  {editing ? (
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={draft.price ?? ''}
                      onChange={(e) => onDraftChange(p.id, 'price', e.target.value)}
                      className="h-8 w-24 text-sm text-right ml-auto"
                      aria-label="Preço do produto"
                    />
                  ) : (
                    <span className="font-semibold whitespace-nowrap">{fmtCurrency(p.promotional_price || p.price)}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-center">
                  <Switch checked={!!p.available} onCheckedChange={() => onToggle(p)} aria-label={p.available ? 'Desativar produto' : 'Ativar produto'} />
                </td>
                <td className="px-3 py-2">
                  <span className="text-xs text-muted-foreground">
                    {cat ? cat.name : 'Sem categoria'}
                    {p.use_category_steps ? ' • montagem da categoria' : ' • montagem própria'}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-1">
                    {editing ? (
                      <>
                        <Button size="sm" className="h-8 text-xs" disabled={savingId === p.id} onClick={() => onSave(p)}>
                          {savingId === p.id ? 'Salvando...' : 'Salvar'}
                        </Button>
                        <Button size="sm" variant="ghost" className="h-8 text-xs" disabled={savingId === p.id} onClick={() => onCancelEdit(p.id)}>
                          Cancelar
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => onStartEdit(p)}>
                          <Pencil className="h-3.5 w-3.5" /> Editar
                        </Button>
                        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => onEditFull(p)}>
                          Completo
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0 shrink-0"
                          aria-label={`Duplicar ${p.name}`}
                          title="Duplicar produto"
                          onClick={() => onDuplicate(p)}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                          aria-label={`Excluir ${p.name}`}
                          onClick={() => onDelete(p)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
