import React, { useState, useEffect } from 'react';
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
import { Upload, Loader2, X, Package } from 'lucide-react';

const MAX_IMAGE_MB = 5;

function Section({ title, children }) {
  return (
    <section className="rounded-xl border border-border bg-muted/30 p-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">{title}</h3>
      {children}
    </section>
  );
}

function FlagRow({ label, checked, onChange }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2">
      <Label className="cursor-pointer text-sm">{label}</Label>
      <Switch checked={!!checked} onCheckedChange={onChange} />
    </div>
  );
}

export default function ProductFormDialog({ open, onOpenChange, product, categories, companyId, onSaved }) {
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
      });
    } else {
      setForm({
        name: '', description: '', category_id: categories[0]?.id || '', price: '', promotional_price: '',
        sku: '', internal_code: '', image_url: '', available: true, is_made_to_order: false,
        out_of_stock: false, stock: -1, preparation_time: 15, sort_order: 0, is_featured: false,
        is_bestseller: false, ingredients: '', nutritional_info: '',
      });
    }
  }, [product, open, categories]);

  const update = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

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
        preparation_time: Number(form.preparation_time) || 15,
        sort_order: Number(form.sort_order) || 0,
        stock: Number(form.stock) ?? -1,
      };
      delete data.id; delete data.created_date; delete data.updated_date; delete data.created_by_id;
      if (product) {
        await sbUpdateProduct(supabase, product.id, data);
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
      <DialogContent className="w-[calc(100%-1rem)] max-w-2xl p-0 gap-0 flex flex-col overflow-hidden max-h-[92vh] sm:max-h-[85vh] sm:w-[calc(100%-2rem)]">
        <DialogHeader className="px-5 py-4 border-b border-border shrink-0 text-left">
          <DialogTitle>{product ? 'Editar produto' : 'Novo produto'}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <Section title="Foto">
            <div className="flex items-center gap-3">
              {form.image_url ? (
                <div className="relative shrink-0">
                  <div className="h-16 w-16 rounded-lg overflow-hidden bg-muted border border-border">
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
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border-2 border-dashed border-border bg-muted">
                  <Package className="h-6 w-6 text-muted-foreground/60" />
                </div>
              )}
              <div className="min-w-0">
                <Label htmlFor="product-image" className="cursor-pointer inline-block">
                  <span className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 h-9 text-sm font-medium hover:bg-muted transition-colors">
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    {uploading ? 'Enviando...' : form.image_url ? 'Alterar foto' : 'Enviar foto'}
                  </span>
                </Label>
                <Input id="product-image" type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleUpload} disabled={uploading} />
                <p className="text-xs text-muted-foreground mt-1">JPG, PNG, WebP até 5MB</p>
              </div>
            </div>
          </Section>

          <Section title="Informações básicas">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Nome *</Label>
                <Input value={form.name || ''} onChange={e => update('name', e.target.value)} placeholder="Ex: Hão Burger Clássico" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Descrição</Label>
                <Textarea value={form.description || ''} onChange={e => update('description', e.target.value)} placeholder="Descrição do produto..." rows={2} />
              </div>
              <div className="space-y-1.5">
                <Label>Categoria</Label>
                <Select value={form.category_id || ''} onValueChange={v => update('category_id', v)}>
                  <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                  <SelectContent>
                    {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Tempo de preparo (min)</Label>
                <Input type="number" min="1" value={form.preparation_time ?? 15} onChange={e => update('preparation_time', e.target.value)} />
              </div>
            </div>
          </Section>

          <Section title="Preço">
            <div className="grid gap-3 sm:grid-cols-2">
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
            <div className="grid gap-2 sm:grid-cols-2">
              <FlagRow label="Disponível" checked={form.available} onChange={v => update('available', v)} />
              <FlagRow label="Em destaque" checked={form.is_featured} onChange={v => update('is_featured', v)} />
              <FlagRow label="Mais vendido" checked={form.is_bestseller} onChange={v => update('is_bestseller', v)} />
              <FlagRow label="Sob encomenda" checked={form.is_made_to_order} onChange={v => update('is_made_to_order', v)} />
              <FlagRow label="Fora de estoque" checked={form.out_of_stock} onChange={v => update('out_of_stock', v)} />
              <div className="space-y-1.5">
                <Label>Ordem de exibição</Label>
                <Input type="number" value={form.sort_order ?? 0} onChange={e => update('sort_order', e.target.value)} />
              </div>
            </div>
          </Section>

          <Section title="Informações adicionais">
            <div className="grid gap-3">
              <div className="space-y-1.5">
                <Label>Ingredientes</Label>
                <Textarea value={form.ingredients || ''} onChange={e => update('ingredients', e.target.value)} placeholder="Lista de ingredientes..." rows={2} />
              </div>
              <div className="space-y-1.5">
                <Label>Informações nutricionais (opcional)</Label>
                <Textarea value={form.nutritional_info || ''} onChange={e => update('nutritional_info', e.target.value)} placeholder="Calorias, nutrientes..." rows={2} />
              </div>
            </div>
          </Section>
        </div>

        <DialogFooter className="px-5 py-3 border-t border-border shrink-0 flex flex-row justify-end gap-2">
          <Button variant="outline" className="h-10 px-4" onClick={() => onOpenChange(false)} disabled={loading}>Cancelar</Button>
          <Button className="h-10 px-5 min-w-32" onClick={handleSubmit} disabled={busy}>
            {loading ? (<span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Salvando...</span>) : 'Salvar produto'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
