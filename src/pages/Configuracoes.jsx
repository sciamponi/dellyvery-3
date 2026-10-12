import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { supabase, isSupabaseConfigured } from '@/api/supabaseClient';
import { useSupabaseAuth } from '@/lib/SupabaseAuthContext';
import { listZones, createZone as sbCreateZone, deleteZone as sbDeleteZone } from '@/api/deliveryZones';
import { updateCompany as sbUpdateCompany, getCompanySettings as sbGetSettings, updateCompanySettings as sbUpdateSettings } from '@/api/company';
import { listDrivers as sbListDrivers } from '@/api/team';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { uploadImage as sbUploadImage } from '@/api/storage';
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
import { Upload, Loader2, Save, Plus, Trash2, X, Check, Link2, QrCode, Share2, Download, Copy, ExternalLink, Megaphone, Printer, Globe } from 'lucide-react';
import { normalizeSlug, isValidSlug, buildMenuUrl, buildShareMessage, buildWhatsAppUrl } from '@/lib/menuShare';
import { normalizePrintSettings, PRINT_MODES, PRINT_WIDTHS } from '@/lib/printSettings';
import { listStages as sbListStages, displayStages as buildDisplayStages } from '@/api/orderStages';
import { listTables as sbListTables } from '@/api/tables';
import { listProducts as sbListCatalogProducts } from '@/api/catalog';
import { FLYER_PRINT_CSS } from '@/lib/printCss';
import { resolvePublicBaseUrl } from '@/lib/tableQr';
import {
  buildFlyerModel, renderFlyerPng, DEFAULT_TABLE_TITLE, DEFAULT_GENERAL_TITLE,
  DEFAULT_INSTRUCTION,
} from '@/lib/flyer';

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
  // Configurações Supabase-only.
  const { user: sbUser, currentCompany: sbCompany } = useSupabaseAuth();
  const sbActive = isSupabaseConfigured() && !!sbUser && !!sbCompany;
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState(null);
  const [zones, setZones] = useState([]);
  const [newZone, setNewZone] = useState({ name: '', fee: 0, estimated_time: 30 });
  const [drivers, setDrivers] = useState([]);
  const [opsSettings, setOpsSettings] = useState({ default_driver_id: '', auto_assign_delivery: false });
  const [opsSaving, setOpsSaving] = useState(false);
  // Impressão por empresa (company_settings.settings.print). Sem migration:
  // mesmo JSONB das operações. Modo manual = só botão (padrão).
  const [printCfg, setPrintCfg] = useState({ mode: 'manual', stages: [], width: '80' });
  const [printStages, setPrintStages] = useState([]);
  const [printSaving, setPrintSaving] = useState(false);
  // Divulgação: QR geral + material por mesa (flyer com capa e fotos reais).
  const [flyTables, setFlyTables] = useState([]);
  const [flyProducts, setFlyProducts] = useState([]);
  const [flyTableId, setFlyTableId] = useState('');
  const [flyTitle, setFlyTitle] = useState('');
  const [flyInstruction, setFlyInstruction] = useState('');
  const [flyPhotoIds, setFlyPhotoIds] = useState([]);
  const [flyQrUrl, setFlyQrUrl] = useState('');
  const [flyPng, setFlyPng] = useState('');
  const [flyBusy, setFlyBusy] = useState(false);
  const [coverUploading, setCoverUploading] = useState(false);
  // PNG dedicado à impressão (WYSIWYG com o download, A4 página única).
  const [printPng, setPrintPng] = useState('');
  // Capa verificada: só conta como aplicada se a imagem carregar de verdade.
  const [coverStatus, setCoverStatus] = useState('idle');
  const coverUrl = form?.cover_url || company?.cover_url || '';

  useEffect(() => {
    if (!coverUrl) { setCoverStatus('idle'); return; }
    let alive = true;
    setCoverStatus('checking');
    // Construtor global explícito: `Image` aqui é o componente importado
    // de @/components/ui/image (não-construtível); `new Image()` quebrava
    // a página inteira (tela branca) para empresas COM capa.
    const Ctor = typeof window !== 'undefined' ? window.Image : null;
    if (!Ctor) { setCoverStatus('error'); return; }
    const img = new Ctor();
    img.onload = () => { if (alive) setCoverStatus('ok'); };
    img.onerror = () => { if (alive) setCoverStatus('error'); };
    img.src = coverUrl;
    return () => { alive = false; };
  }, [coverUrl]);
  const [copiedLink, setCopiedLink] = useState(false);
  const qrRef = useRef(null);

  const menuUrl = form?.slug ? buildMenuUrl(window.location.origin, normalizeSlug(form.slug) || form.slug) : '';

  // QR desenhado via callback ref: dispara na montagem do canvas (ao abrir a
  // aba Divulgação) e quando a URL muda.
  const qrCallbackRef = useCallback((canvas) => {
    qrRef.current = canvas;
    if (!canvas || !menuUrl) return;
    import('qrcode').then(({ default: QRCode }) => {
      QRCode.toCanvas(canvas, menuUrl, { width: 200, margin: 2 }).catch(() => {});
    }).catch(() => {});
  }, [menuUrl]);

  const copyMenuLink = async () => {
    if (!menuUrl) return;
    try {
      await navigator.clipboard.writeText(menuUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch (err) {
      toast({ title: 'Não foi possível copiar', variant: 'destructive' });
    }
  };

  const shareWhatsApp = () => {
    if (!menuUrl) return;
    window.open(buildWhatsAppUrl(buildShareMessage(form?.name || 'Nosso cardápio', menuUrl)), '_blank', 'noopener');
  };

  const downloadQr = () => {
    const canvas = qrRef.current;
    if (!canvas) return;
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `qrcode-cardapio-${normalizeSlug(form?.slug || 'loja')}.png`;
    a.click();
  };

  useEffect(() => {
    if (company) {
      const cid = sbCompany?.id || company.id;
      setForm({ ...company });
      listZones(supabase, cid).then(setZones).catch(() => {});
      sbListDrivers(supabase, cid).then(setDrivers).catch(() => {});
      sbGetSettings(supabase, cid).then(s => {
        const cur = s?.settings || {};
        setOpsSettings({ default_driver_id: cur.default_driver_id || '', auto_assign_delivery: !!cur.auto_assign_delivery });
        setPrintCfg(normalizePrintSettings(cur.print));
      }).catch(() => {});
      sbListStages(supabase, cid).then(setPrintStages).catch(() => setPrintStages([]));
      sbListTables(supabase, cid, { onlyActive: true }).then(setFlyTables).catch(() => setFlyTables([]));
      sbListCatalogProducts(supabase, cid).then(setFlyProducts).catch(() => setFlyProducts([]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company, sbActive]);

  const saveOpsSettings = async (next) => {    setOpsSettings(next);
    setOpsSaving(true);
    try {
      const cid = sbCompany?.id || company.id;
      const cur = await sbGetSettings(supabase, cid).catch(() => null);
      const merged = { ...(cur?.settings || {}), default_driver_id: next.default_driver_id || null, auto_assign_delivery: !!next.auto_assign_delivery };
      await sbUpdateSettings(supabase, cid, merged);
      toast({ title: 'Motoboy padrão salvo!' });
    } catch (err) {
      toast({ title: 'Erro ao salvar', description: err?.message, variant: 'destructive' });
    } finally {
      setOpsSaving(false);
    }
  };

  const savePrintSettings = async (next) => {
    const norm = normalizePrintSettings(next);
    setPrintCfg(norm);
    setPrintSaving(true);
    try {
      const cid = sbCompany?.id || company.id;
      const cur = await sbGetSettings(supabase, cid).catch(() => null);
      await sbUpdateSettings(supabase, cid, { ...(cur?.settings || {}), print: norm });
      toast({ title: 'Impressão salva!' });
    } catch (err) {
      toast({ title: 'Erro ao salvar', description: err?.message, variant: 'destructive' });
    } finally {
      setPrintSaving(false);
    }
  };

  const togglePrintStage = (id) => {
    const has = printCfg.stages.includes(id);
    savePrintSettings({
      ...printCfg,
      stages: has ? printCfg.stages.filter((s) => s !== id) : [...printCfg.stages, id],
    });
  };

  // ---- Divulgação: capa + flyer por mesa (individual) ----
  const flyTable = flyTables.find((t) => t.id === flyTableId) || null;

  const handleCoverUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCoverUploading(true);
    try {
      const cid = sbCompany?.id || company.id;
      const { file_url } = await sbUploadImage(supabase, 'cover', cid, file);
      const updated = await sbUpdateCompany(supabase, cid, { cover_url: file_url });
      setCompany((prev) => (prev ? { ...prev, cover_url: updated?.cover_url || file_url } : prev));
      setForm((prev) => (prev ? { ...prev, cover_url: updated?.cover_url || file_url } : prev));
      toast({ title: 'Capa atualizada!' });
    } catch (err) {
      toast({ title: 'Erro no upload', description: err?.message, variant: 'destructive' });
    } finally {
      setCoverUploading(false);
      e.target.value = '';
    }
  };

  const flyerModel = (() => {
    try {
      return buildFlyerModel({
        company: { ...(form || {}), cover_url: coverStatus === 'ok' ? coverUrl : '' },
        products: flyProducts,
        table: flyTable,
        origin: typeof window !== 'undefined' ? resolvePublicBaseUrl(window.location.origin) : '',
        opts: {
          title: flyTitle.trim() || undefined,
          instruction: flyInstruction.trim() || undefined,
          photoIds: flyPhotoIds,
        },
      });
    } catch {
      return null;
    }
  })();

  const refreshFlyerQr = async () => {
    if (!flyerModel) return '';
    try {
      const { default: QRCode } = await import('qrcode');
      const url = await QRCode.toDataURL(flyerModel.qrUrl, { width: 560, margin: 2 });
      setFlyQrUrl(url);
      return url;
    } catch {
      setFlyQrUrl('');
      return '';
    }
  };

  const downloadFlyer = async () => {
    if (!flyerModel) return;
    if (coverUrl && coverStatus !== 'ok') {
      toast({ title: 'Capa indisponível', description: 'A imagem da capa não carregou. Verifique o upload e tente de novo.', variant: 'destructive' });
      return;
    }
    setFlyBusy(true);
    try {
      const qr = flyQrUrl || (await refreshFlyerQr());
      if (!qr) throw new Error('Não foi possível gerar o QR Code');
      const png = await renderFlyerPng(flyerModel, { qrDataUrl: qr });
      setFlyPng(png);
      const a = document.createElement('a');
      a.href = png;
      a.download = flyTable ? `mesa-${flyTable.name}.png` : `cardapio-${form?.slug || 'loja'}.png`;
      a.click();
    } catch (err) {
      toast({ title: 'Erro ao gerar', description: err?.message, variant: 'destructive' });
    } finally {
      setFlyBusy(false);
    }
  };

  // Impressão A4: renderiza o MESMO PNG do download e abre o diálogo.
  // Sem PNG válido não há impressão (nunca papel em branco).
  const printFlyer = async () => {
    if (!flyerModel) return;
    if (coverUrl && coverStatus !== 'ok') {
      toast({ title: 'Capa indisponível', description: 'A imagem da capa não carregou. Verifique o upload e tente de novo.', variant: 'destructive' });
      return;
    }
    setFlyBusy(true);
    try {
      const qr = flyQrUrl || (await refreshFlyerQr());
      if (!qr) throw new Error('Não foi possível gerar o QR Code');
      const png = await renderFlyerPng(flyerModel, { qrDataUrl: qr });
      setPrintPng(png);
      setTimeout(() => window.print(), 150);
    } catch (err) {
      toast({ title: 'Erro ao preparar impressão', description: err?.message, variant: 'destructive' });
    } finally {
      setFlyBusy(false);
    }
  };

  if (loading || !form) return <Spinner />;
  if (!company) return null;

  const update = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

  // Logo via Supabase Storage (bucket logos, pasta da empresa).
  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { file_url } = await sbUploadImage(supabase, 'logo', sbCompany?.id || company.id, file);
      update('logo_url', file_url);
    } catch (err) {
      toast({ title: 'Erro no upload', description: err?.message, variant: 'destructive' });
    } finally { setUploading(false); }
  };

  // Salvamento Supabase-only (RLS OWNER/ADMIN).
  const handleSave = async () => {
    setSaving(true);
    try {
      if (form.slug !== undefined && form.slug !== company.slug) {
        const clean = normalizeSlug(form.slug);
        if (!isValidSlug(clean)) {
          toast({ title: 'Endereço inválido', description: 'Use letras minúsculas, números e hífens.', variant: 'destructive' });
          return;
        }
      }
      const safeData = {};
      [
        'name', 'slug', 'slogan', 'description', 'logo_url',
        'primary_color', 'accent_color', 'secondary_color',
        'phone', 'whatsapp', 'email', 'address', 'city', 'state', 'zip_code',
        'instagram', 'facebook', 'website',
        'is_open', 'opening_hours', 'minimum_order', 'delivery_fee',
        'estimated_delivery_time', 'delivery_radius'
      ].forEach(key => { if (form[key] !== undefined) safeData[key] = form[key]; });
      if (safeData.slug !== undefined) safeData.slug = normalizeSlug(safeData.slug);
      const updated = await sbUpdateCompany(supabase, sbCompany?.id || company.id, safeData);
      setCompany(updated);
      setForm(prev => ({ ...prev, ...updated }));
      toast({ title: 'Configurações salvas!' });
    } catch (err) {
      const msg = err?.code === '23505' || /duplicate|unique|já está em uso/i.test(err?.message || '')
        ? 'Este endereço já está em uso por outra loja.'
        : err?.message;
      toast({ title: 'Erro ao salvar', description: msg, variant: 'destructive' });
    } finally { setSaving(false); }
  };

  const addZone = async () => {
    if (!newZone.name.trim()) return;
    try {
      const z = await sbCreateZone(supabase, sbCompany?.id || company.id, { ...newZone, fee: Number(newZone.fee) || 0, estimated_time: Number(newZone.estimated_time) || 30 });
      setZones(prev => [...prev, z]);
      setNewZone({ name: '', fee: 0, estimated_time: 30 });
    } catch (err) { toast({ title: 'Erro', description: err?.message, variant: 'destructive' }); }
  };

  const deleteZone = async (id) => {
    try {
      await sbDeleteZone(supabase, id);
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
          <TabsTrigger value="identidade">🏪 Identidade</TabsTrigger>
          <TabsTrigger value="cardapio">🍔 Cardápio</TabsTrigger>
          <TabsTrigger value="contato">📞 Contato</TabsTrigger>
          <TabsTrigger value="funcionamento">🕐 Funcionamento</TabsTrigger>
          <TabsTrigger value="delivery">🚴 Delivery</TabsTrigger>
          <TabsTrigger value="divulgacao">📣 Divulgação</TabsTrigger>
          <TabsTrigger value="impressao">🖨️ Impressão</TabsTrigger>
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
            <div className="space-y-2">
              <Label>Endereço do cardápio (slug)</Label>
              <div className="flex gap-2">
                <Input value={form.slug || ''} onChange={e => update('slug', normalizeSlug(e.target.value))} placeholder="minha-loja" className="flex-1" />
                <Button variant="outline" onClick={handleSave} disabled={saving}>Salvar</Button>
              </div>
              <p className="text-xs text-muted-foreground">Letras minúsculas, números e hífens. Ao trocar, o endereço antigo deixa de funcionar.</p>
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

        {/* Cardápio — divulgação */}
        <TabsContent value="cardapio">
          <div className="rounded-2xl border border-border bg-card p-6 space-y-4 max-w-2xl">
            <div className="flex items-center gap-2">
              <Link2 className="h-5 w-5 text-primary" />
              <h3 className="font-heading font-semibold text-foreground">Endereço do cardápio</h3>
            </div>
            <div className="flex items-center gap-2 rounded-xl bg-muted px-3 py-2.5">
              <span className="text-sm text-foreground truncate flex-1">{menuUrl || '—'}</span>
              <Button variant="ghost" size="sm" onClick={copyMenuLink} className="shrink-0">
                {copiedLink ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                {copiedLink ? 'Copiado!' : 'Copiar link'}
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => menuUrl && window.open(menuUrl, '_blank', 'noopener')}>
                <ExternalLink className="h-4 w-4" /> Abrir cardápio
              </Button>
              <Button variant="outline" size="sm" onClick={shareWhatsApp}>
                <Share2 className="h-4 w-4" /> Compartilhar no WhatsApp
              </Button>
            </div>
          </div>

          {/* QR Code e material impresso vivem na aba Divulgação */}
          <div className="rounded-2xl border border-border bg-card p-4 sm:p-6 max-w-2xl">
            <p className="text-sm text-muted-foreground">
              QR Code e material para impressão estão na aba <span className="font-medium text-foreground">Divulgação</span>.
            </p>
          </div>

          {/* Material de divulgação (futuro) */}
          <div className="rounded-2xl border border-dashed border-border bg-card p-4 sm:p-6 space-y-3 max-w-2xl w-full min-w-0 opacity-90">
            <div className="flex items-center gap-2">
              <Megaphone className="h-5 w-5 text-muted-foreground shrink-0" />
              <h3 className="font-heading font-semibold text-foreground min-w-0">Material de divulgação</h3>
              <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground shrink-0">Em breve</span>
            </div>
            <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2">
              <Button variant="outline" size="sm" disabled className="w-full sm:w-auto max-w-full whitespace-normal">
                <Megaphone className="h-4 w-4 shrink-0" /> Enviar para clientes
              </Button>
              <Button variant="outline" size="sm" disabled className="w-full sm:w-auto max-w-full whitespace-normal">
                <Printer className="h-4 w-4 shrink-0" /> Criar cardápio para impressão
              </Button>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center items-stretch gap-2 rounded-xl bg-muted/60 p-3">
              <div className="flex items-start gap-2 flex-1 min-w-0">
                <Globe className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">Domínio personalizado <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground ml-1">Em breve</span></p>
                  <p className="text-xs text-muted-foreground mt-0.5 break-words">Use um endereço próprio, ex.: cardapio.meurestaurante.com.br</p>
                </div>
              </div>
              <Button variant="outline" size="sm" disabled className="w-full sm:w-auto max-w-full shrink-0">Configurar domínio</Button>
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
            <div className="space-y-3">
              <Label>🚴 Motoboy padrão</Label>
              <p className="text-xs text-muted-foreground">Selecione o entregador atribuído automaticamente aos novos pedidos de delivery.</p>
              <Select value={opsSettings.default_driver_id || 'none'} onValueChange={v => saveOpsSettings({ ...opsSettings, default_driver_id: v === 'none' ? '' : v })} disabled={opsSaving}>
                <SelectTrigger><SelectValue placeholder="Nenhum" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum</SelectItem>
                  {drivers.filter(d => d.status === 'ativo').map(d => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {opsSettings.default_driver_id && !drivers.some(d => d.id === opsSettings.default_driver_id && d.status === 'ativo') && (
                <p className="text-xs text-amber-600">O motoboy padrão está inativo — a atribuição automática está pausada.</p>
              )}
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Switch checked={!!opsSettings.auto_assign_delivery} onCheckedChange={v => saveOpsSettings({ ...opsSettings, auto_assign_delivery: v })} disabled={opsSaving} />
                <span>✓ Atribuir automaticamente aos pedidos de delivery</span>
              </label>
            </div>
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
        {/* Impressão: modo + etapas por empresa (company_settings) */}
        <TabsContent value="impressao">
          <div className="rounded-2xl border border-border bg-card p-6 space-y-5 max-w-2xl">
            <div className="space-y-2">
              <Label>🖨️ Modo de impressão</Label>
              <p className="text-xs text-muted-foreground">
                Vale para esta empresa. O navegador sempre abre a janela de impressão —
                impressão silenciosa automática não é garantida sem equipamento próprio.
              </p>
              <div className="grid gap-2">
                {PRINT_MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    disabled={printSaving}
                    onClick={() => savePrintSettings({ ...printCfg, mode: m.id })}
                    className={`rounded-xl border px-3 py-2.5 text-left text-sm transition-colors ${
                      printCfg.mode === m.id
                        ? 'border-primary bg-primary/5 font-medium'
                        : 'border-border text-muted-foreground hover:bg-muted/50'
                    }`}
                  >
                    {m.label}
                    <span className="block text-xs font-normal text-muted-foreground mt-0.5">
                      {m.id === 'manual' && 'Imprime somente pelo botão Imprimir.'}
                      {m.id === 'confirm' && 'Pergunta antes de imprimir ao atingir a etapa.'}
                      {m.id === 'auto' && 'Abre a impressão ao entrar na etapa (confirme na janela).'}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            {printCfg.mode !== 'manual' && (
              <div className="space-y-2">
                <Label>Etapas que disparam</Label>
                {buildDisplayStages(printStages).length === 0 && (
                  <p className="text-xs text-muted-foreground">Etapas padrão do sistema serão usadas.</p>
                )}
                <div className="space-y-1.5">
                  {buildDisplayStages(printStages).map((s) => (
                    <label key={s.id} className="flex items-center gap-2.5 rounded-xl border border-border px-3 py-2 text-sm cursor-pointer hover:bg-muted/50">
                      <input
                        type="checkbox"
                        checked={printCfg.stages.includes(s.id)}
                        onChange={() => togglePrintStage(s.id)}
                        disabled={printSaving}
                        className="h-4 w-4 accent-primary"
                      />
                      <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                      <span className="font-medium">{s.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-2 max-w-[200px]">
              <Label>Largura do cupom</Label>
              <Select
                value={printCfg.width}
                onValueChange={(v) => savePrintSettings({ ...printCfg, width: v })}
                disabled={printSaving}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRINT_WIDTHS.map((w) => (
                    <SelectItem key={w} value={w}>{w} mm</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </TabsContent>
        {/* Divulgação: QR geral + material impresso por mesa (individual) */}
        <TabsContent value="divulgacao">
          <p className="text-sm text-muted-foreground max-w-2xl mb-4">
            <span className="font-medium text-foreground">QR geral</span> abre o cardápio sem mesa.
            {' '}<span className="font-medium text-foreground">Material por mesa</span> usa o QR exclusivo de cada mesa.
            Mesas em <Link to="/mesas" className="text-primary hover:underline">Mesas</Link>; cupom de pedido em cada pedido.
          </p>
          <div className="rounded-2xl border border-border bg-card p-6 space-y-4 max-w-2xl">
            <div className="flex items-center gap-2">
              <QrCode className="h-5 w-5 text-primary" />
              <h3 className="font-heading font-semibold text-foreground">QR Code geral do cardápio</h3>
            </div>
            <div className="flex flex-col sm:flex-row items-center gap-4">
              <div className="rounded-xl border border-border bg-white p-3">
                <canvas ref={qrCallbackRef} width={200} height={200} className="h-[180px] w-[180px]" aria-label="QR Code do cardápio" />
              </div>
              <div className="flex flex-col gap-2 w-full sm:w-auto">
                <Button variant="outline" size="sm" onClick={downloadQr}>
                  <Download className="h-4 w-4" /> Baixar QR Code
                </Button>
                <p className="text-xs text-muted-foreground">Abre o cardápio sem vincular mesa.</p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-6 space-y-4 max-w-2xl">
            <div className="flex items-center gap-2">
              <Megaphone className="h-5 w-5 text-primary" />
              <h3 className="font-heading font-semibold text-foreground">Material por mesa</h3>
            </div>
            <div className="space-y-2">
              <Label>Mesa (opcional — vazio = material geral)</Label>
              <Select value={flyTableId || 'none'} onValueChange={(v) => { setFlyTableId(v === 'none' ? '' : v); setFlyPng(''); setFlyQrUrl(''); }}>
                <SelectTrigger><SelectValue placeholder="Material geral" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Material geral (sem mesa)</SelectItem>
                  {flyTables.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {flyTables.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Nenhuma mesa cadastrada. <Link to="/mesas" className="text-primary hover:underline">Cadastrar mesas</Link>
                </p>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Título</Label>
                <Input
                  value={flyTitle}
                  onChange={(e) => setFlyTitle(e.target.value)}
                  placeholder={flyTable ? DEFAULT_TABLE_TITLE : DEFAULT_GENERAL_TITLE}
                  maxLength={60}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Capa (fundo)</Label>
                <div className="flex items-center gap-2">
                  <Input id="fly-cover" type="file" accept="image/*" className="hidden" onChange={handleCoverUpload} />
                  <Button variant="outline" size="sm" asChild disabled={coverUploading}>
                    <label htmlFor="fly-cover" className="cursor-pointer">
                      {coverUploading ? 'Enviando...' : (form?.cover_url ? 'Trocar capa' : 'Enviar capa')}
                    </label>
                  </Button>
                  {coverStatus === 'ok' && <span className="text-xs text-green-600">Capa aplicada ✓</span>}
                  {coverStatus === 'checking' && <span className="text-xs text-muted-foreground">Verificando imagem...</span>}
                  {coverStatus === 'error' && (
                    <span className="text-xs text-destructive">A capa não carregou — tente outro arquivo.</span>
                  )}
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Instrução</Label>
              <Textarea value={flyInstruction} onChange={(e) => setFlyInstruction(e.target.value)} rows={2} placeholder={DEFAULT_INSTRUCTION} />
            </div>
            <div className="space-y-1.5">
              <Label>Fotos (até 3, automático)</Label>
              <div className="flex flex-wrap gap-2">
                {flyProducts.filter((p) => p.image_url).slice(0, 9).map((p) => {
                  const on = flyPhotoIds.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setFlyPhotoIds((prev) => (on ? prev.filter((id) => id !== p.id) : [...prev, p.id].slice(0, 3)))}
                      className={`relative h-14 w-14 overflow-hidden rounded-lg border-2 ${on ? 'border-primary' : 'border-transparent opacity-70'}`}
                      title={p.name}
                    >
                      <Image src={p.image_url} fittingType="fill" className="h-full w-full" alt={p.name} />
                    </button>
                  );
                })}
                {flyProducts.filter((p) => p.image_url).length === 0 && (
                  <p className="text-xs text-muted-foreground">Sem fotos nos produtos ainda.</p>
                )}
              </div>
            </div>
          </div>

          {/* Pré-visualização + ações */}
          <div className="rounded-2xl border border-border bg-card p-6 space-y-4 max-w-2xl">
            <h3 className="font-heading font-semibold text-foreground">Pré-visualização</h3>
            <style>{FLYER_PRINT_CSS}</style>
            {!flyerModel ? (
              <p className="text-sm text-muted-foreground">Carregando dados da empresa...</p>
            ) : (
              <div className="mx-auto" style={{ maxWidth: 320 }}>
              <div
                className="fly-print overflow-hidden rounded-2xl text-white"
                style={{
                  background: flyerModel.coverUrl
                    ? `linear-gradient(rgba(0,0,0,.55),rgba(0,0,0,.55)), url(${flyerModel.coverUrl}) center/cover`
                    : `linear-gradient(180deg, ${flyerModel.primaryColor}, #0c0a09)`,
                }}
              >
                <div className="p-5 text-center space-y-2">
                  <p className="font-heading font-bold text-lg">{flyerModel.companyName}</p>
                  <p className="font-heading text-base font-extrabold text-amber-200">{flyerModel.title}</p>
                  {flyerModel.kind === 'table' && (
                    <p className="text-sm font-semibold">Mesa {flyerModel.tableName}</p>
                  )}
                  <div className="mx-auto bg-white p-2 rounded-xl" style={{ width: 150 }}>
                    {flyQrUrl ? (
                      <img src={flyQrUrl} alt="QR Code" className="w-full" />
                    ) : (
                      <button type="button" onClick={refreshFlyerQr} className="text-xs text-muted-foreground py-8 w-full">
                        Gerar QR Code
                      </button>
                    )}
                  </div>
                  <p className="text-[11px] text-white/90">{flyerModel.instruction}</p>
                  {flyerModel.photos.length > 0 && (
                    <div className="flex justify-center gap-1.5 pt-1">
                      {flyerModel.photos.map((p) => (
                        <Image key={p.id} src={p.image_url} fittingType="fill" className="h-11 w-11 rounded-lg object-cover" alt={p.name} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
              </div>
            )}
            <div className="no-print flex flex-col sm:flex-row gap-2">
              <Button variant="outline" className="flex-1" onClick={downloadFlyer} disabled={!flyerModel || flyBusy}>
                <Download className="h-4 w-4" /> {flyBusy ? 'Gerando...' : 'Baixar PNG'}
              </Button>
              <Button
                variant="outline" className="flex-1"
                onClick={printFlyer}
                disabled={!flyerModel || flyBusy}
              >
                <Printer className="h-4 w-4" /> {flyBusy ? 'Preparando...' : 'Imprimir'}
              </Button>
            </div>
            {printPng && (
              <div className="fly-print invisible absolute left-0 top-0" aria-hidden>
                <img className="fly-print-img" src={printPng} alt="" />
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              A impressão usa a janela do navegador. {flyTable ? `QR exclusivo da ${flyTable.name} (não muda ao renomear).` : 'QR geral, sem mesa vinculada.'}
            </p>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}