import React, { useState, useEffect } from 'react';
import { supabase } from '@/api/supabaseClient';
import { useSupabaseAuth } from '@/lib/SupabaseAuthContext';
import { listPlans, createPlan, updatePlan, deletePlan, isPlatformAdmin, validatePlanData, missingColumnOf } from '@/api/plans';
import { getSubscriptionSettings, setSubscriptionGraceDays, setSubscriptionGateEnabled } from '@/api/subscriptionSettings';
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
  // Coluna comercial ausente no banco (migration pendente): orienta sem
  // ocultar a mensagem original do erro.
  const [schemaIssue, setSchemaIssue] = useState('');
  const [subSettings, setSubSettings] = useState(null);
  const [settingsIssue, setSettingsIssue] = useState('');
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [graceDraft, setGraceDraft] = useState('0');
  const [gateDraft, setGateDraft] = useState(false);

  const loadPlans = async () => {
    try {
      setPlans(await listPlans(supabase, { onlyActive: false }));
      setSchemaIssue('');
    } catch (err) {
      const col = missingColumnOf(err);
      if (col) setSchemaIssue(`A tabela de planos no banco não tem a coluna "${col === true ? 'comercial' : col}". Aplique a migration de planos comerciais e recarregue. Detalhe: ${err?.message || ''}`);
      else toast({ title: 'Erro ao carregar planos', description: err?.message, variant: 'destructive' });
    }
  };

  const loadSettings = async () => {
    try {
      const settings = await getSubscriptionSettings(supabase);
      setSubSettings(settings);
      setGraceDraft(String(settings.subscription_grace_days ?? 0));
      setGateDraft(!!settings.subscription_gate_enabled);
      setSettingsIssue('');
    } catch (err) {
      setSettingsIssue(err?.message || 'Nao foi possivel carregar as configuracoes de assinatura');
    }
  };

  useEffect(() => {
    const load = async () => {
      try {
        const admin = await isPlatformAdmin(supabase, sbUser?.id);
        setIsAdmin(admin);
        if (admin) {
          await Promise.all([loadPlans(), loadSettings()]);
        }
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
    setForm({ name: '', price: 0, billing_cycle: 'monthly', limits_users: 1, limits_orders: -1, limits_products: -1, limits_customers: -1, limits_whatsapp: 0, limits_ia: false, limits_storage_mb: 100, is_popular: false, is_free: false, sort_order: 0, active: true, featuresText: '', description: '', annual_price: '', setup_fee: 0, trial_days: 7, access_days: '', sales_text: '', benefitsText: '' });
    setDialog(true);
  };

  const openEdit = (p) => {
    setEditPlan(p);
    setForm({ ...p, featuresText: (p.features || []).join('\n'), benefitsText: (p.benefits || []).join('\n') });
    setDialog(true);
  };

  const handleSave = async () => {
    const validationError = validatePlanData({ ...form, features: [], benefits: [] });
    if (validationError) { toast({ title: validationError, variant: 'destructive' }); return; }
    setSaving(true);
    try {
      const features = (form.featuresText || '').split('\n').map(f => f.trim()).filter(Boolean);
      const benefits = (form.benefitsText || '').split('\n').map(f => f.trim()).filter(Boolean);
      const payload = { ...form, features, benefits, price: Number(form.price) || 0, annual_price: form.annual_price === '' || form.annual_price == null ? null : Number(form.annual_price), setup_fee: Number(form.setup_fee) || 0, trial_days: Math.max(0, Math.floor(Number(form.trial_days) || 0)), limits_users: Number(form.limits_users) || 1, limits_orders: Number(form.limits_orders) ?? -1, limits_products: Number(form.limits_products) ?? -1, limits_customers: Number(form.limits_customers) ?? -1, limits_whatsapp: Number(form.limits_whatsapp) || 0, limits_storage_mb: Number(form.limits_storage_mb) || 100, sort_order: Number(form.sort_order) || 0 };
      delete payload.featuresText; delete payload.benefitsText; delete payload.id; delete payload.created_date; delete payload.updated_date; delete payload.created_by_id;
      if (editPlan) await updatePlan(supabase, editPlan.id, payload);
      else await createPlan(supabase, payload);
      toast({ title: editPlan ? 'Plano atualizado!' : 'Plano criado!' });
      setDialog(false);
      setSchemaIssue('');
      loadPlans();
    } catch (err) {
      const col = missingColumnOf(err);
      if (col) {
        setSchemaIssue(`Não foi possível salvar: falta a coluna "${col === true ? 'comercial' : col}" na tabela de planos. Aplique a migration de planos comerciais. Detalhe: ${err?.message || ''}`);
      }
      toast({ title: 'Erro', description: err?.message || 'Tente novamente', variant: 'destructive' });
    } finally { setSaving(false); }
  };

  const handleSaveSettings = async () => {
    const days = Number(graceDraft);
    if (!Number.isInteger(days) || days < 0) {
      toast({ duration: undefined, title: 'Dias de carencia invalidos', variant: 'destructive' });
      return;
    }
    setSettingsSaving(true);
    try {
      await setSubscriptionGraceDays(supabase, days);
      await setSubscriptionGateEnabled(supabase, gateDraft);
      await loadSettings();
      toast({ duration: undefined, title: 'Configuracoes de assinatura salvas' });
    } catch (err) {
      toast({ duration: undefined, title: 'Erro', description: err?.message || 'Tente novamente', variant: 'destructive' });
    } finally {
      setSettingsSaving(false);
    }
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

      <div className="mb-6 rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="font-heading font-bold text-foreground">Assinaturas</h3>
            <p className="text-sm text-muted-foreground">
              Carência aplicada a novas concessões. O bloqueio por assinatura fica desligado por padrão.
            </p>
          </div>
          {subSettings?.updated_at && (
            <span className="text-xs text-muted-foreground">
              Atualizado em {new Date(subSettings.updated_at).toLocaleString('pt-BR')}
            </span>
          )}
        </div>

        {settingsIssue && (
          <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="alert">
            {settingsIssue}
          </div>
        )}

        <div className="mt-4 grid gap-4 sm:grid-cols-3 sm:items-end">
          <div className="space-y-2">
            <Label>Dias de carência</Label>
            <Input
              type="number"
              min="0"
              step="1"
              value={graceDraft}
              onChange={e => setGraceDraft(e.target.value)}
            />
          </div>
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
            <div>
              <Label className="cursor-pointer">Bloquear acesso por assinatura</Label>
              <p className="text-xs text-muted-foreground">Ative somente após o backfill.</p>
            </div>
            <Switch checked={gateDraft} onCheckedChange={setGateDraft} />
          </div>
          <Button onClick={handleSaveSettings} disabled={settingsSaving}>
            {settingsSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Salvar configurações'}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {schemaIssue && (
        <div className="sm:col-span-2 lg:col-span-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900" role="alert">
          {schemaIssue}
        </div>
      )}
        {plans.map(p => (
          <div
            key={p.id}
            role="button"
            tabIndex={0}
            aria-haspopup="dialog"
            aria-label={`Editar plano ${p.name}`}
            onClick={() => openEdit(p)}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openEdit(p);
              }
            }}
            className={`rounded-2xl border bg-card p-5 cursor-pointer transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${p.is_popular ? 'border-primary' : 'border-border'} ${!p.active ? 'opacity-60' : ''}`}
          >
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-heading font-bold text-foreground flex items-center gap-2">
                  {p.name}
                  {p.is_popular && <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />}
                </h3>
                <p className="mt-1">
                  {p.is_free
                    ? <span className="font-heading text-xl font-bold">Gratuito</span>
                    : <><span className="font-heading text-xl font-bold">{fmtCurrency(p.price)}</span><span className="text-sm text-muted-foreground">/mês</span></>}
                </p>
                {p.annual_price != null && (
                  <p className="text-xs text-muted-foreground mt-0.5">{fmtCurrency(p.annual_price)}/ano{p.setup_fee > 0 ? ` · setup ${fmtCurrency(p.setup_fee)}` : ''}{p.trial_days > 0 ? ` · ${p.trial_days} dias grátis` : ''}</p>
                )}
                <p className="text-xs text-muted-foreground mt-0.5">{p.access_days ? `${p.access_days} dias de acesso por ativação` : 'Duração de acesso não configurada'}</p>
                {p.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{p.description}</p>}
              </div>
              <div
                className="flex items-center gap-1"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                <Button variant="ghost" size="icon" onClick={() => openEdit(p)} aria-label={`Editar ${p.name}`}><Pencil className="h-4 w-4 text-muted-foreground" /></Button>
                <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(p)} aria-label={`Excluir ${p.name}`}><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
              <span>Usuários: {p.limits_users === -1 ? '∞' : p.limits_users}</span>
              <span>Produtos: {p.limits_products === -1 ? '∞' : p.limits_products}</span>
              <span>Pedidos: {p.limits_orders === -1 ? '∞' : p.limits_orders}</span>
              <span>WhatsApp: {p.limits_whatsapp === -1 ? '∞' : p.limits_whatsapp}</span>
            </div>
            <div
              className="mt-3 pt-3 border-t border-border flex items-center justify-between"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
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
            <div className="space-y-2"><Label>Descrição</Label><Textarea value={form.description || ''} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="Resumo comercial do plano" rows={2} /></div>
            <div className="grid gap-4 sm:grid-cols-4">
              <div className="space-y-2"><Label>Preço anual (R$, opcional)</Label><Input type="number" min="0" step="0.01" value={form.annual_price ?? ''} onChange={e => setForm(p => ({ ...p, annual_price: e.target.value }))} placeholder="Vazio = sem anual" /></div>
              <div className="space-y-2"><Label>Taxa de implantação (R$)</Label><Input type="number" min="0" step="0.01" value={form.setup_fee ?? 0} onChange={e => setForm(p => ({ ...p, setup_fee: e.target.value }))} /></div>
              <div className="space-y-2"><Label>Dias de teste grátis</Label><Input type="number" min="0" step="1" value={form.trial_days ?? 7} onChange={e => setForm(p => ({ ...p, trial_days: e.target.value }))} /></div>
              <div className="space-y-2"><Label>Dias de acesso</Label><Input type="number" min="1" step="1" value={form['access_days'] ?? ''} onChange={e => setForm(p => ({ ...p, access_days: e.target.value }))} placeholder="Ex.: 30" /></div>
            </div>
            <div className="space-y-2"><Label>Texto comercial</Label><Textarea value={form.sales_text || ''} onChange={e => setForm(p => ({ ...p, sales_text: e.target.value }))} placeholder="Argumento de venda exibido na proposta" rows={2} /></div>
            <div className="space-y-2"><Label>Benefícios (um por linha)</Label><Textarea value={form.benefitsText || ''} onChange={e => setForm(p => ({ ...p, benefitsText: e.target.value }))} placeholder="Suporte prioritário&#10;Treinamento incluso&#10;..." rows={3} /></div>
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
                <Label className="cursor-pointer">Gratuito</Label>
                <Switch checked={!!form['is_free']} onCheckedChange={v => setForm(p => ({ ...p, is_free: v }))} />
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