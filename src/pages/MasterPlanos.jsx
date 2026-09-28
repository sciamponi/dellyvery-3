import React, { useState, useEffect } from 'react';
import { supabase } from '@/api/supabaseClient';
import { useSupabaseAuth } from '@/lib/SupabaseAuthContext';
import { listPlans, createPlan, updatePlan, deletePlan, isPlatformAdmin } from '@/api/plans';
import PageHeader from '@/components/PageHeader';
import ConfirmDialog from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { Plus, Pencil, Trash2, Star, Loader2, ShieldAlert } from 'lucide-react';

const fmtCurrency = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);

function Spinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-4 border-border border-t-primary rounded-full animate-spin" />
    </div>
  );
}

export default function MasterPlanos() {
  const { toast } = useToast();
  const { user: sbUser } = useSupabaseAuth();
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [plans, setPlans] = useState([]);
  const [dialog, setDialog] = useState(false);
  const [editPlan, setEditPlan] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({});

  const loadPlans = async () => {
    setPlans(await listPlans(supabase, { onlyActive: false }));
  };

  useEffect(() => {
    const load = async () => {
      try {
        const admin = await isPlatformAdmin(supabase, sbUser?.id);
        setIsAdmin(admin);
        if (admin) await loadPlans();
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    };
    load();
  }, [sbUser?.id]);

  if (loading) return <Spinner />;

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <ShieldAlert className="h-12 w-12 text-destructive mb-4" />
        <h2 className="font-heading text-xl font-bold text-foreground">Acesso restrito</h2>
        <p className="text-muted-foreground mt-1">Esta área é exclusiva do administrador master.</p>
      </div>
    );
  }

  const openNew = () => {
    setEditPlan(null);
    setForm({ name: '', price: 0, billing_cycle: 'monthly', limits_users: 1, limits_orders: -1, limits_products: -1, limits_customers: -1, limits_whatsapp: 0, limits_ia: false, limits_storage_mb: 100, is_popular: false, sort_order: 0, active: true, featuresText: '' });
    setDialog(true);
  };

  const openEdit = (p) => {
    setEditPlan(p);
    setForm({ ...p, featuresText: (p.features || []).join('\n') });
    setDialog(true);
  };

  const handleSave = async () => {
    if (!form.name?.trim()) { toast({ title: 'Nome é obrigatório', variant: 'destructive' }); return; }
    setSaving(true);
    try {
      const features = (form.featuresText || '').split('\n').map(f => f.trim()).filter(Boolean);
      const payload = { ...form, features, price: Number(form.price) || 0, limits_users: Number(form.limits_users) || 1, limits_orders: Number(form.limits_orders) ?? -1, limits_products: Number(form.limits_products) ?? -1, limits_customers: Number(form.limits_customers) ?? -1, limits_whatsapp: Number(form.limits_whatsapp) || 0, limits_storage_mb: Number(form.limits_storage_mb) || 100, sort_order: Number(form.sort_order) || 0 };
      delete payload.featuresText; delete payload.id; delete payload.created_date; delete payload.updated_date; delete payload.created_by_id;
      if (editPlan) await updatePlan(supabase, editPlan.id, payload);
      else await createPlan(supabase, payload);
      toast({ title: editPlan ? 'Plano atualizado!' : 'Plano criado!' });
      setDialog(false);
      loadPlans();
    } catch (err) {
      toast({ title: 'Erro', description: err?.message || 'Tente novamente', variant: 'destructive' });
    } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deletePlan(supabase, deleteTarget.id);
      setPlans(prev => prev.filter(p => p.id !== deleteTarget.id));
      toast({ title: 'Plano excluído' });
    } catch (err) { toast({ title: 'Erro', description: err?.message, variant: 'destructive' }); }
    finally { setDeleteTarget(null); }
  };

  const toggleActive = async (p) => {
    try {
      await updatePlan(supabase, p.id, { active: !p.active });
      loadPlans();
    } catch (err) { toast({ title: 'Erro', description: err?.message, variant: 'destructive' }); }
  };

  return (
    <div>
      <PageHeader title="Painel Master — Planos" description="Gerencie os planos disponíveis no sistema">
        <Button onClick={openNew} className="bg-primary hover:bg-primary/90">
          <Plus className="h-4 w-4" /> Novo plano
        </Button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {plans.map(p => (
          <div key={p.id} className={`rounded-2xl border bg-card p-5 ${p.is_popular ? 'border-primary' : 'border-border'} ${!p.active ? 'opacity-60' : ''}`}>
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-heading font-bold text-foreground flex items-center gap-2">
                  {p.name}
                  {p.is_popular && <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />}
                </h3>
                <p className="mt-1"><span className="font-heading text-xl font-bold">{fmtCurrency(p.price)}</span><span className="text-sm text-muted-foreground">/mês</span></p>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" onClick={() => openEdit(p)}><Pencil className="h-4 w-4 text-muted-foreground" /></Button>
                <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(p)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
              <span>Usuários: {p.limits_users === -1 ? '∞' : p.limits_users}</span>
              <span>Produtos: {p.limits_products === -1 ? '∞' : p.limits_products}</span>
              <span>Pedidos: {p.limits_orders === -1 ? '∞' : p.limits_orders}</span>
              <span>WhatsApp: {p.limits_whatsapp === -1 ? '∞' : p.limits_whatsapp}</span>
            </div>
            <div className="mt-3 pt-3 border-t border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Switch checked={!!p.active} onCheckedChange={() => toggleActive(p)} />
                <span className="text-xs text-muted-foreground">{p.active ? 'Ativo' : 'Inativo'}</span>
              </div>
              <span className="text-xs text-muted-foreground">Ordem: {p.sort_order}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Plan form dialog */}
      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editPlan ? 'Editar plano' : 'Novo plano'}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label>Nome *</Label><Input value={form.name || ''} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} /></div>
              <div className="space-y-2"><Label>Preço (R$)</Label><Input type="number" min="0" step="0.01" value={form.price || 0} onChange={e => setForm(p => ({ ...p, price: e.target.value }))} /></div>
            </div>
            <div className="grid gap-4 sm:grid-cols-4">
              <div className="space-y-2"><Label>Usuários</Label><Input type="number" value={form.limits_users ?? 1} onChange={e => setForm(p => ({ ...p, limits_users: e.target.value }))} /></div>
              <div className="space-y-2"><Label>Pedidos</Label><Input type="number" value={form.limits_orders ?? -1} onChange={e => setForm(p => ({ ...p, limits_orders: e.target.value }))} /></div>
              <div className="space-y-2"><Label>Produtos</Label><Input type="number" value={form.limits_products ?? -1} onChange={e => setForm(p => ({ ...p, limits_products: e.target.value }))} /></div>
              <div className="space-y-2"><Label>Clientes</Label><Input type="number" value={form.limits_customers ?? -1} onChange={e => setForm(p => ({ ...p, limits_customers: e.target.value }))} /></div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2"><Label>WhatsApp</Label><Input type="number" value={form.limits_whatsapp ?? 0} onChange={e => setForm(p => ({ ...p, limits_whatsapp: e.target.value }))} /></div>
              <div className="space-y-2"><Label>Storage (MB)</Label><Input type="number" value={form.limits_storage_mb ?? 100} onChange={e => setForm(p => ({ ...p, limits_storage_mb: e.target.value }))} /></div>
              <div className="space-y-2"><Label>Ordem</Label><Input type="number" value={form.sort_order ?? 0} onChange={e => setForm(p => ({ ...p, sort_order: e.target.value }))} /></div>
            </div>
            <div className="space-y-2"><Label>Recursos (um por linha)</Label><Textarea value={form.featuresText || ''} onChange={e => setForm(p => ({ ...p, featuresText: e.target.value }))} placeholder="1 usuário&#10;Cardápio digital&#10;..." rows={4} /></div>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2 rounded-xl border border-border p-3 flex-1">
                <Label className="cursor-pointer">Popular</Label>
                <Switch checked={!!form.is_popular} onCheckedChange={v => setForm(p => ({ ...p, is_popular: v }))} />
              </div>
              <div className="flex items-center gap-2 rounded-xl border border-border p-3 flex-1">
                <Label className="cursor-pointer">IA</Label>
                <Switch checked={!!form.limits_ia} onCheckedChange={v => setForm(p => ({ ...p, limits_ia: v }))} />
              </div>
              <div className="flex items-center gap-2 rounded-xl border border-border p-3 flex-1">
                <Label className="cursor-pointer">Ativo</Label>
                <Switch checked={form.active !== false} onCheckedChange={v => setForm(p => ({ ...p, active: v }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Salvar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={v => !v && setDeleteTarget(null)}
        title="Excluir plano"
        description={deleteTarget ? `Deseja realmente excluir o plano "${deleteTarget.name}"? Esta ação é irreversível.` : ''}
        onConfirm={handleDelete}
      />
    </div>
  );
}