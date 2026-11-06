import React, { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { supabase } from '@/api/supabaseClient';
import {
  creditKindLabel, getResellerCreditBalance, listResellerCreditEntries,
  summarizeCreditEntries,
} from '@/api/resellerCredits';
import {
  cancelResellerCreditOrder, createResellerCreditOrder, creditOrderStatusLabel,
  expireResellerCreditOrders, listResellerCreditOrders, listResellerCreditPackages,
  newIdempotencyKey, submitResellerCreditOrderProof,
} from '@/api/resellerCreditPurchases';
import { uploadResellerReceipt } from '@/api/storage';
import PageHeader from '@/components/PageHeader';
import ConfirmDialog from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import {
  ArrowDownLeft, ArrowUpRight, CheckCircle2, Clock, FileImage, Package, RefreshCw, ShoppingCart, Wallet, X,
} from 'lucide-react';

const ORDER_TONE = {
  pendente: 'bg-amber-100 text-amber-900',
  creditado: 'bg-green-100 text-green-800',
  cancelado: 'bg-muted text-muted-foreground',
  rejeitado: 'bg-red-100 text-red-800',
  expirado: 'bg-orange-100 text-orange-800',
};

function Spinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-4 border-border border-t-primary rounded-full animate-spin" />
    </div>
  );
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('pt-BR');
}

function fmtMoney(value, currency = 'BRL') {
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(Number(value) || 0);
  } catch {
    return `${currency} ${Number(value) || 0}`;
  }
}

export default function ResellerCreditos() {
  const outletContext = /** @type {{ reseller?: { id?: string } }} */ (useOutletContext());
  const reseller = outletContext?.reseller;
  const { toast } = useToast();
  const notify = (props) => toast({ duration: 4000, ...props });
  const [balance, setBalance] = useState(0);
  const [entries, setEntries] = useState([]);
  const [packages, setPackages] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [purchaseTarget, setPurchaseTarget] = useState(null);
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [purchaseError, setPurchaseError] = useState('');
  const [creating, setCreating] = useState(false);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [canceling, setCanceling] = useState(false);
  const [proofTarget, setProofTarget] = useState(null);
  const [proofReference, setProofReference] = useState('');
  const [proofFile, setProofFile] = useState(null);
  const [proofError, setProofError] = useState('');
  const [proofSaving, setProofSaving] = useState(false);

  const load = async () => {
    if (!reseller?.id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      await expireResellerCreditOrders(supabase).catch(() => 0);
      const [currentBalance, rows, packageRows, orderRows] = await Promise.all([
        getResellerCreditBalance(supabase, reseller.id),
        listResellerCreditEntries(supabase, reseller.id),
        listResellerCreditPackages(supabase),
        listResellerCreditOrders(supabase, { resellerId: reseller.id }),
      ]);
      setBalance(currentBalance);
      setEntries(rows);
      setPackages(packageRows);
      setOrders(orderRows);
    } catch (err) {
      notify({ title: 'Erro ao carregar créditos', description: err?.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reseller?.id]);

  const totals = useMemo(() => summarizeCreditEntries(entries), [entries]);
  const pendingOrders = useMemo(
    () => orders.filter((order) => order.status === 'pendente'),
    [orders],
  );

  const openPurchase = (item) => {
    setPurchaseTarget(item);
    setIdempotencyKey(newIdempotencyKey());
    setPurchaseError('');
  };

  const handleCreateOrder = async () => {
    if (!purchaseTarget) return;
    setCreating(true);
    setPurchaseError('');
    try {
      const out = await createResellerCreditOrder(supabase, {
        packageId: purchaseTarget.id,
        idempotencyKey,
      });
      notify({
        title: out?.reused ? 'Pedido já registrado' : 'Pedido criado',
        description: 'Aguarde a confirmação do pagamento pelo Master.',
      });
      setPurchaseTarget(null);
      await load();
    } catch (err) {
      setPurchaseError(err?.message || 'Não foi possível criar o pedido.');
    } finally {
      setCreating(false);
    }
  };

  const handleCancelOrder = async () => {
    if (!cancelTarget) return;
    setCanceling(true);
    try {
      await cancelResellerCreditOrder(supabase, cancelTarget.id, 'Cancelado pelo revendedor');
      notify({ title: 'Pedido cancelado' });
      setCancelTarget(null);
      await load();
    } catch (err) {
      notify({ title: 'Erro ao cancelar pedido', description: err?.message, variant: 'destructive' });
    } finally {
      setCanceling(false);
    }
  };

  const openProof = (order) => {
    setProofTarget(order);
    setProofReference(order?.payment_reference || '');
    setProofFile(null);
    setProofError('');
  };

  const handleSubmitProof = async () => {
    if (!proofTarget || !reseller?.id) return;
    if (!proofFile) {
      setProofError('Anexe o comprovante do pagamento.');
      return;
    }
    if (!proofReference.trim()) {
      setProofError('Informe a referência do pagamento.');
      return;
    }
    setProofSaving(true);
    setProofError('');
    try {
      const uploaded = await uploadResellerReceipt(supabase, {
        resellerId: reseller.id,
        orderId: proofTarget.id,
        file: proofFile,
      });
      await submitResellerCreditOrderProof(supabase, {
        orderId: proofTarget.id,
        paymentReference: proofReference,
        proofUrl: uploaded.path,
      });
      notify({ title: 'Comprovante enviado', description: 'O Master fará a análise do pagamento.' });
      setProofTarget(null);
      await load();
    } catch (err) {
      setProofError(err?.message || 'Não foi possível enviar o comprovante.');
    } finally {
      setProofSaving(false);
    }
  };

  if (loading) return <Spinner />;

  return (
    <div>
      <PageHeader title="Créditos" description="Saldo, compras e movimentações da sua carteira">
        <div className="flex gap-2">
          <Button variant="outline" onClick={load}>
            <RefreshCw className="h-4 w-4" /> Atualizar
          </Button>
        </div>
      </PageHeader>

      <div className="grid gap-3 sm:grid-cols-3 mb-6">
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Wallet className="h-4 w-4" />
            <p className="text-xs font-medium uppercase tracking-wide">Saldo atual</p>
          </div>
          <p className="font-heading text-3xl font-bold text-foreground mt-2">{balance}</p>
          <p className="text-xs text-muted-foreground mt-1">créditos disponíveis</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center gap-2 text-green-700">
            <ArrowUpRight className="h-4 w-4" />
            <p className="text-xs font-medium uppercase tracking-wide">Creditado</p>
          </div>
          <p className="font-heading text-2xl font-bold text-foreground mt-2">{totals.credited}</p>
          <p className="text-xs text-muted-foreground mt-1">total recebido</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center gap-2 text-orange-700">
            <ArrowDownLeft className="h-4 w-4" />
            <p className="text-xs font-medium uppercase tracking-wide">Consumido</p>
          </div>
          <p className="font-heading text-2xl font-bold text-foreground mt-2">{totals.consumed}</p>
          <p className="text-xs text-muted-foreground mt-1">total em ativações</p>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card mb-6">
        <div className="flex flex-col gap-2 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-heading font-semibold text-foreground">Comprar créditos</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              O pedido fica pendente até a confirmação manual do pagamento pelo Master.
            </p>
            {pendingOrders.length > 0 && (
              <p className="text-xs font-medium text-amber-700 mt-1">
                Você já possui um pedido pendente. Aguarde a análise ou cancele-o para solicitar outro.
              </p>
            )}
          </div>
          <Badge className="w-fit bg-sky-100 text-sky-800">
            <ShoppingCart className="h-3.5 w-3.5 mr-1" /> Catálogo
          </Badge>
        </div>

        {packages.length === 0 ? (
          <div className="text-center py-10 px-5">
            <Package className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="font-medium text-foreground">Nenhum pacote disponível</p>
            <p className="text-sm text-muted-foreground mt-1">
              O Master ainda não publicou pacotes de crédito.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
            {packages.map((item) => (
              <div key={item.id} className="rounded-xl border border-border bg-card p-4">
                <p className="font-heading font-bold text-foreground">{item.name}</p>
                {item.description && (
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{item.description}</p>
                )}
                <p className="mt-2 text-sm text-foreground">
                  <strong>{item.credits}</strong> créditos
                </p>
                <p className="text-sm font-medium text-foreground">{fmtMoney(item.price, item.currency)}</p>
                <Button
                  size="sm"
                  className="mt-3 w-full"
                  onClick={() => openPurchase(item)}
                  disabled={pendingOrders.length > 0}
                >
                  <ShoppingCart className="h-4 w-4" /> Solicitar compra
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-border bg-card mb-6">
        <div className="border-b border-border px-5 py-4">
          <p className="font-heading font-semibold text-foreground">Pedidos de compra</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Acompanhe solicitações pendentes, creditadas e canceladas.
          </p>
        </div>

        {orders.length === 0 ? (
          <div className="text-center py-10 px-5">
            <Clock className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="font-medium text-foreground">Nenhum pedido registrado</p>
            <p className="text-sm text-muted-foreground mt-1">
              Seus pedidos de compra aparecerão aqui.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {orders.map((order) => (
              <div key={order.id} className="px-5 py-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">
                      {order.package_name} · {order.credits} créditos
                    </p>
                    <p className="text-sm text-muted-foreground">{fmtMoney(order.amount, order.currency)}</p>
                  </div>
                  <Badge className={ORDER_TONE[order.status] || ''}>
                    {creditOrderStatusLabel(order.status)}
                  </Badge>
                </div>
                <div className="mt-1.5 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                  <p>Solicitado em {formatDate(order.created_at)}</p>
                  {order.status === 'pendente' && order.pending_expires_at && (
                    <p>Expira em {formatDate(order.pending_expires_at)}</p>
                  )}
                  {order.credited_at && <p>Creditado em {formatDate(order.credited_at)}</p>}
                  {order.confirmed_amount != null && (
                    <p>Valor confirmado: {fmtMoney(order.confirmed_amount, order.currency)}</p>
                  )}
                  {order.canceled_at && <p>Cancelado em {formatDate(order.canceled_at)}</p>}
                  {order.rejected_at && <p>Rejeitado em {formatDate(order.rejected_at)}</p>}
                  {order.expired_at && <p>Expirado em {formatDate(order.expired_at)}</p>}
                  {order.payment_reference && <p>Referência: {order.payment_reference}</p>}
                </div>
                {order.rejection_reason && (
                  <p className="mt-1.5 text-xs text-red-700">
                    Motivo da rejeição: {order.rejection_reason}
                  </p>
                )}
                {order.status === 'pendente' && (
                  <p className={`mt-2 text-xs font-medium ${order.has_proof ? 'text-sky-800' : 'text-amber-800'}`}>
                    {order.has_proof
                      ? 'Comprovante enviado — aguardando análise do Master.'
                      : 'Aguardando pagamento. Envie o comprovante após pagar.'}
                  </p>
                )}
                {order.status === 'pendente' && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {!order.has_proof && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openProof(order)}
                      >
                        <FileImage className="h-4 w-4" /> Enviar comprovante
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCancelTarget(order)}
                    >
                      <X className="h-4 w-4" /> Cancelar pedido
                    </Button>
                  </div>
                )}
                {order.status === 'creditado' && (
                  <p className="mt-3 flex items-center gap-1.5 text-xs text-green-700">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Créditos lançados no seu saldo.
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-border bg-card">
        <div className="border-b border-border px-5 py-4">
          <p className="font-heading font-semibold text-foreground">Extrato</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Compras confirmadas e concessões do Master entram como crédito. Ativações debitam o saldo.
          </p>
        </div>

        {entries.length === 0 ? (
          <div className="text-center py-14 px-5">
            <Wallet className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="font-medium text-foreground">Nenhuma movimentação</p>
            <p className="text-sm text-muted-foreground mt-1">
              Seu extrato aparecerá aqui quando houver créditos ou ativações.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {entries.map((entry) => (
              <div key={entry.id} className="flex items-start gap-3 px-5 py-3.5">
                <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                  entry.amount > 0 ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'
                }`}>
                  {entry.amount > 0
                    ? <ArrowUpRight className="h-4 w-4" />
                    : <ArrowDownLeft className="h-4 w-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-foreground">{creditKindLabel(entry.kind)}</p>
                    <p className={`text-sm font-semibold ${
                      entry.amount > 0 ? 'text-green-700' : 'text-orange-700'
                    }`}>
                      {entry.amount > 0 ? '+' : ''}{entry.amount}
                    </p>
                  </div>
                  {entry.reason && (
                    <p className="text-xs text-muted-foreground mt-0.5 break-words">{entry.reason}</p>
                  )}
                  <p className="text-[11px] text-muted-foreground mt-1">{formatDate(entry.created_at)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog
        open={!!purchaseTarget}
        onOpenChange={(open) => { if (!open && !creating) setPurchaseTarget(null); }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Solicitar compra</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-xl bg-muted/50 p-3">
              <p className="font-medium text-foreground">{purchaseTarget?.name}</p>
              <p className="text-sm text-muted-foreground mt-1">
                {purchaseTarget?.credits} créditos · {fmtMoney(purchaseTarget?.price, purchaseTarget?.currency)}
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              O preço e a quantidade serão registrados pelo servidor no momento da solicitação.
              Nenhum crédito será adicionado antes da confirmação do pagamento.
            </p>
            {purchaseError && (
              <div className="rounded-lg bg-destructive/10 p-2.5 text-xs text-destructive">
                {purchaseError}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setPurchaseTarget(null)} disabled={creating}>
                Cancelar
              </Button>
              <Button onClick={handleCreateOrder} disabled={creating}>
                {creating ? 'Solicitando...' : 'Confirmar solicitação'}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!proofTarget}
        onOpenChange={(open) => { if (!open && !proofSaving) setProofTarget(null); }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Enviar comprovante</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-xl bg-muted/50 p-3 text-sm">
              <p className="font-medium text-foreground">{proofTarget?.package_name}</p>
              <p className="text-muted-foreground mt-0.5">
                {proofTarget?.credits} créditos · {fmtMoney(proofTarget?.amount, proofTarget?.currency)}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="proof-file">Comprovante (JPG, PNG, WebP ou PDF)</Label>
              <Input
                id="proof-file"
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                onChange={(event) => setProofFile(event.target.files?.[0] || null)}
                disabled={proofSaving}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="proof-reference">Referência do pagamento</Label>
              <Input
                id="proof-reference"
                value={proofReference}
                onChange={(event) => setProofReference(event.target.value)}
                placeholder="Ex.: ID da transação Pix"
                maxLength={200}
                disabled={proofSaving}
              />
            </div>
            {proofError && (
              <div className="rounded-lg bg-destructive/10 p-2.5 text-xs text-destructive">
                {proofError}
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">
              O comprovante fica em armazenamento privado. A análise e a liberação dos créditos são feitas pelo Master.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setProofTarget(null)} disabled={proofSaving}>
                Cancelar
              </Button>
              <Button onClick={handleSubmitProof} disabled={proofSaving}>
                {proofSaving ? 'Enviando...' : 'Enviar comprovante'}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!cancelTarget}
        onOpenChange={(open) => { if (!open && !canceling) setCancelTarget(null); }}
        title="Cancelar pedido"
        description={cancelTarget
          ? `Cancelar o pedido de ${cancelTarget.credits} créditos de ${cancelTarget.package_name}?`
          : ''}
        confirmLabel={canceling ? 'Cancelando...' : 'Cancelar pedido'}
        onConfirm={handleCancelOrder}
      />
    </div>
  );
}
