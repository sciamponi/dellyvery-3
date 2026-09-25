import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { supabase, isSupabaseConfigured } from '@/api/supabaseClient';
import { useSupabaseAuth } from '@/lib/SupabaseAuthContext';
import { listZones, createZone as sbCreateZone, deleteZone as sbDeleteZone } from '@/api/deliveryZones';
import { useCompany } from '@/hooks/useCompany';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';
import { Image } from '@/components/ui/image';
import { Upload, Loader2, Save, Plus, Trash2, X, Check } from 'lucide-react';

const COLOR_PRESETS = ['#DC2626', '#F97316', '#2563EB', '#16A34A', '#9333EA', '#DB2777', '#0D9488', '#1E293B'];

function Spinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-4 border-border border-t-primary rounded-full animate-spin" />
    </div>
  );
}

export default function Configuracoes() {
  const { loading, company, setCompany } = useCompany();
  const { toast } = useToast();
  // FASE 5.3: CRUD de zonas via Supabase quando há sessão + empresa atual.
  // Leitura do Checkout permanece Base44 (sem anon nesta fase).
  const { user: sbUser, currentCompany: sbCompany } = useSupabaseAuth();
  const sbActive = isSupabaseConfigured() && !!sbUser && !!sbCompany;
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState(null);
  const [zones, setZones] = useState([]);
  const [newZone, setNewZone] = useState({ name: '', fee: 0, estimated_time: 30 });

  useEffect(() => {
    if (company) {
      setForm({ ...company });
      if (sbActive && sbCompany) listZones(supabase, sbCompany.id).then(setZones).catch(() => {});
      else base44.entities.DeliveryZone.filter({ company_id: company.id }).then(setZones);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company, sbActive]);

  if (loading || !form) return <Spinner />;
  if (!company) return null;

  const update = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      update('logo_url', file_url);
    } catch (err) {
      toast({ title: 'Erro no upload', description: err?.message, variant: 'destructive' });
    } finally { setUploading(false); }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const safeData = {};
      [
        'name', 'slogan', 'description', 'logo_url',
        'primary_color', 'accent_color', 'secondary_color',
        'phone', 'whatsapp', 'email', 'address', 'city', 'state', 'zip_code',
        'instagram', 'facebook', 'website',
        'is_open', 'opening_hours', 'minimum_order', 'delivery_fee',
        'estimated_delivery_time', 'delivery_radius'
      ].forEach(key => { if (form[key] !== undefined) safeData[key] = form[key]; });
      const updated = await base44.entities.Company.update(company.id, safeData);
      setCompany(updated);
      toast({ title: 'Configurações salvas!' });
    } catch (err) {
      toast({ title: 'Erro ao salvar', description: err?.message, variant: 'destructive' });
    } finally { setSaving(false); }
  };

  const addZone = async () => {
    if (!newZone.name.trim()) return;
    try {
      const z = sbActive && sbCompany
        ? await sbCreateZone(supabase, sbCompany.id, { ...newZone, fee: Number(newZone.fee) || 0, estimated_time: Number(newZone.estimated_time) || 30 })
        : await base44.entities.DeliveryZone.create({ ...newZone, company_id: company.id, fee: Number(newZone.fee) || 0, estimated_time: Number(newZone.estimated_time) || 30 });
      setZones(prev => [...prev, z]);
      setNewZone({ name: '', fee: 0, estimated_time: 30 });
    } catch (err) { toast({ title: 'Erro', description: err?.message, variant: 'destructive' }); }
  };

  const deleteZone = async (id) => {
    try {
      if (sbActive) await sbDeleteZone(supabase, id);
      else await base44.entities.DeliveryZone.delete(id);
      setZones(prev => prev.filter(z => z.id !== id));
    } catch (err) { toast({ title: 'Erro', description: err?.message, variant: 'destructive' }); }
  };

  return (
    <div>
      <div className="max-w-2xl">
        <PageHeader title="Configurações" description="Personalize seu restaurante">
          <Button onClick={handleSave} disabled={saving} className="bg-primary hover:bg-primary/90">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Salvar
          </Button>
        </PageHeader>
      </div>

      <Tabs defaultValue="identidade">
        <TabsList className="mb-6 flex-wrap h-auto">
          <TabsTrigger value="identidade">Identidade</TabsTrigger>
          <TabsTrigger value="contato">Contato</TabsTrigger>
          <TabsTrigger value="funcionamento">Funcionamento</TabsTrigger>
          <TabsTrigger value="delivery">Delivery</TabsTrigger>
        </TabsList>

        {/* Identidade */}
        <TabsContent value="identidade">
          <div className="rounded-2xl border border-border bg-card p-6 space-y-6 max-w-2xl">
            <div className="flex items-center gap-4">
              {form.logo_url ? (
                <div className="relative">
                  <Image src={form.logo_url} fittingType="fill" className="h-20 w-20 rounded-xl" alt="Logo" />
                  <button onClick={() => update('logo_url', '')} className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <div className="flex h-20 w-20 items-center justify-center rounded-xl border-2 border-dashed border-border bg-muted font-heading text-2xl font-bold text-muted-foreground">
                  {form.name?.[0]?.toUpperCase() || 'H'}
                </div>
              )}
              <div>
                <Label htmlFor="logo" className="cursor-pointer">
                  <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted transition-colors">
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    {uploading ? 'Enviando...' : 'Enviar logo'}
                  </div>
                </Label>
                <Input id="logo" type="file" accept="image/*" className="hidden" onChange={handleUpload} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label>Nome</Label><Input value={form.name || ''} onChange={e => update('name', e.target.value)} /></div>
              <div className="space-y-2"><Label>Slogan</Label><Input value={form.slogan || ''} onChange={e => update('slogan', e.target.value)} /></div>
            </div>
            <div className="space-y-2"><Label>Descrição</Label><Textarea value={form.description || ''} onChange={e => update('description', e.target.value)} rows={3} /></div>
            <div className="space-y-3">
              <Label>Cor principal</Label>
              <div className="flex flex-wrap gap-3">
                {COLOR_PRESETS.map(c => (
                  <button key={c} onClick={() => update('primary_color', c)} className={`flex h-9 w-9 items-center justify-center rounded-xl transition-transform hover:scale-110 ${form.primary_color === c ? 'ring-2 ring-offset-2 ring-foreground' : ''}`} style={{ backgroundColor: c }}>
                    {form.primary_color === c && <Check className="h-4 w-4 text-white" />}
                  </button>
                ))}
                <input type="color" value={form.primary_color || '#DC2626'} onChange={e => update('primary_color', e.target.value)} className="h-9 w-9 rounded-xl border border-border cursor-pointer bg-transparent" />
              </div>
            </div>
            <div className="space-y-3">
              <Label>Cor de destaque</Label>
              <div className="flex flex-wrap gap-3">
                {COLOR_PRESETS.map(c => (
                  <button key={c} onClick={() => update('accent_color', c)} className={`flex h-9 w-9 items-center justify-center rounded-xl transition-transform hover:scale-110 ${form.accent_color === c ? 'ring-2 ring-offset-2 ring-foreground' : ''}`} style={{ backgroundColor: c }}>
                    {form.accent_color === c && <Check className="h-4 w-4 text-white" />}
                  </button>
                ))}
                <input type="color" value={form.accent_color || '#F97316'} onChange={e => update('accent_color', e.target.value)} className="h-9 w-9 rounded-xl border border-border cursor-pointer bg-transparent" />
              </div>
            </div>
          </div>
        </TabsContent>

        {/* Contato */}
        <TabsContent value="contato">
          <div className="rounded-2xl border border-border bg-card p-6 space-y-4 max-w-2xl">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label>Telefone</Label><Input value={form.phone || ''} onChange={e => update('phone', e.target.value)} placeholder="(11) 99999-9999" /></div>
              <div className="space-y-2"><Label>WhatsApp</Label><Input value={form.whatsapp || ''} onChange={e => update('whatsapp', e.target.value)} placeholder="(11) 99999-9999" /></div>
              <div className="space-y-2"><Label>E-mail</Label><Input type="email" value={form.email || ''} onChange={e => update('email', e.target.value)} /></div>
              <div className="space-y-2"><Label>Site</Label><Input value={form.website || ''} onChange={e => update('website', e.target.value)} placeholder="www.seusite.com.br" /></div>
            </div>
            <div className="space-y-2"><Label>Endereço</Label><Input value={form.address || ''} onChange={e => update('address', e.target.value)} placeholder="Rua, número" /></div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2"><Label>Cidade</Label><Input value={form.city || ''} onChange={e => update('city', e.target.value)} /></div>
              <div className="space-y-2"><Label>Estado</Label><Input value={form.state || ''} onChange={e => update('state', e.target.value)} maxLength={2} /></div>
              <div className="space-y-2"><Label>CEP</Label><Input value={form.zip_code || ''} onChange={e => update('zip_code', e.target.value)} /></div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label>Instagram</Label><Input value={form.instagram || ''} onChange={e => update('instagram', e.target.value)} placeholder="@seurestaurante" /></div>
              <div className="space-y-2"><Label>Facebook</Label><Input value={form.facebook || ''} onChange={e => update('facebook', e.target.value)} placeholder="/seurestaurante" /></div>
            </div>
          </div>
        </TabsContent>

        {/* Funcionamento */}
        <TabsContent value="funcionamento">
          <div className="rounded-2xl border border-border bg-card p-6 space-y-4 max-w-2xl">
            <div className="flex items-center justify-between rounded-xl border border-border p-4">
              <div>
                <p className="font-medium text-foreground">Restaurante aberto</p>
                <p className="text-sm text-muted-foreground">Aceitar pedidos imediatamente</p>
              </div>
              <Switch checked={!!form.is_open} onCheckedChange={v => update('is_open', v)} />
            </div>
            <div className="space-y-2"><Label>Horário de funcionamento</Label><Input value={form.opening_hours || ''} onChange={e => update('opening_hours', e.target.value)} placeholder="Seg-Dom: 18h - 23h" /></div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2"><Label>Pedido mínimo (R$)</Label><Input type="number" min="0" step="0.50" value={form.minimum_order || 0} onChange={e => update('minimum_order', e.target.value)} /></div>
              <div className="space-y-2"><Label>Taxa padrão (R$)</Label><Input type="number" min="0" step="0.50" value={form.delivery_fee || 0} onChange={e => update('delivery_fee', e.target.value)} /></div>
              <div className="space-y-2"><Label>Tempo médio (min)</Label><Input type="number" min="1" value={form.estimated_delivery_time || 30} onChange={e => update('estimated_delivery_time', e.target.value)} /></div>
            </div>
          </div>
        </TabsContent>

        {/* Delivery */}
        <TabsContent value="delivery">
          <div className="rounded-2xl border border-border bg-card p-6 space-y-4 max-w-2xl">
            <div className="space-y-2"><Label>Raio de entrega (km)</Label><Input type="number" min="0" value={form.delivery_radius || 0} onChange={e => update('delivery_radius', e.target.value)} /></div>
            <div>
              <Label className="mb-3 block">Zonas de entrega</Label>
              <div className="space-y-2">
                {zones.map(z => (
                  <div key={z.id} className="flex items-center gap-3 rounded-xl border border-border p-3">
                    <div className="flex-1"><p className="font-medium text-foreground text-sm">{z.name}</p></div>
                    <span className="text-sm text-muted-foreground">R$ {Number(z.fee).toFixed(2)}</span>
                    <span className="text-sm text-muted-foreground">{z.estimated_time}min</span>
                    <Button variant="ghost" size="icon" onClick={() => deleteZone(z.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  </div>
                ))}
                {zones.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">Nenhuma zona cadastrada</p>}
              </div>
              <div className="flex items-end gap-2 mt-3">
                <div className="flex-1 space-y-1"><Input value={newZone.name} onChange={e => setNewZone(p => ({ ...p, name: e.target.value }))} placeholder="Bairro/região" /></div>
                <div className="w-24 space-y-1"><Input type="number" min="0" step="0.50" value={newZone.fee} onChange={e => setNewZone(p => ({ ...p, fee: e.target.value }))} placeholder="Taxa" /></div>
                <div className="w-24 space-y-1"><Input type="number" min="1" value={newZone.estimated_time} onChange={e => setNewZone(p => ({ ...p, estimated_time: e.target.value }))} placeholder="Min" /></div>
                <Button onClick={addZone} variant="outline"><Plus className="h-4 w-4" /></Button>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}