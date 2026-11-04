import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/api/supabaseClient';
import { listPlans } from '@/api/plans';
import { getPixQrPublicUrl } from '@/api/storage';
import { loadManagedResellerAccess } from '@/lib/assinaturaAccess';
import { manageSubscription as sbManageSubscription } from '@/api/subscriptions';
import {
  createPlanPurchaseRequest,
  submitPlanPurchasePayment,
  cancelPlanPurchaseRequest,
  getMyPlanPurchaseRequests,
  getPlanPurchasePixInstructions,
  expirePlanPurchaseRequests,
  newIdempotencyKey,
  planPurchaseStatusLabel,
} from '@/api/planPurchases';
import { useCompany } from '@/hooks/useCompany';
import { useSubscription } from '@/hooks/useSubscription';
import PageHeader from '@/components/PageHeader';
import ConfirmDialog from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import {
  Check, Crown, Clock, CreditCard, TrendingUp, Package, Users, Loader2,
  AlertCircle, Copy, QrCode, Send, XCircle, CheckCircle2, History,
} from 'lucide-react';

const fmtCurrency = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
const fmtDateTime = (v) => {
  if (!v) return '-';
  const date = new Date(v);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('pt-BR');
};

const STATUS_CONFIG = {
  trial: { label: 'Trial', cls: 'bg-blue-100 text-blue-700' },
  ativo: { label: 'Ativo', cls: 'bg-green-100 text-green-700' },
  pendente: { label: 'Pendente', cls: 'bg-yellow-100 text-yellow-700' },
  cancelado: { label: 'Cancelado', cls: 'bg-red-100 text-red-700' },
  suspenso: { label: 'Suspenso', cls: 'bg-orange-100 text-orange-700' },
  expirado: { label: 'Expirado', cls: 'bg-gray-100 text-gray-700' },
};

const PURCHASE_STATUS_TONE = {
  pendente: 'bg-amber-100 text-amber-900',
  confirmada: 'bg-green-100 text-green-800',
  rejeitada: 'bg-red-100 text-red-800',
  cancelada: 'bg-muted text-muted-foreground',
  expirada: 'bg-orange-100 text-orange-800',
};

const PIX_KEY_TYPE_LABEL = {
  cpf: 'CPF',
  cnpj: 'CNPJ',
  email: 'E-mail',
  phone: 'Telefone',
  random: 'Chave aleatória',
};

function Spinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-4 border-border border-t-primary rounded-full animate-spin" />
    </div>
  );
}

export default function Assinatura() {
  const { loading: companyLoading, company } = useCompany();
  const {
    loading: subLoading, subscription, plan, trialDaysLeft, isCanceled, isFree,
    expiresAt, setSubscription, reload: reloadSubscription,
  } = useSubscription(company?.id);
  const { toast } = useToast();
  const [plans, setPlans] = useState([]);
  const [usage, setUsage] = useState({ products: 0, orders: 0, customers: 0 });
  const [actionLoading, setActionLoading] = useState(null);
  const [cancelDialog, setCancelDialog] = useState(false);
  const [managedAccess, setManagedAccess] = useState(null);
  const [accessLoading, setAccessLoading] = useState(true);
  const [purchaseRequests, setPurchaseRequests] = useState([]);
  const [purchasesLoading, setPurchasesLoading] = useState(false);
  const [pendingRequest, setPendingRequest] = useState(null);
  const [pix, setPix] = useState(null);
  const [pixLoading, setPixLoading] = useState(false);
  const [purchaseError, setPurchaseError] = useState('');
  const [paymentForm, setPaymentForm] = useState({ reference: '', payerName: '', proofUrl: '' });
  const [submittingPayment, setSubmittingPayment] = useState(false);
  const [cancelPurchaseDialog, setCancelPurchaseDialog] = useState(false);
  const purchaseKeys = useRef(new Map());

  useEffect(() => {
    let cancelled = false;
    setAccessLoading(true);
    loadManagedResellerAccess(supabase)
      .then((access) => { if (!cancelled) setManagedAccess(access); })
      .catch(() => { if (!cancelled) setManagedAccess(null); })
      .finally(() => { if (!cancelled) setAccessLoading(false); });
    return () => { cancelled = true; };
  }, [company?.id]);

  useEffect(() => {
    listPlans(supabase, { onlyActive: true }).then(setPlans).catch(() => {});
  }, []);

  useEffect(() => {
    const loadUsage = async () => {
      if (!company) return;
      try {
        const count = async (table) => {
          const { count, error } = await supabase.from(table).select('id', { count: 'exact', head: true }).eq('company_id', company.id);
          if (error) throw error;
          return count || 0;
        };
        const [prods, ords, custs] = await Promise.all([
          count('products'), count('orders'), count('customers'),
        ]);
        setUsage({ products: prods, orders: ords, customers: custs });
      } catch (e) { /* ignore */ }
    };
    loadUsage();
  }, [company]);

  const loadPurchases = useCallback(async () => {
    if (!company?.id) return;
    setPurchasesLoading(true);
    setPurchaseError('');
    try {
      await expirePlanPurchaseRequests(supabase);
      const rows = await getMyPlanPurchaseRequests(supabase, company.id);
      setPurchaseRequests(rows);
      const pending = rows.find((row) => row.status === 'pendente') || null;
      setPendingRequest(pending);
      if (!pending) {
        setPix(null);
        return;
      }
      setPixLoading(true);
      try {
        setPix(await getPlanPurchasePixInstructions(supabase, pending.id));
      } catch (err) {
        setPix(null);
        setPurchaseError(err?.message || 'Não foi possível carregar as instruções Pix.');
      } finally {
        setPixLoading(false);
      }
    } catch (err) {
      setPurchaseError(err?.message || 'Não foi possível carregar as compras.');
    } finally {
      setPurchasesLoading(false);
    }
  }, [company?.id]);

  useEffect(() => {
    if (!accessLoading && !managedAccess) loadPurchases();
  }, [accessLoading, managedAccess, loadPurchases]);

  if (companyLoading || subLoading || accessLoading) return <Spinner />;
  if (!company) return null;

  if (managedAccess) {
    const expires = managedAccess.access_expires_at
      ? new Date(managedAccess.access_expires_at).toLocaleDateString('pt-BR')
      : null;
    return (
      <div>
        <PageHeader title="Assinatura" description="Seu acesso é gerenciado pelo revendedor" children={null} />
        <div className="rounded-2xl border border-border bg-card p-6">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
              <Crown className="h-7 w-7 text-primary" />
            </div>
            <div>
              <h2 className="font-heading text-xl font-bold text-foreground">Assinatura gerenciada</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Empresa: <strong>{managedAccess.company_name || company.name}</strong>
              </p>
              <p className="text-sm text-muted-foreground">
                Plano: <strong>{managedAccess.plan_name || plan?.name || 'Plano do revendedor'}</strong>
              </p>
              {expires && <p className="text-sm text-muted-foreground">Válido até: <strong>{expires}</strong></p>}
              <p className="text-sm text-muted-foreground mt-3">
                Para renovar ou alterar o plano, fale com <strong>{managedAccess.reseller_name || 'seu revendedor'}</strong>.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const currentPlanId = subscription?.plan_id;
  const status = subscription ? STATUS_CONFIG[subscription.status] : null;

  const handleUpgrade = async (planId) => {
    setActionLoading(planId);
    setPurchaseError('');
    try {
      const updated = await sbManageSubscription(supabase, { action: 'upgrade', planId });
      setSubscription(updated);
      await reloadSubscription();
      toast({ title: 'Plano atualizado com sucesso!' });
    } catch (err) {
      toast({ title: 'Erro', description: err?.message || 'Tente novamente', variant: 'destructive' });
    } finally { setActionLoading(null); }
  };

  const handleSelectPlan = async (selectedPlan) => {
    if (selectedPlan.is_free) {
      await handleUpgrade(selectedPlan.id);
      return;
    }
    setActionLoading(selectedPlan.id);
    setPurchaseError('');
    try {
      let key = purchaseKeys.current.get(selectedPlan.id);
      if (!key) {
        key = newIdempotencyKey();
        purchaseKeys.current.set(selectedPlan.id, key);
      }
      const out = await createPlanPurchaseRequest(supabase, {
        companyId: company.id,
        planId: selectedPlan.id,
        idempotencyKey: key,
      });
      purchaseKeys.current.delete(selectedPlan.id);
      setPaymentForm({ reference: '', payerName: '', proofUrl: '' });
      toast({
        duration: undefined,
        title: out?.reused ? 'Solicitação já existente' : 'Solicitação de compra criada',
        description: 'Pague via Pix e informe a referência para o Master confirmar.',
      });
      await loadPurchases();
    } catch (err) {
      setPurchaseError(err?.message || 'Não foi possível criar a solicitação de compra.');
    } finally { setActionLoading(null); }
  };

  const handleSubmitPayment = async () => {
    if (!pendingRequest) return;
    setSubmittingPayment(true);
    setPurchaseError('');
    try {
      await submitPlanPurchasePayment(supabase, pendingRequest.id, {
        paymentReference: paymentForm.reference,
        payerName: paymentForm.payerName,
        proofUrl: paymentForm.proofUrl,
      });
      toast({
        duration: undefined,
        title: 'Pagamento informado',
        description: 'Aguarde a confirmação manual do Master para ativar o plano.',
      });
      setPaymentForm({ reference: '', payerName: '', proofUrl: '' });
      await loadPurchases();
    } catch (err) {
      setPurchaseError(err?.message || 'Não foi possível enviar a referência do pagamento.');
    } finally { setSubmittingPayment(false); }
  };

  const handleCancelPurchase = async () => {
    if (!pendingRequest) return;
    try {
      await cancelPlanPurchaseRequest(supabase, pendingRequest.id, 'Cancelado pelo cliente');
      toast({ duration: undefined, title: 'Solicitação cancelada' });
      setCancelPurchaseDialog(false);
      await loadPurchases();
    } catch (err) {
      toast({ duration: undefined, title: 'Erro ao cancelar', description: err?.message, variant: 'destructive' });
    }
  };

  const handleCopy = async (value, label) => {
    try {
      await navigator.clipboard.writeText(value);
      toast({ duration: undefined, title: `${label} copiado` });
    } catch {
      toast({ duration: undefined, title: 'Não foi possível copiar', variant: 'destructive' });
    }
  };

  const handleCancel = async () => {
    try {
      const updated = await sbManageSubscription(supabase, { action: 'cancel' });
      setSubscription(updated);
      toast({ title: 'Assinatura cancelada' });
    } catch (err) {
      toast({ title: 'Erro', description: err?.message || 'Tente novamente', variant: 'destructive' });
    } finally { setCancelDialog(false); }
  };

  const handleReactivate = async () => {
    setActionLoading('reactivate');
    try {
      const updated = await sbManageSubscription(supabase, { action: 'reactivate' });
      setSubscription(updated);
      toast({ title: 'Assinatura reativada!' });
    } catch (err) {
      toast({ title: 'Erro', description: err?.message || 'Tente novamente', variant: 'destructive' });
    } finally { setActionLoading(null); }
  };

  const pixQrUrl = getPixQrPublicUrl(supabase, pix?.qr_image_path) || pix?.qr_image_url || '';

  const usageBars = [
    { icon: Package, label: 'Produtos', current: usage.products, limit: plan?.limits_products ?? -1 },
    { icon: TrendingUp, label: 'Pedidos', current: usage.orders, limit: plan?.limits_orders ?? -1 },
    { icon: Users, label: 'Clientes', current: usage.customers, limit: plan?.limits_customers ?? -1 },
  ];

  return (
    <div>
      <PageHeader title="Assinatura" description="Gerencie seu plano e cobrança" />

      <div className="rounded-2xl border border-border bg-card p-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
              <Crown className="h-7 w-7 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-heading text-xl font-bold text-foreground">{plan?.name || 'Sem plano'}</h2>
                {status && <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${status.cls}`}>{status.label}</span>}
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">
                {isFree ? 'Gratuito' : plan?.price ? `${fmtCurrency(plan.price)}/mês` : 'Sem cobrança'}
                {expiresAt && subscription?.status === 'ativo' && !isFree && ` • Válido até: ${new Date(expiresAt).toLocaleDateString('pt-BR')}`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isCanceled ? (
              <Button onClick={handleReactivate} disabled={actionLoading === 'reactivate'} className="bg-primary hover:bg-primary/90">
                {actionLoading === 'reactivate' && <Loader2 className="h-4 w-4 animate-spin" />} Reativar
              </Button>
            ) : subscription?.status === 'trial' ? (
              trialDaysLeft > 0 ? (
                <div className="flex items-center gap-2 rounded-xl bg-blue-50 px-4 py-2">
                  <Clock className="h-4 w-4 text-blue-600" />
                  <span className="text-sm font-medium text-blue-700">{trialDaysLeft} dias restantes</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-xl bg-yellow-50 px-4 py-2">
                  <AlertCircle className="h-4 w-4 text-yellow-700" />
                  <span className="text-sm font-medium text-yellow-800">Teste expirado</span>
                </div>
              )
            ) : null}
            {!isCanceled && !isFree && subscription && (
              <Button variant="outline" onClick={() => setCancelDialog(true)}>Cancelar</Button>
            )}
          </div>
        </div>

        {subscription?.status === 'trial' && trialDaysLeft <= 3 && trialDaysLeft > 0 && (
          <div className="mt-4 flex items-center gap-2 rounded-xl bg-yellow-50 p-3 text-sm text-yellow-700">
            <AlertCircle className="h-4 w-4 shrink-0" /> Seu trial termina em {trialDaysLeft} {trialDaysLeft === 1 ? 'dia' : 'dias'}. Assine um plano para continuar.
          </div>
        )}

        {subscription?.status === 'trial' && trialDaysLeft === 0 && (
          <div className="mt-4 flex items-center gap-2 rounded-xl bg-yellow-50 p-3 text-sm text-yellow-700">
            <AlertCircle className="h-4 w-4 shrink-0" /> Seu teste terminou. Escolha um plano para continuar.
          </div>
        )}

        {plan && (
          <div className="mt-6 grid gap-4 sm:grid-cols-3 border-t border-border pt-4">
            {usageBars.map((u, i) => {
              const pct = u.limit === -1 ? 0 : u.limit === 0 ? 100 : Math.min(100, (u.current / u.limit) * 100);
              return (
                <div key={i}>
                  <div className="flex items-center justify-between text-sm mb-1.5">
                    <span className="flex items-center gap-1.5 text-muted-foreground"><u.icon className="h-4 w-4" /> {u.label}</span>
                    <span className="font-medium text-foreground">{u.current} / {u.limit === -1 ? '∞' : u.limit}</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div className={`h-full rounded-full ${pct > 80 ? 'bg-destructive' : 'bg-primary'}`} style={{ width: u.limit === -1 ? '100%' : `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {purchaseError && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" /> {purchaseError}
        </div>
      )}

      {pendingRequest && (
        <div className="mb-6 rounded-2xl border border-amber-300 bg-amber-50/60 p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="flex items-center gap-2 font-heading text-lg font-bold text-foreground">
                <CheckCircle2 className="h-5 w-5 text-amber-600" /> Compra aguardando confirmação
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {pendingRequest.plan_name} · {fmtCurrency(pendingRequest.price)} · {pendingRequest.access_days} dias
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Solicitada em {fmtDateTime(pendingRequest.created_at)}
                {pendingRequest.pending_expires_at ? ` · Expira em ${fmtDateTime(pendingRequest.pending_expires_at)}` : ''}
              </p>
            </div>
            <span className={`w-fit rounded-full px-2.5 py-0.5 text-xs font-medium ${PURCHASE_STATUS_TONE[pendingRequest.status] || ''}`}>
              {planPurchaseStatusLabel(pendingRequest.status)}
            </span>
          </div>

          <div className="mt-4 rounded-xl border border-amber-200 bg-white/70 p-4">
            <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <QrCode className="h-4 w-4" /> Instruções Pix
            </h4>
            {pixLoading ? (
              <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando instruções...
              </div>
            ) : pix?.available ? (
              <div className="mt-3 space-y-3">
                {pix.version_changed && (
                  <div className="flex items-start gap-2 rounded-lg bg-amber-100 p-2.5 text-xs text-amber-900">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    As instruções Pix foram atualizadas. Confira a chave antes de pagar.
                  </div>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Chave Pix</p>
                    <div className="mt-1 flex items-center gap-2">
                      <code className="min-w-0 flex-1 break-all rounded-lg bg-muted px-2 py-1.5 text-xs text-foreground">{pix.pix_key}</code>
                      <Button size="sm" variant="outline" className="h-8 px-2" onClick={() => handleCopy(pix.pix_key, 'Chave Pix')}>
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    {pix.pix_key_type && (
                      <p className="mt-1 text-xs text-muted-foreground">Tipo: {PIX_KEY_TYPE_LABEL[pix.pix_key_type] || pix.pix_key_type}</p>
                    )}
                  </div>
                  <div>
                    {pix.receiver_name && (
                      <>
                        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Recebedor</p>
                        <p className="mt-1 text-sm font-medium text-foreground">{pix.receiver_name}</p>
                      </>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">Valor: {fmtCurrency(pix.price)}</p>
                  </div>
                </div>
                {pixQrUrl && (
                  <img src={pixQrUrl} alt="QR Code Pix" className="h-40 w-40 rounded-lg border border-border bg-white object-contain p-1" />
                )}
                {pix.qr_payload && (
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Pix copia e cola</p>
                    <div className="mt-1 flex items-start gap-2">
                      <code className="min-w-0 flex-1 break-all rounded-lg bg-muted px-2 py-1.5 text-xs text-foreground">{pix.qr_payload}</code>
                      <Button size="sm" variant="outline" className="h-8 px-2" onClick={() => handleCopy(pix.qr_payload, 'Pix copia e cola')}>
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                )}
                {pix.instructions && <p className="whitespace-pre-line text-xs text-muted-foreground">{pix.instructions}</p>}
                <p className="text-xs text-muted-foreground">
                  Use a chave ou o QR Code acima. A imagem é uma instrução de pagamento e não confirma a compra;
                  o plano só será ativado após a confirmação manual do Master.
                </p>
              </div>
            ) : (
              <div className="mt-3 flex items-start gap-2 rounded-lg bg-yellow-100 p-2.5 text-xs text-yellow-900">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {pix && !pix.active
                  ? 'O Pix está desativado no momento. Sua solicitação permanece pendente; fale com o Master.'
                  : pix && !pix.configured
                    ? 'A chave Pix ainda não foi configurada pelo Master. Sua solicitação permanece pendente.'
                    : 'As instruções Pix ainda não estão disponíveis. Sua solicitação permanece pendente; fale com o Master para receber a chave.'}
              </div>
            )}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="purchase-reference">Referência do pagamento</Label>
              <Input
                id="purchase-reference"
                value={paymentForm.reference}
                onChange={(event) => setPaymentForm((prev) => ({ ...prev, reference: event.target.value }))}
                placeholder="Ex.: ID da transação Pix"
                maxLength={200}
                disabled={submittingPayment}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="purchase-payer">Nome do pagador (opcional)</Label>
              <Input
                id="purchase-payer"
                value={paymentForm.payerName}
                onChange={(event) => setPaymentForm((prev) => ({ ...prev, payerName: event.target.value }))}
                maxLength={200}
                disabled={submittingPayment}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="purchase-proof">URL do comprovante (opcional)</Label>
              <Input
                id="purchase-proof"
                value={paymentForm.proofUrl}
                onChange={(event) => setPaymentForm((prev) => ({ ...prev, proofUrl: event.target.value }))}
                placeholder="https://..."
                maxLength={1000}
                disabled={submittingPayment}
              />
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={handleSubmitPayment} disabled={submittingPayment || !paymentForm.reference.trim()}>
              {submittingPayment ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Informar pagamento
            </Button>
            <Button variant="outline" onClick={() => setCancelPurchaseDialog(true)} disabled={submittingPayment}>
              <XCircle className="h-4 w-4" /> Cancelar solicitação
            </Button>
          </div>
          {pendingRequest.payment_reference && (
            <p className="mt-3 text-xs text-muted-foreground">
              Referência já informada: <strong>{pendingRequest.payment_reference}</strong>
            </p>
          )}
          <p className="mt-2 text-[11px] text-muted-foreground">
            O plano só será ativado depois que o Master confirmar o recebimento.
          </p>
        </div>
      )}

      <h3 className="font-heading text-lg font-semibold text-foreground mb-4">Escolha seu plano</h3>
      {pendingRequest && (
        <p className="mb-3 text-xs text-muted-foreground">
          Resolva a solicitação pendente acima antes de escolher outro plano.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {plans.map(p => {
          const isCurrent = p.id === currentPlanId;
          const unavailable = !p.is_free && !(p.access_days > 0);
          return (
            <div key={p.id} className={`relative rounded-2xl border bg-card p-5 flex flex-col ${p.is_popular ? 'border-primary shadow-lg' : 'border-border'} ${isCurrent ? 'ring-2 ring-primary' : ''}`}>
              {p.is_popular && <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">Popular</div>}
              <h4 className="font-heading font-bold text-foreground">{p.name}</h4>
              <p className="mt-1">
                {p.is_free
                  ? <span className="font-heading text-2xl font-bold text-foreground">Gratuito</span>
                  : <><span className="font-heading text-2xl font-bold text-foreground">{fmtCurrency(p.price)}</span><span className="text-sm text-muted-foreground">/mês</span></>}
              </p>
              <ul className="mt-3 space-y-1.5 flex-1">
                {p.features?.map((f, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <Check className="h-3.5 w-3.5 text-green-600 shrink-0 mt-0.5" /> {f}
                  </li>
                ))}
              </ul>
              {isCurrent ? (
                <div className="mt-4 rounded-lg bg-muted py-2 text-center text-sm font-medium text-muted-foreground">Plano atual</div>
              ) : (
                <Button
                  onClick={() => handleSelectPlan(p)}
                  disabled={!!pendingRequest || unavailable || actionLoading === p.id}
                  className={`mt-4 ${p.is_popular ? 'bg-primary hover:bg-primary/90' : ''}`}
                  variant={p.is_popular ? 'default' : 'outline'}
                  title={unavailable ? 'Plano sem duração de acesso configurada' : undefined}
                >
                  {actionLoading === p.id
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : unavailable ? 'Indisponível' : p.is_free ? 'Assinar' : 'Comprar com Pix'}
                </Button>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-8 rounded-2xl border border-border bg-card p-6">
        <h3 className="flex items-center gap-2 font-heading font-semibold text-foreground mb-4">
          <History className="h-4 w-4" /> Histórico de compras
        </h3>
        {purchasesLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando histórico...
          </div>
        ) : purchaseRequests.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground">
            <CreditCard className="mx-auto h-10 w-10 mb-2 opacity-50" />
            Nenhuma compra registrada ainda.
          </div>
        ) : (
          <div className="space-y-2">
            {purchaseRequests.map((request) => (
              <div key={request.id} className="rounded-xl border border-border p-3">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {request.plan_name} · {fmtCurrency(request.price)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {fmtDateTime(request.created_at)}
                      {request.payment_reference ? ` · Ref.: ${request.payment_reference}` : ''}
                    </p>
                  </div>
                  <span className={`w-fit rounded-full px-2.5 py-0.5 text-xs font-medium ${PURCHASE_STATUS_TONE[request.status] || ''}`}>
                    {planPurchaseStatusLabel(request.status)}
                  </span>
                </div>
                {request.reason && (
                  <p className="mt-2 text-xs text-muted-foreground">Motivo: {request.reason}</p>
                )}
                {request.activated_at && (
                  <p className="mt-1 text-xs text-green-700">Ativada em {fmtDateTime(request.activated_at)}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={cancelDialog}
        onOpenChange={setCancelDialog}
        title="Cancelar assinatura"
        description="Deseja realmente cancelar? Você continuará com acesso até o fim do período pago."
        onConfirm={handleCancel}
        confirmLabel="Cancelar assinatura"
      />

      <ConfirmDialog
        open={cancelPurchaseDialog}
        onOpenChange={setCancelPurchaseDialog}
        title="Cancelar solicitação de compra"
        description={pendingRequest
          ? `Cancelar a compra de ${pendingRequest.plan_name}? Nenhum plano será ativado.`
          : ''}
        onConfirm={handleCancelPurchase}
        confirmLabel="Cancelar solicitação"
      />
    </div>
  );
}
