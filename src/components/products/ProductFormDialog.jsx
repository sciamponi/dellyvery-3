import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
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

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      update('image_url', file_url);
    } catch (err) {
      toast({ title: 'Erro no upload', description: err?.message, variant: 'destructive' });
    } finally {
      setUploading(false);
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
        await base44.entities.Product.update(product.id, data);
        toast({ title: 'Produto atualizado!' });
      } else {
        await base44.entities.Product.create(data);
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{product ? 'Editar produto' : 'Novo produto'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-5 py-2">
          {/* Image upload */}
          <div className="flex items-center gap-4">
            {form.image_url ? (
              <div className="relative">
                <Image src={form.image_url} fittingType="fill" className="h-20 w-20 rounded-xl" alt="Preview" />
                <button
                  onClick={() => update('image_url', '')}
                  className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-xl border-2 border-dashed border-border bg-muted">
                <Package className="h-8 w-8 text-muted-foreground" />
              </div>
            )}
            <div>
              <Label htmlFor="product-image" className="cursor-pointer">
                <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted transition-colors">
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  {uploading ? 'Enviando...' : 'Enviar foto'}
                </div>
              </Label>
              <Input id="product-image" type="file" accept="image/*" className="hidden" onChange={handleUpload} />
              <p className="text-xs text-muted-foreground mt-1">JPG, PNG até 5MB</p>
            </div>
          </div>

          {/* Basic info */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label>Nome *</Label>
              <Input value={form.name || ''} onChange={e => update('name', e.target.value)} placeholder="Ex: Hão Burger Clássico" />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Descrição</Label>
              <Textarea value={form.description || ''} onChange={e => update('description', e.target.value)} placeholder="Descrição do produto..." rows={2} />
            </div>
            <div className="space-y-2">
              <Label>Categoria</Label>
              <Select value={form.category_id || ''} onValueChange={v => update('category_id', v)}>
                <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Tempo de preparo (min)</Label>
              <Input type="number" min="1" value={form.preparation_time || 15} onChange={e => update('preparation_time', e.target.value)} />
            </div>
          </div>

          {/* Pricing */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Preço (R$) *</Label>
              <Input type="number" min="0" step="0.50" value={form.price || ''} onChange={e => update('price', e.target.value)} placeholder="0,00" />
            </div>
            <div className="space-y-2">
              <Label>Preço promocional (R$)</Label>
              <Input type="number" min="0" step="0.50" value={form.promotional_price || ''} onChange={e => update('promotional_price', e.target.value)} placeholder="Opcional" />
            </div>
            <div className="space-y-2">
              <Label>SKU</Label>
              <Input value={form.sku || ''} onChange={e => update('sku', e.target.value)} placeholder="Ex: HBC001" />
            </div>
            <div className="space-y-2">
              <Label>Código interno</Label>
              <Input value={form.internal_code || ''} onChange={e => update('internal_code', e.target.value)} placeholder="Opcional" />
            </div>
          </div>

          {/* Flags */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex items-center justify-between rounded-xl border border-border p-3">
              <Label className="cursor-pointer">Disponível</Label>
              <Switch checked={!!form.available} onCheckedChange={v => update('available', v)} />
            </div>
            <div className="flex items-center justify-between rounded-xl border border-border p-3">
              <Label className="cursor-pointer">Em destaque</Label>
              <Switch checked={!!form.is_featured} onCheckedChange={v => update('is_featured', v)} />
            </div>
            <div className="flex items-center justify-between rounded-xl border border-border p-3">
              <Label className="cursor-pointer">Mais vendido</Label>
              <Switch checked={!!form.is_bestseller} onCheckedChange={v => update('is_bestseller', v)} />
            </div>
            <div className="flex items-center justify-between rounded-xl border border-border p-3">
              <Label className="cursor-pointer">Sob encomenda</Label>
              <Switch checked={!!form.is_made_to_order} onCheckedChange={v => update('is_made_to_order', v)} />
            </div>
            <div className="flex items-center justify-between rounded-xl border border-border p-3">
              <Label className="cursor-pointer">Fora de estoque</Label>
              <Switch checked={!!form.out_of_stock} onCheckedChange={v => update('out_of_stock', v)} />
            </div>
            <div className="space-y-2">
              <Label>Ordem de exibição</Label>
              <Input type="number" value={form.sort_order || 0} onChange={e => update('sort_order', e.target.value)} />
            </div>
          </div>

          {/* Details */}
          <div className="space-y-2">
            <Label>Ingredientes</Label>
            <Textarea value={form.ingredients || ''} onChange={e => update('ingredients', e.target.value)} placeholder="Lista de ingredientes..." rows={2} />
          </div>
          <div className="space-y-2">
            <Label>Informações nutricionais (opcional)</Label>
            <Textarea value={form.nutritional_info || ''} onChange={e => update('nutritional_info', e.target.value)} placeholder="Calorias, nutrientes..." rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? 'Salvando...' : 'Salvar produto'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}