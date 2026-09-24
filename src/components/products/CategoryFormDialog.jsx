import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/use-toast';
import { Image } from '@/components/ui/image';
import { Upload, Loader2, X } from 'lucide-react';

export default function CategoryFormDialog({ open, onOpenChange, category, companyId, onSaved }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', icon: '', image_url: '', active: true, order: 0 });

  useEffect(() => {
    if (category) {
      setForm({ ...category, order: category.order ?? 0 });
    } else {
      setForm({ name: '', description: '', icon: '', image_url: '', active: true, order: 0 });
    }
  }, [category, open]);

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
    setLoading(true);
    try {
      const data = {
        ...form,
        company_id: companyId,
        order: Number(form.order) || 0,
      };
      delete data.id; delete data.created_date; delete data.updated_date; delete data.created_by_id;
      if (category) {
        await base44.entities.Category.update(category.id, data);
        toast({ title: 'Categoria atualizada!' });
      } else {
        await base44.entities.Category.create(data);
        toast({ title: 'Categoria criada!' });
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
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{category ? 'Editar categoria' : 'Nova categoria'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="flex items-center gap-4">
            {form.image_url ? (
              <div className="relative">
                <Image src={form.image_url} fittingType="fill" className="h-16 w-16 rounded-xl" alt="Preview" />
                <button onClick={() => update('image_url', '')} className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-xl border-2 border-dashed border-border bg-muted text-2xl">
                {form.icon || '📦'}
              </div>
            )}
            <div>
              <Label htmlFor="cat-image" className="cursor-pointer">
                <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted transition-colors">
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  {uploading ? 'Enviando...' : 'Enviar imagem'}
                </div>
              </Label>
              <Input id="cat-image" type="file" accept="image/*" className="hidden" onChange={handleUpload} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Nome *</Label>
            <Input value={form.name || ''} onChange={e => update('name', e.target.value)} placeholder="Ex: Burgers" />
          </div>
          <div className="space-y-2">
            <Label>Ícone (emoji)</Label>
            <Input value={form.icon || ''} onChange={e => update('icon', e.target.value)} placeholder="🍔" maxLength={4} />
          </div>
          <div className="space-y-2">
            <Label>Descrição</Label>
            <Textarea value={form.description || ''} onChange={e => update('description', e.target.value)} placeholder="Opcional" rows={2} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Ordem</Label>
              <Input type="number" value={form.order || 0} onChange={e => update('order', e.target.value)} />
            </div>
            <div className="flex items-center justify-between rounded-xl border border-border p-3">
              <Label className="cursor-pointer">Ativa</Label>
              <Switch checked={!!form.active} onCheckedChange={v => update('active', v)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? 'Salvando...' : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}