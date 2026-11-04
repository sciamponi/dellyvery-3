import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/api/supabaseClient';
import { useSupabaseAuth } from '@/lib/SupabaseAuthContext';
import { isPlatformAdmin } from '@/api/plans';
import {
  listPlanPurchaseRequests,
  confirmPlanPurchaseRequest,
  rejectPlanPurchaseRequest,
  getPlatformPixSettings,
  setPlatformPixSettings,
  getPlanPurchaseExpiryDays,
  setPlanPurchaseExpiryDays,
  validatePixSettings,
  PIX_KEY_TYPES,
} from '@/api/masterPlanPurchases';
import { expirePlanPurchaseRequests, planPurchaseStatusLabel } from '@/api/planPurchases';
import {
  deleteImage,
  getPixQrPublicUrl,
  PLATFORM_ASSETS_BUCKET,
  PIX_QR_FOLDER,
  uploadImage,
  validateUploadFile,
} from '@/api/storage';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import {
  AlertTriangle, Building2, Check, Clock, History, Loader2, QrCode, RefreshCw,
  Settings, ShieldAlert, Trash2, Upload, X,
} from 'lucide-react';

const STATUS_TONE = {
  pendente: 'bg-amber-100 text-amber-900',
  confirmada: 'bg-green-100 text-green-800',
  rejeitada: 'bg-red-100 text-red-800',
  cancelada: 'bg-muted text-muted-foreground',
  expirada: 'bg-orange-100 text-orange-800',
};

const EMPTY_PIX_FORM = {
  active: false,
  pix_key_type: '',
  pix_key: '',
  receiver_name: '',
  qr_image_url: '',
  qr_image_path: '',
  qr_payload: '',
  instructions: '',
};

function Spinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-4 border-border border-t-primary rounded-full animate-spin" />
    </div>
  );
}

function fmtMoney(value, currency = 'BRL') {
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(Number(value) || 0);
  } catch {
    return `${currency} ${Number(value) || 0}`;
  }
}

function fmtDate(value, withTime = false) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return withTime ? date.toLocaleString('pt-BR') : date.toLocaleDateString('pt-BR');
}

export default function MasterCompras() {
  const { toast } = useToast();
  const notify = (props) => toast({ duration: 4000, ...props });
  const { user: sbUser } = useSupabaseAuth();
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [tab, setTab] = useState('pendentes');
  const [requests, setRequests] = useState([]);
  const [pixSettings, setPixSettings] = useState(null);
  const [pixForm, setPixForm] = useState(EMPTY_PIX_FORM);
  const [qrFile, setQrFile] = useState(null);
  const [qrPreview, setQrPreview] = useState('');
  const [pixError, setPixError] = useState('');
  const [savingPix, setSavingPix] = useState(false);
  const [expiryDays, setExpiryDays] = useState('');
  const [savingExpiry, setSavingExpiry] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState(null);
  const [confirmReference, setConfirmReference] = useState('');
  const [confirmedAmount, setConfirmedAmount] = useState('');
  const [confirmReason, setConfirmReason] = useState('');
  const [confirmError, setConfirmError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectError, setRejectError] = useState('');
  const [rejecting, setRejecting] = useState(false);

  useEffect(() => {
    if (!qrFile) {
      setQrPreview('');
      return undefined;
    }
    const url = URL.createObjectURL(qrFile);
    setQrPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [qrFile]);

  const load = async () => {
    await expirePlanPurchaseRequests(supabase).catch(() => 0);
    const status = tab === 'pendentes' ? 'pendente' : 'todas';
    const [rows, settings, days] = await Promise.all([
      listPlanPurchaseRequests(supabase, { status }),
      getPlatformPixSettings(supabase),
      getPlanPurchaseExpiryDays(supabase),
    ]);
    setRequests(rows);
    setPixSettings(settings);
    setPixForm(settings ? {
      active: !!settings.active,
      pix_key_type: settings.pix_key_type || '',
      pix_key: settings.pix_key || '',
      receiver_name: settings.receiver_name || '',
      qr_image_url: settings.qr_image_url || '',
      qr_image_path: settings.qr_image_path || '',
      qr_payload: settings.qr_payload || '',
      instructions: settings.instructions || '',
    } : EMPTY_PIX_FORM);
    setExpiryDays(days == null ? '' : String(days));
  };

  useEffect(() => {
    const init = async () => {
      try {
        const admin = await isPlatformAdmin(supabase, sbUser?.id);
        setIsAdmin(admin);
        if (admin) await load();
      } catch (err) {
        notify({ title: 'Erro ao carregar compras', description: err?.message, variant: 'destructive' });
      } finally {
        setLoading(false);
      }
    };
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sbUser?.id]);

  useEffect(() => {
    if (!isAdmin || loading) return;
    load().catch((err) => {
      notify({ title: 'Erro ao carregar compras', description: err?.message, variant: 'destructive' });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const pendingCount = useMemo(
    () => requests.filter((request) => request.status === 'pendente').length,
    [requests],
  );

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

  const openConfirm = (request) => {
    setConfirmTarget(request);
    setConfirmReference(request?.payment_reference || '');
    setConfirmedAmount(request?.price != null ? String(request.price) : '');
    setConfirmReason('');
    setConfirmError('');
  };

  const handleConfirm = async () => {
    if (!confirmTarget) return;
    setConfirming(true);
    setConfirmError('');
    try {
      const out = await confirmPlanPurchaseRequest(supabase, confirmTarget.id, {
        confirmedAmount,
        paymentReference: confirmReference,
        reason: confirmReason,
      });
      if (out?.expired) {
        notify({ title: 'Solicitação expirada', description: 'A compra não pode mais ser confirmada.', variant: 'destructive' });
      } else {
        notify({
          title: 'Pagamento confirmado',
          description: out?.reused
            ? 'Confirmação já registrada.'
            : `Plano ativado até ${fmtDate(out?.expires_at, true)}.`,
        });
      }
      setConfirmTarget(null);
      await load();
    } catch (err) {
      setConfirmError(err?.message || 'Não foi possível confirmar o pagamento.');
    } finally {
      setConfirming(false);
    }
  };

  const openReject = (request) => {
    setRejectTarget(request);
    setRejectReason('');
    setRejectError('');
  };

  const handleReject = async () => {
    if (!rejectTarget) return;
    setRejecting(true);
    setRejectError('');
    try {
      const out = await rejectPlanPurchaseRequest(supabase, rejectTarget.id, rejectReason);
      if (out?.expired) {
        notify({ title: 'Solicitação expirada', description: 'A compra não pode mais ser rejeitada.', variant: 'destructive' });
      } else {
        notify({ title: 'Solicitação rejeitada', description: out?.reused ? 'Rejeição já registrada.' : undefined });
      }
      setRejectTarget(null);
      await load();
    } catch (err) {
      setRejectError(err?.message || 'Não foi possível rejeitar a solicitação.');
    } finally {
      setRejecting(false);
    }
  };

  const updatePixForm = (field, value) => setPixForm((prev) => ({ ...prev, [field]: value }));

  const handleQrFileChange = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      validateUploadFile(file);
      setQrFile(file);
      setPixError('');
    } catch (err) {
      setQrFile(null);
      setPixError(err?.message || 'Arquivo de imagem inválido.');
    }
  };

  const handleRemoveQr = () => {
    setQrFile(null);
    updatePixForm('qr_image_url', '');
    updatePixForm('qr_image_path', '');
    setPixError('');
  };

  const handleSavePix = async () => {
    const validationError = validatePixSettings(pixForm);
    if (validationError) {
      setPixError(validationError);
      return;
    }
    setSavingPix(true);
    setPixError('');
    let uploadedPath = null;
    let saved = false;
    try {
      let qrImageUrl = pixForm.qr_image_url;
      if (qrFile) {
        validateUploadFile(qrFile);
        const uploaded = await uploadImage(supabase, 'pix_qr', PIX_QR_FOLDER, qrFile);
        uploadedPath = uploaded.path;
        qrImageUrl = uploaded.file_url;
      }
      const out = await setPlatformPixSettings(supabase, {
        ...pixForm,
        qr_image_url: qrImageUrl,
      });
      saved = true;
      setQrFile(null);
      const previousPath = out?.previous_qr_image_path;
      if (previousPath && previousPath !== out?.qr_image_path) {
        try {
          await deleteImage(supabase, PLATFORM_ASSETS_BUCKET, previousPath);
        } catch {
          notify({
            title: 'Configuração salva',
            description: 'A imagem anterior não pôde ser removida do armazenamento.',
            variant: 'destructive',
          });
        }
      }
      notify({ title: 'Configuração Pix atualizada' });
      await load();
    } catch (err) {
      if (uploadedPath && !saved) {
        await deleteImage(supabase, PLATFORM_ASSETS_BUCKET, uploadedPath).catch(() => {});
      }
      setPixError(err?.message || 'Não foi possível salvar a configuração Pix.');
    } finally {
      setSavingPix(false);
    }
  };

  const handleSaveExpiry = async () => {
    setSavingExpiry(true);
    try {
      await setPlanPurchaseExpiryDays(supabase, expiryDays);
      notify({ title: 'Validade das solicitações atualizada' });
      await load();
    } catch (err) {
      notify({ title: 'Erro ao atualizar validade', description: err?.message, variant: 'destructive' });
    } finally {
      setSavingExpiry(false);
    }
  };

  const currentQrUrl = qrPreview || getPixQrPublicUrl(supabase, pixForm.qr_image_path) || pixForm.qr_image_url;

  return (
    <div>
      <PageHeader title="Compras Pix" description="Confirmação manual de Pix e configuração de recebimento">
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={load}>
          <RefreshCw className="h-3.5 w-3.5" /> Atualizar
        </Button>
      </PageHeader>

      <div className="flex flex-wrap gap-1.5 mb-4">
        <button
          type="button"
          onClick={() => setTab('pendentes')}
          className={`rounded-full px-3 h-8 text-xs font-medium transition-colors ${
            tab === 'pendentes' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
          }`}
        >
          Pendentes{pendingCount > 0 ? ` (${pendingCount})` : ''}
        </button>
        <button
          type="button"
          onClick={() => setTab('historico')}
          className={`rounded-full px-3 h-8 text-xs font-medium transition-colors ${
            tab === 'historico' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
          }`}
        >
          Histórico
        </button>
        <button
          type="button"
          onClick={() => setTab('config')}
          className={`rounded-full px-3 h-8 text-xs font-medium transition-colors ${
            tab === 'config' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
          }`}
        >
          Configuração Pix
        </button>
      </div>

      {tab === 'config' ? (
        <div className="space-y-4">
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="font-heading font-semibold text-foreground">Validade das solicitações pendentes</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Solicitações não confirmadas expiram automaticamente após esse prazo, em dias corridos.
                </p>
              </div>
              <div className="flex items-end gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="purchase-expiry-days">Dias</Label>
                  <Input
                    id="purchase-expiry-days"
                    type="number"
                    min="1"
                    step="1"
                    className="w-24"
                    value={expiryDays}
                    onChange={(event) => setExpiryDays(event.target.value)}
                    disabled={savingExpiry}
                  />
                </div>
                <Button variant="outline" onClick={handleSaveExpiry} disabled={savingExpiry}>
                  {savingExpiry ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Salvar'}
                </Button>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="flex items-center gap-2 font-heading font-semibold text-foreground">
                  <QrCode className="h-4 w-4" /> Recebimento Pix
                </h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  A chave e o QR são entregues somente pela RPC de instruções da própria solicitação.
                </p>
              </div>
              <Badge className={pixSettings?.active ? 'bg-green-100 text-green-800' : 'bg-muted text-muted-foreground'}>
                {pixSettings?.active ? 'Ativo' : 'Inativo'}
              </Badge>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pix-key-type">Tipo de chave</Label>
                <select
                  id="pix-key-type"
                  value={pixForm.pix_key_type}
                  onChange={(event) => updatePixForm('pix_key_type', event.target.value)}
                  disabled={savingPix}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="">Selecione</option>
                  {PIX_KEY_TYPES.map((type) => (
                    <option key={type.id} value={type.id}>{type.label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pix-key">Chave Pix</Label>
                <Input
                  id="pix-key"
                  value={pixForm.pix_key}
                  onChange={(event) => updatePixForm('pix_key', event.target.value)}
                  maxLength={500}
                  disabled={savingPix}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pix-receiver">Nome do recebedor</Label>
                <Input
                  id="pix-receiver"
                  value={pixForm.receiver_name}
                  onChange={(event) => updatePixForm('receiver_name', event.target.value)}
                  maxLength={200}
                  disabled={savingPix}
                />
              </div>
              <div className="flex items-center gap-2 rounded-xl border border-border p-3">
                <Switch
                  checked={!!pixForm.active}
                  onCheckedChange={(value) => updatePixForm('active', value)}
                  disabled={savingPix}
                />
                <Label className="cursor-pointer">Exibir instruções Pix ativas</Label>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="pix-qr-file" className="flex items-center gap-1.5">
                  <Upload className="h-3.5 w-3.5" /> QR Code Pix
                </Label>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    id="pix-qr-file"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handleQrFileChange}
                    disabled={savingPix}
                    className="max-w-sm cursor-pointer"
                  />
                  {currentQrUrl && (
                    <Button type="button" variant="outline" size="sm" onClick={handleRemoveQr} disabled={savingPix}>
                      <Trash2 className="h-4 w-4" /> Remover imagem
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  PNG, JPG ou WEBP, até 5 MB. A imagem é armazenada no bucket privado de escrita do Master.
                </p>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="pix-payload">Pix copia e cola (opcional)</Label>
                <Textarea
                  id="pix-payload"
                  rows={3}
                  value={pixForm.qr_payload}
                  onChange={(event) => updatePixForm('qr_payload', event.target.value)}
                  maxLength={4000}
                  disabled={savingPix}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="pix-instructions">Instruções para o cliente (opcional)</Label>
                <Textarea
                  id="pix-instructions"
                  rows={3}
                  value={pixForm.instructions}
                  onChange={(event) => updatePixForm('instructions', event.target.value)}
                  maxLength={2000}
                  disabled={savingPix}
                />
              </div>
            </div>

            {currentQrUrl && (
              <div className="mt-3">
                <p className="mb-1 text-xs text-muted-foreground">
                  {qrPreview ? 'Prévia da nova imagem' : 'QR Code atual'}
                </p>
                <img
                  src={currentQrUrl}
                  alt="Prévia do QR Code Pix"
                  className="h-32 w-32 rounded-lg border border-border bg-white object-contain p-1"
                />
              </div>
            )}

            {pixError && (
              <div className="mt-3 flex items-start gap-2 rounded-lg bg-destructive/10 p-2.5 text-xs text-destructive">
                <AlertTriangle className="h-4 w-4 shrink-0" /> {pixError}
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
              <Button onClick={handleSavePix} disabled={savingPix}>
                {savingPix ? <Loader2 className="h-4 w-4 animate-spin" /> : <Settings className="h-4 w-4" />}
                Salvar configuração
              </Button>
              {pixSettings?.version != null && (
                <span className="text-xs text-muted-foreground">
                  Versão {pixSettings.version}
                  {pixSettings.updated_at ? ` · Atualizada em ${fmtDate(pixSettings.updated_at, true)}` : ''}
                </span>
              )}
            </div>
          </div>
        </div>
      ) : requests.length === 0 ? (
        <div className="text-center py-16">
          {tab === 'pendentes' ? (
            <Clock className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          ) : (
            <History className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          )}
          <p className="font-medium text-foreground">
            {tab === 'pendentes' ? 'Nenhuma compra pendente' : 'Nenhuma compra registrada'}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            {tab === 'pendentes'
              ? 'As solicitações de compra com Pix aparecerão aqui.'
              : 'O histórico das solicitações confirmadas, rejeitadas, canceladas e expiradas aparecerá aqui.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {requests.map((request) => (
            <div key={request.id} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-heading font-bold text-foreground">
                    <Building2 className="h-4 w-4 shrink-0" />
                    {request.company_name || 'Empresa'}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {request.plan_name} · {fmtMoney(request.price, request.currency)} · {request.access_days} dias
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Solicitado por {request.requested_by_name || request.requested_by_email || 'usuário'} em {fmtDate(request.created_at, true)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Revendedor: {request.reseller_name || request.reseller_email || 'Sem revendedor vinculado'}
                    {request.reseller_name && request.reseller_email ? ` (${request.reseller_email})` : ''}
                  </p>
                </div>
                <Badge className={STATUS_TONE[request.status] || ''}>{planPurchaseStatusLabel(request.status)}</Badge>
              </div>

              <div className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                <p>Referência: {request.payment_reference || '-'}</p>
                <p>Pagador: {request.payer_name || '-'}</p>
                {request.pending_expires_at && <p>Expira em: {fmtDate(request.pending_expires_at, true)}</p>}
                {request.confirmed_amount != null && (
                  <p>Valor confirmado: {fmtMoney(request.confirmed_amount, request.confirmed_currency || request.currency)}</p>
                )}
                {request.confirmed_at && <p>Confirmada em: {fmtDate(request.confirmed_at, true)}</p>}
                {request.activated_at && <p>Ativada em: {fmtDate(request.activated_at, true)}</p>}
                {request.rejected_at && <p>Rejeitada em: {fmtDate(request.rejected_at, true)}</p>}
                {request.canceled_at && <p>Cancelada em: {fmtDate(request.canceled_at, true)}</p>}
                {request.expired_at && <p>Expirada em: {fmtDate(request.expired_at, true)}</p>}
                {request.pix_settings_version != null && <p>Versão Pix: {request.pix_settings_version}</p>}
              </div>

              {request.proof_url && (
                <a
                  href={request.proof_url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-block text-xs font-medium text-primary hover:underline"
                >
                  Abrir comprovante
                </a>
              )}

              {request.reason && (
                <p className="mt-2 text-xs text-muted-foreground">Motivo: {request.reason}</p>
              )}

              {request.status === 'pendente' && (
                <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
                  <Button size="sm" onClick={() => openConfirm(request)}>
                    <Check className="h-4 w-4" /> Confirmar recebimento
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => openReject(request)}>
                    <X className="h-4 w-4" /> Rejeitar
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog
        open={!!confirmTarget}
        onOpenChange={(open) => { if (!open && !confirming) setConfirmTarget(null); }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirmar pagamento</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-xl bg-muted/50 p-3 text-sm">
              <p className="font-medium text-foreground">{confirmTarget?.company_name}</p>
              <p className="text-muted-foreground mt-0.5">
                {confirmTarget?.plan_name} · {fmtMoney(confirmTarget?.price, confirmTarget?.currency)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {confirmTarget?.requested_by_name || confirmTarget?.requested_by_email || 'Usuário'}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Revendedor: {confirmTarget?.reseller_name || confirmTarget?.reseller_email || 'Sem revendedor vinculado'}
                {confirmTarget?.reseller_name && confirmTarget?.reseller_email ? ` (${confirmTarget.reseller_email})` : ''}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-reference">Referência do pagamento</Label>
              <Input
                id="confirm-reference"
                value={confirmReference}
                onChange={(event) => setConfirmReference(event.target.value)}
                maxLength={200}
                disabled={confirming}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-amount">Valor confirmado</Label>
              <Input
                id="confirm-amount"
                type="number"
                min="0"
                step="0.01"
                value={confirmedAmount}
                onChange={(event) => setConfirmedAmount(event.target.value)}
                disabled={confirming}
              />
              <p className="text-[11px] text-muted-foreground">
                Deve ser igual ao valor da solicitação: {fmtMoney(confirmTarget?.price, confirmTarget?.currency)}.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-reason">Observação (opcional)</Label>
              <Textarea
                id="confirm-reason"
                rows={2}
                value={confirmReason}
                onChange={(event) => setConfirmReason(event.target.value)}
                maxLength={1000}
                disabled={confirming}
              />
            </div>
            {confirmError && (
              <div className="rounded-lg bg-destructive/10 p-2.5 text-xs text-destructive">{confirmError}</div>
            )}
            <p className="text-[11px] text-muted-foreground">
              A confirmação ativa o plano na mesma transação e não pode ser desfeita pela tela.
            </p>
            <Button className="w-full" onClick={handleConfirm} disabled={confirming}>
              {confirming ? 'Confirmando...' : 'Confirmar e ativar plano'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!rejectTarget}
        onOpenChange={(open) => { if (!open && !rejecting) setRejectTarget(null); }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Rejeitar solicitação</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-xl bg-muted/50 p-3 text-sm">
              <p className="font-medium text-foreground">{rejectTarget?.company_name}</p>
              <p className="text-muted-foreground mt-0.5">
                {rejectTarget?.plan_name} · {fmtMoney(rejectTarget?.price, rejectTarget?.currency)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Revendedor: {rejectTarget?.reseller_name || rejectTarget?.reseller_email || 'Sem revendedor vinculado'}
                {rejectTarget?.reseller_name && rejectTarget?.reseller_email ? ` (${rejectTarget.reseller_email})` : ''}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reject-reason">Motivo da rejeição</Label>
              <Textarea
                id="reject-reason"
                rows={3}
                value={rejectReason}
                onChange={(event) => setRejectReason(event.target.value)}
                maxLength={1000}
                placeholder="Descreva o motivo da rejeição"
                disabled={rejecting}
              />
            </div>
            {rejectError && (
              <div className="rounded-lg bg-destructive/10 p-2.5 text-xs text-destructive">{rejectError}</div>
            )}
            <p className="text-[11px] text-muted-foreground">
              A rejeição não apaga a solicitação e não ativa o plano.
            </p>
            <Button className="w-full" variant="destructive" onClick={handleReject} disabled={rejecting}>
              {rejecting ? 'Rejeitando...' : 'Rejeitar solicitação'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
