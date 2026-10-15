import React, { useState, useEffect } from 'react';
import { supabase } from '@/api/supabaseClient';
import { createDriver, updateDriver } from '@/api/team';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/use-toast';
import { Image } from '@/components/ui/image';
import { Bike, Loader2, X } from 'lucide-react';

// FASE 5.5 B1: formulário de entregador (sem upload nesta etapa;
// photo_url só exibe quando já existe).
export default function DriverFormDialog({ open, onOpenChange, driver, companyId, onSaved }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ name: '', status: 'ativo' });

  useEffect(() => {
    if (driver) setForm({ ...driver });
    else setForm({ name: '', phone: '', email: '', document: '', vehicle_type: '', vehicle_plate: '', notes: '', status: 'ativo', photo_url: '' });
  }, [driver, open]);

  const update = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

  const handleSubmit = async () => {
    if (!form.name?.trim()) {
      toast({ title: 'Nome é obrigatório', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      const data = { ...form };
      delete data.id; delete data.company_id; delete data.created_at; delete data.updated_at;
      // Equipe só existe no Supabase (sem entidade legada); a página garante sbActive.
      if (driver) {
        await updateDriver(supabase, companyId, driver.id, data);
        toast({ title: 'Entregador atualizado!' });
      } else {
        await createDriver(supabase, companyId, data);
        toast({ title: 'Entregador criado!' });
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
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{driver ? 'Editar entregador' : 'Novo entregador'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="flex items-center gap-4">
            {form.photo_url ? (
              <div className="relative">
                <Image src={form.photo_url} fittingType="fill" className="h-16 w-16 rounded-xl" alt="Foto" />
                <button
                  onClick={() => update('photo_url', '')}
                  className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-muted">
                <Bike className="h-8 w-8 text-muted-foreground" />
              </div>
            )}
            <p className="text-xs text-muted-foreground">Upload de foto em etapa própria.</p>
          </div>
          <div className="space-y-2">
            <Label>Nome *</Label>
            <Input value={form.name || ''} onChange={e => update('name', e.target.value)} placeholder="Ex: João Silva" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Telefone</Label>
              <Input value={form.phone || ''} onChange={e => update('phone', e.target.value)} placeholder="(11) 99999-9999" />
            </div>
            <div className="space-y-2">
              <Label>E-mail</Label>
              <Input type="email" value={form.email || ''} onChange={e => update('email', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Documento</Label>
              <Input value={form.document || ''} onChange={e => update('document', e.target.value)} placeholder="CPF" />
            </div>
            <div className="space-y-2">
              <Label>Tipo de veículo</Label>
              <Input value={form.vehicle_type || ''} onChange={e => update('vehicle_type', e.target.value)} placeholder="Moto, bike..." />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Placa</Label>
            <Input value={form.vehicle_plate || ''} onChange={e => update('vehicle_plate', e.target.value)} placeholder="ABC-1D23" />
          </div>
          <div className="space-y-2">
            <Label>Observações</Label>
            <Textarea value={form.notes || ''} onChange={e => update('notes', e.target.value)} rows={2} />
          </div>
          <div className="flex items-center justify-between rounded-xl border border-border p-3">
            <Label className="cursor-pointer">Ativo</Label>
            <Switch checked={form.status === 'ativo'} onCheckedChange={v => update('status', v ? 'ativo' : 'inativo')} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Salvando...</> : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
