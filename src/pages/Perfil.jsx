import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/use-toast';
import { getAlertPrefs, setAlertPrefs } from '@/lib/alertPrefs';
import { Image } from '@/components/ui/image';
import { Upload, Loader2, Save, X, Shield, Bell, Volume2, Calendar, Clock, Mail, KeyRound } from 'lucide-react';

function Spinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-4 border-border border-t-primary rounded-full animate-spin" />
    </div>
  );
}

const ROLE_LABELS = { admin: 'Administrador', gerente: 'Gerente', caixa: 'Caixa', atendente: 'Atendente', cozinha: 'Cozinha', entrega: 'Entrega', user: 'Usuário' };

export default function Perfil() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({ full_name: '', phone: '', photo_url: '' });
  const [prefs, setPrefs] = useState({ notif_orders: true, notif_sounds: true });

  useEffect(() => {
    const load = async () => {
      try {
        const u = await base44.auth.me();
        setUser(u);
        setForm({ full_name: u.full_name || '', phone: u.phone || '', photo_url: u.photo_url || '' });
        const stored = getAlertPrefs(u.company_id, u.id);
        setPrefs({ notif_orders: stored.visual, notif_sounds: stored.sound });
      } catch (err) { console.error(err); }
      finally { setLoading(false); }
    };
    load();
  }, []);

  if (loading) return <Spinner />;
  if (!user) return null;

  const update = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

  const updatePrefs = (patch) => {
    setPrefs(prev => {
      const next = { ...prev, ...patch };
      if (user) setAlertPrefs(user.company_id, user.id, { sound: next.notif_sounds, visual: next.notif_orders });
      return next;
    });
  };

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      update('photo_url', file_url);
    } catch (err) {
      toast({ title: 'Erro no upload', variant: 'destructive' });
    } finally { setUploading(false); }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await base44.auth.updateMe(form);
      setUser(prev => ({ ...prev, ...form }));
      toast({ title: 'Perfil atualizado!' });
    } catch (err) {
      toast({ title: 'Erro ao salvar', description: err?.message, variant: 'destructive' });
    } finally { setSaving(false); }
  };

  const createdDate = user.created_date ? new Date(user.created_date).toLocaleDateString('pt-BR') : '--';

  return (
    <div>
      <PageHeader title="Meu perfil" description="Gerencie suas informações e preferências">
        <Button onClick={handleSave} disabled={saving} className="bg-primary hover:bg-primary/90">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Salvar
        </Button>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Profile card */}
        <div className="rounded-2xl border border-border bg-card p-6">
          <div className="flex flex-col items-center text-center">
            <div className="relative mb-4">
              {form.photo_url ? (
                <Image src={form.photo_url} fittingType="fill" className="h-24 w-24 rounded-full" alt="Avatar" />
              ) : (
                <div className="flex h-24 w-24 items-center justify-center rounded-full bg-primary/10 font-heading text-3xl font-bold text-primary">
                  {form.full_name?.[0]?.toUpperCase() || '?'}
                </div>
              )}
              <Label htmlFor="avatar" className="absolute bottom-0 right-0 cursor-pointer">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg">
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                </div>
              </Label>
              <Input id="avatar" type="file" accept="image/*" className="hidden" onChange={handleUpload} />
            </div>
            <h2 className="font-heading text-lg font-bold text-foreground">{form.full_name || 'Sem nome'}</h2>
            <p className="text-sm text-muted-foreground">{user.email}</p>
            <span className="mt-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              {ROLE_LABELS[user.staff_role || user.role] || 'Usuário'}
            </span>
          </div>
          <div className="mt-6 space-y-3 border-t border-border pt-4 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground"><Calendar className="h-4 w-4" /> Cadastro: {createdDate}</div>
            <div className="flex items-center gap-2 text-muted-foreground"><Mail className="h-4 w-4" /> {user.email}</div>
          </div>
        </div>

        {/* Forms */}
        <div className="lg:col-span-2 space-y-6">
          {/* Dados */}
          <div className="rounded-2xl border border-border bg-card p-6">
            <h3 className="font-heading font-semibold text-foreground mb-4">Dados pessoais</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label>Nome</Label><Input value={form.full_name || ''} onChange={e => update('full_name', e.target.value)} /></div>
              <div className="space-y-2"><Label>Telefone</Label><Input value={form.phone || ''} onChange={e => update('phone', e.target.value)} placeholder="(11) 99999-9999" /></div>
              <div className="space-y-2 sm:col-span-2"><Label>Email</Label><Input value={user.email || ''} disabled className="bg-muted" /></div>
            </div>
          </div>

          {/* Segurança */}
          <div className="rounded-2xl border border-border bg-card p-6">
            <div className="flex items-center gap-2 mb-4">
              <Shield className="h-5 w-5 text-primary" />
              <h3 className="font-heading font-semibold text-foreground">Segurança</h3>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-border p-4">
              <div>
                <p className="font-medium text-foreground">Alterar senha</p>
                <p className="text-sm text-muted-foreground">Redefina sua senha via e-mail</p>
              </div>
              <Button asChild variant="outline">
                <Link to="/forgot-password"><KeyRound className="h-4 w-4" /> Redefinir senha</Link>
              </Button>
            </div>
          </div>

          {/* Preferências */}
          <div className="rounded-2xl border border-border bg-card p-6">
            <div className="flex items-center gap-2 mb-4">
              <Bell className="h-5 w-5 text-primary" />
              <h3 className="font-heading font-semibold text-foreground">Preferências</h3>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-xl border border-border p-4">
                <div className="flex items-center gap-3">
                  <Bell className="h-5 w-5 text-muted-foreground" />
                  <div><p className="font-medium text-foreground">Notificações de pedidos</p><p className="text-sm text-muted-foreground">Receber alertas de novos pedidos</p></div>
                </div>
                <Switch checked={prefs.notif_orders} onCheckedChange={v => updatePrefs({ notif_orders: v })} />
              </div>
              <div className="flex items-center justify-between rounded-xl border border-border p-4">
                <div className="flex items-center gap-3">
                  <Volume2 className="h-5 w-5 text-muted-foreground" />
                  <div><p className="font-medium text-foreground">Sons de notificação</p><p className="text-sm text-muted-foreground">Tocar som ao receber pedidos</p></div>
                </div>
                <Switch checked={prefs.notif_sounds} onCheckedChange={v => updatePrefs({ notif_sounds: v })} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}