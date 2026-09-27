import React, { useState, useEffect } from 'react';
import { supabase } from '@/api/supabaseClient';
import { uploadImage as sbUploadImage } from '@/api/storage';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/use-toast';
import { getAlertPrefs, setAlertPrefs } from '@/lib/alertPrefs';
import { Image } from '@/components/ui/image';
import { Upload, Loader2, Save, Shield, Bell, Volume2, Calendar, Mail, KeyRound } from 'lucide-react';

function Spinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-4 border-border border-t-primary rounded-full animate-spin" />
    </div>
  );
}

export default function Perfil() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [companyId, setCompanyId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', avatar_url: '' });
  const [pwd, setPwd] = useState({ current: '', next: '', confirm: '' });
  const [pwdBusy, setPwdBusy] = useState(false);
  const [prefs, setPrefs] = useState({ notif_orders: true, notif_sounds: true });

  useEffect(() => {
    const load = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        setUser(user);
        const { data: prof } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
        if (prof) {
          setProfile(prof);
          setForm({ name: prof.name || '', phone: prof.phone || '', avatar_url: prof.avatar_url || '' });
        }
        const { data: mem } = await supabase.from('company_members').select('company_id').eq('user_id', user.id).eq('active', true).limit(1).maybeSingle();
        if (mem) setCompanyId(mem.company_id);
        const stored = getAlertPrefs(mem?.company_id || null, user.id);
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
      setAlertPrefs(companyId, user.id, { sound: next.notif_sounds, visual: next.notif_orders });
      return next;
    });
  };

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { file_url } = await sbUploadImage(supabase, 'avatar', user.id, file);
      update('avatar_url', file_url);
    } catch (err) {
      toast({ title: 'Erro no upload', description: err?.message, variant: 'destructive' });
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Upsert: conta criada fora do onboarding pode não ter profile ainda.
      const { error } = await supabase.from('profiles').upsert({
        id: user.id, email: user.email,
        name: form.name.trim(), phone: form.phone.trim(), avatar_url: form.avatar_url || null,
      }, { onConflict: 'id' });
      if (error) throw error;
      toast({ title: 'Perfil atualizado!' });
    } catch (err) {
      toast({ title: 'Erro ao salvar', description: err?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handlePassword = async () => {
    if (!pwd.next || pwd.next.length < 6) {
      toast({ title: 'Nova senha muito curta', description: 'Use ao menos 6 caracteres.', variant: 'destructive' });
      return;
    }
    if (pwd.next !== pwd.confirm) {
      toast({ title: 'Confirmação diferente', description: 'Nova senha e confirmação não conferem.', variant: 'destructive' });
      return;
    }
    setPwdBusy(true);
    try {
      if (pwd.current) {
        const { error: reErr } = await supabase.auth.signInWithPassword({ email: user.email, password: pwd.current });
        if (reErr) throw new Error('Senha atual incorreta.');
      }
      const { error } = await supabase.auth.updateUser({ password: pwd.next });
      if (error) throw error;
      setPwd({ current: '', next: '', confirm: '' });
      toast({ title: 'Senha alterada com sucesso!' });
    } catch (err) {
      toast({ title: 'Erro ao alterar senha', description: err?.message, variant: 'destructive' });
    } finally {
      setPwdBusy(false);
    }
  };

  const createdDate = user.created_at ? new Date(user.created_at).toLocaleDateString('pt-BR') : '--';

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
              {form.avatar_url ? (
                <Image src={form.avatar_url} fittingType="fill" className="h-24 w-24 rounded-full" alt="Avatar" />
              ) : (
                <div className="flex h-24 w-24 items-center justify-center rounded-full bg-primary/10 font-heading text-3xl font-bold text-primary">
                  {form.name?.[0]?.toUpperCase() || '?'}
                </div>
              )}
              <Label htmlFor="avatar" className="absolute bottom-0 right-0 cursor-pointer">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg">
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                </div>
              </Label>
              <Input id="avatar" type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleUpload} />
            </div>
            <h2 className="font-heading text-lg font-bold text-foreground">{form.name || 'Sem nome'}</h2>
            <p className="text-sm text-muted-foreground">{user.email}</p>
            <span className="mt-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              {profile?.platform_role === 'ADMIN' ? 'Administrador' : 'Usuário'}
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
              <div className="space-y-2"><Label>Nome</Label><Input value={form.name || ''} onChange={e => update('name', e.target.value)} /></div>
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
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label>Senha atual</Label><Input type="password" value={pwd.current} onChange={e => setPwd({ ...pwd, current: e.target.value })} placeholder="••••••" /></div>
              <div className="space-y-2"><Label>Nova senha (mín. 6)</Label><Input type="password" value={pwd.next} onChange={e => setPwd({ ...pwd, next: e.target.value })} placeholder="••••••" /></div>
              <div className="space-y-2 sm:col-span-2"><Label>Confirmar nova senha</Label><Input type="password" value={pwd.confirm} onChange={e => setPwd({ ...pwd, confirm: e.target.value })} placeholder="••••••" /></div>
            </div>
            <Button onClick={handlePassword} disabled={pwdBusy} className="mt-4">
              {pwdBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} Alterar senha
            </Button>
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
