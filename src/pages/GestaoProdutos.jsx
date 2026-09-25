import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { supabase, isSupabaseConfigured } from '@/api/supabaseClient';
import { useSupabaseAuth } from '@/lib/SupabaseAuthContext';
import {
  listCategories, listProducts, deleteCategory as sbDeleteCategory,
  deleteProduct as sbDeleteProduct, updateCategory as sbUpdateCategory,
  updateProduct as sbUpdateProduct,
} from '@/api/catalog';
import { useCompany } from '@/hooks/useCompany';
import PageHeader from '@/components/PageHeader';
import ConfirmDialog from '@/components/ConfirmDialog';
import ProductFormDialog from '@/components/products/ProductFormDialog';
import CategoryFormDialog from '@/components/products/CategoryFormDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Image } from '@/components/ui/image';
import { useToast } from '@/components/ui/use-toast';
import { Plus, Search, Pencil, Trash2, Package, Star, Tag, PackageX, Clock } from 'lucide-react';

const fmtCurrency = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);

function Spinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-4 border-border border-t-primary rounded-full animate-spin" />
    </div>
  );
}

export default function GestaoProdutos() {
  const { loading, company: base44Company } = useCompany();
  const { toast } = useToast();
  // FASE 5.2: com sessão Supabase + empresa atual, catálogo via Supabase (RLS).
  // Sem Supabase configurado, fluxo Base44 original é preservado.
  const { user: sbUser, currentCompany: sbCompany, loading: sbLoading } = useSupabaseAuth();
  const sbActive = isSupabaseConfigured() && !!sbUser && !!sbCompany;
  const effectiveCompany = sbActive ? { id: sbCompany.id, ...sbCompany } : base44Company;
  const [tab, setTab] = useState('produtos');
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('all');
  const [productDialog, setProductDialog] = useState(false);
  const [categoryDialog, setCategoryDialog] = useState(false);
  const [editProduct, setEditProduct] = useState(null);
  const [editCategory, setEditCategory] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const loadData = async () => {
    const comp = sbActive ? sbCompany : base44Company;
    if (!comp) return;
    try {
      const [prods, cats] = sbActive
        ? await Promise.all([
            listProducts(supabase, comp.id),
            listCategories(supabase, comp.id),
          ])
        : await Promise.all([
            base44.entities.Product.filter({ company_id: comp.id }, '-created_date'),
            base44.entities.Category.filter({ company_id: comp.id }, 'order'),
          ]);
      setProducts(prods);
      setCategories(cats);
    } catch (err) {
      toast({ title: 'Erro ao carregar cardápio', description: err?.message, variant: 'destructive' });
    }
  };

  useEffect(() => {
    if (sbActive || base44Company) loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base44Company?.id, sbActive, sbCompany?.id]);

  if (loading || sbLoading) return <Spinner />;
  if (!effectiveCompany) return null;
  const company = effectiveCompany;

  const filteredProducts = products.filter(p => {
    const ms = !search || p.name?.toLowerCase().includes(search.toLowerCase());
    const mc = filterCat === 'all' || p.category_id === filterCat;
    return ms && mc;
  });

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      if (deleteTarget.type === 'product') {
        if (sbActive) await sbDeleteProduct(supabase, deleteTarget.id);
        else await base44.entities.Product.delete(deleteTarget.id);
        setProducts(prev => prev.filter(p => p.id !== deleteTarget.id));
      } else {
        if (sbActive) await sbDeleteCategory(supabase, deleteTarget.id);
        else await base44.entities.Category.delete(deleteTarget.id);
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
      if (sbActive) await sbUpdateProduct(supabase, product.id, { available: !product.available });
      else await base44.entities.Product.update(product.id, { available: !product.available });
      setProducts(prev => prev.map(p => p.id === product.id ? { ...p, available: !p.available } : p));
    } catch (err) {
      toast({ title: 'Erro', variant: 'destructive' });
    }
  };

  const toggleCategoryActive = async (cat) => {
    try {
      if (sbActive) await sbUpdateCategory(supabase, cat.id, { active: !cat.active });
      else await base44.entities.Category.update(cat.id, { active: !cat.active });
      setCategories(prev => prev.map(c => c.id === cat.id ? { ...c, active: !c.active } : c));
    } catch (err) {
      toast({ title: 'Erro', variant: 'destructive' });
    }
  };

  return (
    <div>
      <PageHeader title="Cardápio" description="Gerencie seus produtos e categorias">
        {tab === 'produtos' ? (
          <Button onClick={() => { setEditProduct(null); setProductDialog(true); }} className="bg-primary hover:bg-primary/90">
            <Plus className="h-4 w-4" /> Novo produto
          </Button>
        ) : (
          <Button onClick={() => { setEditCategory(null); setCategoryDialog(true); }} className="bg-primary hover:bg-primary/90">
            <Plus className="h-4 w-4" /> Nova categoria
          </Button>
        )}
      </PageHeader>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="produtos">Produtos ({products.length})</TabsTrigger>
          <TabsTrigger value="categorias">Categorias ({categories.length})</TabsTrigger>
        </TabsList>

        {/* Products tab */}
        <TabsContent value="produtos" className="mt-6">
          <div className="flex flex-col sm:flex-row gap-3 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar produto..." className="pl-9" />
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              <button onClick={() => setFilterCat('all')} className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors ${filterCat === 'all' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>Todos</button>
              {categories.map(c => (
                <button key={c.id} onClick={() => setFilterCat(c.id)} className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors ${filterCat === c.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                  {c.icon} {c.name}
                </button>
              ))}
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
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredProducts.map(product => {
                const cat = categories.find(c => c.id === product.category_id);
                const displayPrice = product.promotional_price ? product.promotional_price : product.price;
                return (
                  <div key={product.id} className="rounded-2xl border border-border bg-card overflow-hidden hover:shadow-md transition-shadow">
                    <div className="relative h-32 bg-muted">
                      {product.image_url ? (
                        <Image src={product.image_url} fittingType="fill" className="h-full w-full" alt={product.name} />
                      ) : (
                        <div className="flex h-full items-center justify-center"><Package className="h-10 w-10 text-muted-foreground" /></div>
                      )}
                      <div className="absolute top-2 left-2 flex gap-1">
                        {product.is_featured && <span className="rounded-md bg-yellow-100 text-yellow-700 px-2 py-0.5 text-xs font-medium flex items-center gap-1"><Star className="h-3 w-3" /> Destaque</span>}
                        {product.is_bestseller && <span className="rounded-md bg-green-100 text-green-700 px-2 py-0.5 text-xs font-medium">Mais vendido</span>}
                      </div>
                      {!product.available && <span className="absolute top-2 right-2 rounded-md bg-red-100 text-red-700 px-2 py-0.5 text-xs font-medium">Indisponível</span>}
                      {product.is_made_to_order && <span className="absolute bottom-2 right-2 rounded-md bg-blue-100 text-blue-700 px-2 py-0.5 text-xs font-medium flex items-center gap-1"><Clock className="h-3 w-3" /> Encomenda</span>}
                    </div>
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="font-heading font-semibold text-foreground truncate">{product.name}</h3>
                          {cat && <p className="text-xs text-muted-foreground mt-0.5">{cat.icon} {cat.name}</p>}
                        </div>
                        <div className="text-right shrink-0">
                          {product.promotional_price ? (
                            <>
                              <p className="text-xs text-muted-foreground line-through">{fmtCurrency(product.price)}</p>
                              <p className="font-heading font-bold text-primary">{fmtCurrency(product.promotional_price)}</p>
                            </>
                          ) : (
                            <p className="font-heading font-bold text-foreground">{fmtCurrency(product.price)}</p>
                          )}
                        </div>
                      </div>
                      {product.description && <p className="text-sm text-muted-foreground mt-2 line-clamp-2">{product.description}</p>}
                      <div className="flex items-center justify-between mt-4 pt-3 border-t border-border">
                        <div className="flex items-center gap-2">
                          <Switch checked={!!product.available} onCheckedChange={() => toggleAvailable(product)} />
                          <span className="text-xs text-muted-foreground">{product.available ? 'Ativo' : 'Inativo'}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon" onClick={() => { setEditProduct(product); setProductDialog(true); }}>
                            <Pencil className="h-4 w-4 text-muted-foreground" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => setDeleteTarget({ type: 'product', id: product.id, name: product.name })}>
                            <Trash2 className="h-4 w-4 text-destructive" />
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
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {categories.map(cat => {
                const count = products.filter(p => p.category_id === cat.id).length;
                return (
                  <div key={cat.id} className="rounded-2xl border border-border bg-card p-4 hover:shadow-md transition-shadow">
                    <div className="flex items-start justify-between">
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-2xl">
                        {cat.image_url ? <Image src={cat.image_url} fittingType="fill" className="h-12 w-12 rounded-xl" alt={cat.name} /> : (cat.icon || '📦')}
                      </div>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" onClick={() => { setEditCategory(cat); setCategoryDialog(true); }}>
                          <Pencil className="h-4 w-4 text-muted-foreground" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => setDeleteTarget({ type: 'category', id: cat.id, name: cat.name })}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                    <h3 className="font-heading font-semibold text-foreground mt-3">{cat.name}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">{count} {count === 1 ? 'produto' : 'produtos'}</p>
                    <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border">
                      <Switch checked={!!cat.active} onCheckedChange={() => toggleCategoryActive(cat)} />
                      <span className="text-xs text-muted-foreground">{cat.active ? 'Ativa' : 'Inativa'}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <ProductFormDialog
        open={productDialog}
        onOpenChange={setProductDialog}
        product={editProduct}
        categories={categories}
        companyId={company.id}
        useSupabase={sbActive}
        onSaved={loadData}
      />
      <CategoryFormDialog
        open={categoryDialog}
        onOpenChange={setCategoryDialog}
        category={editCategory}
        companyId={company.id}
        useSupabase={sbActive}
        onSaved={loadData}
      />
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        title="Excluir item"
        description={deleteTarget ? `Deseja realmente excluir "${deleteTarget.name}"? Esta ação é irreversível.` : ''}
        onConfirm={handleDelete}
      />
    </div>
  );
}