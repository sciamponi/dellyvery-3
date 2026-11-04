import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/api/supabaseClient';
import { useSupabaseAuth } from '@/lib/SupabaseAuthContext';
import { isPlatformAdmin } from '@/api/plans';
import { listResellerInvites, listResellers } from '@/api/resellers';
import {
  creditOrderStatusLabel,
  listResellerCreditPackages, createResellerCreditPackage, updateResellerCreditPackage,
  listResellerCreditOrders, confirmResellerCreditOrder, cancelResellerCreditOrder,
  rejectResellerCreditOrder, expireResellerCreditOrders,
  getCreditOrderExpiryDays, setCreditOrderExpiryDays,
  validateCreditPackageForm,
} from '@/api/resellerCreditPurchases';
import PageHeader from '@/components/PageHeader';
import ConfirmDialog from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import {
  Check, Loader2, Package, Pencil, Plus, RefreshCw, ShieldAlert, Wallet, X,
} from 'lucide-react';

const STATUS_TONE = {
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

const EMPTY_FORM = {
  name: '', description: '', credits: '', price: '', currency: 'BRL',
  active: true, sort_order: 0,
};

export default function MasterRevendaCreditos() {
  const { toast } = useToast();
  const notify = (props) => toast({ duration: 4000, ...props });
  const { user: sbUser } = useSupabaseAuth();
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [tab, setTab] = useState('pacotes');
  const [packages, setPackages] = useState([]);
  const [orders, setOrders] = useState([]);
  const [invites, setInvites] = useState([]);
  const [resellers, setResellers] = useState([]);
  const [packageDialog, setPackageDialog] = useState(false);
  const [editingPackage, setEditingPackage] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [savingPackage, setSavingPackage] = useState(false);
  const [confirmOrder, setConfirmOrder] = useState(null);
  const [paymentReference, setPaymentReference] = useState('');
  const [confirmedAmount, setConfirmedAmount] = useState('');
  const [confirmError, setConfirmError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [rejectError, setRejectError] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [canceling, setCanceling] = useState(false);
  const [expiryDays, setExpiryDays] = useState('');
  const [savingExpiry, setSavingExpiry] = useState(false);

  const load = async () => {
    await expireResellerCreditOrders(supabase).catch(() => 0);
    const [packageRows, orderRows, inviteRows, resellerRows, days] = await Promise.all([
      listResellerCreditPackages(supabase, { includeInactive: true }),
      listResellerCreditOrders(supabase),
      listResellerInvites(supabase, {}),
      listResellers(supabase),
      getCreditOrderExpiryDays(supabase),
    ]);
    setPackages(packageRows);
    setOrders(orderRows);
    setInvites(inviteRows);
    setResellers(resellerRows);
    setExpiryDays(days == null ? '' : String(days));
  };

  useEffect(() => {
    const init = async () => {
      try {
        const admin = await isPlatformAdmin(supabase, sbUser?.id);
        setIsAdmin(admin);
        if (admin) await load();
      } catch (err) {
        notify({ title: 'Erro ao carregar créditos da revenda', description: err?.message, variant: 'destructive' });
      } finally {
        setLoading(false);
      }
    };
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sbUser?.id]);

  const resellerNames = useMemo(() => {
    const inviteById = new Map(invites.map((invite) => [invite.id, invite.name]));
    return new Map(resellers.map((reseller) => [reseller.id, inviteById.get(reseller.invite_id) || 'Revendedor']));
  }, [invites, resellers]);

  const orderedOrders = useMemo(() => {
    return [...orders].sort((a, b) => {
      if (a.status === 'pendente' && b.status !== 'pendente') return -1;
      if (a.status !== 'pendente' && b.status === 'pendente') return 1;
      return String(b.created_at || '').localeCompare(String(a.created_at || ''));
    });
  }, [orders]);

  const pendingCount = orders.filter((order) => order.status === 'pendente').length;

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

  const openNewPackage = () => {
    setEditingPackage(null);
    setForm(EMPTY_FORM);
    setFormError('');
    setPackageDialog(true);
  };

  const openEditPackage = (item) => {
    setEditingPackage(item);
    setForm({
      name: item.name,
      description: item.description,
      credits: String(item.credits),
      price: String(item.price),
      currency: item.currency,
      active: item.active,
      sort_order: item.sort_order,
    });
    setFormError('');
    setPackageDialog(true);
  };

  const updateForm = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const handleSavePackage = async () => {
    const validationError = validateCreditPackageForm(form);
    if (validationError) {
      setFormError(validationError);
      return;
    }
    setSavingPackage(true);
    setFormError('');
    try {
      const payload = {
        ...form,
        credits: Number(form.credits),
        price: Number(form.price),
        sort_order: Number(form.sort_order) || 0,
      };
      if (editingPackage) {
        await updateResellerCreditPackage(supabase, editingPackage.id, payload);
        notify({ title: 'Pacote atualizado' });
      } else {
        await createResellerCreditPackage(supabase, payload);
        notify({ title: 'Pacote criado' });
      }
      setPackageDialog(false);
      await load();
    } catch (err) {
      setFormError(err?.message || 'Não foi possível salvar o pacote.');
    } finally {
      setSavingPackage(false);
    }
  };

  const togglePackage = async (item) => {
    try {
      await updateResellerCreditPackage(supabase, item.id, { active: !item.active });
      notify({ title: item.active ? 'Pacote desativado' : 'Pacote ativado' });
      await load();
    } catch (err) {
      notify({ title: 'Erro ao alterar pacote', description: err?.message, variant: 'destructive' });
    }
  };

  const openConfirm = (order) => {
    setConfirmOrder(order);
    setPaymentReference('');
    setConfirmedAmount(order?.amount != null ? String(order.amount) : '');
    setConfirmError('');
  };

  const handleConfirmPayment = async () => {
    if (!confirmOrder) return;
    setConfirming(true);
    setConfirmError('');
    try {
      const out = await confirmResellerCreditOrder(
        supabase,
        confirmOrder.id,
        paymentReference,
        confirmedAmount,
      );
      if (out?.expired) {
        notify({ title: 'Pedido expirado', description: 'O pedido não pode mais ser confirmado.', variant: 'destructive' });
      } else {
        notify({
          title: 'Pagamento confirmado',
          description: `Saldo do revendedor: ${out?.balance ?? '-'} créditos`,
        });
      }
      setConfirmOrder(null);
      await load();
    } catch (err) {
      setConfirmError(err?.message || 'Não foi possível confirmar o pagamento.');
    } finally {
      setConfirming(false);
    }
  };

  const openReject = (order) => {
    setRejectTarget(order);
    setRejectionReason('');
    setRejectError('');
  };

  const handleRejectOrder = async () => {
    if (!rejectTarget) return;
    setRejecting(true);
    setRejectError('');
    try {
      const out = await rejectResellerCreditOrder(supabase, rejectTarget.id, rejectionReason);
      if (out?.expired) {
        notify({ title: 'Pedido expirado', description: 'O pedido não pode mais ser rejeitado.', variant: 'destructive' });
      } else {
        notify({ title: 'Pedido rejeitado', description: out?.reused ? 'Rejeição já registrada.' : undefined });
      }
      setRejectTarget(null);
      await load();
    } catch (err) {
      setRejectError(err?.message || 'Não foi possível rejeitar o pedido.');
    } finally {
      setRejecting(false);
    }
  };

  const handleSaveExpiry = async () => {
    const days = Number(expiryDays);
    if (!Number.isInteger(days) || days <= 0) {
      notify({ title: 'Informe um número inteiro de dias maior que zero', variant: 'destructive' });
      return;
    }
    setSavingExpiry(true);
    try {
      await setCreditOrderExpiryDays(supabase, days);
      notify({ title: 'Validade dos pedidos atualizada' });
      await load();
    } catch (err) {
      notify({ title: 'Erro ao atualizar validade', description: err?.message, variant: 'destructive' });
    } finally {
      setSavingExpiry(false);
    }
  };

  const handleCancelOrder = async () => {
    if (!cancelTarget) return;
    setCanceling(true);
    try {
      await cancelResellerCreditOrder(supabase, cancelTarget.id, 'Cancelado pelo Master');
      notify({ title: 'Pedido cancelado' });
      setCancelTarget(null);
      await load();
    } catch (err) {
      notify({ title: 'Erro ao cancelar', description: err?.message, variant: 'destructive' });
    } finally {
      setCanceling(false);
    }
  };

  return (
    <div>
      <PageHeader title="Créditos da Revenda" description="Pacotes e pedidos de compra de créditos">
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={load}>
            <RefreshCw className="h-3.5 w-3.5" /> Atualizar
          </Button>
          {tab === 'pacotes' && (
            <Button size="sm" className="h-8 text-xs" onClick={openNewPackage}>
              <Plus className="h-3.5 w-3.5" /> Novo pacote
            </Button>
          )}
        </div>
      </PageHeader>

      <div className="flex flex-wrap gap-1.5 mb-4">
        <button
          type="button"
          onClick={() => setTab('pacotes')}
          className={`rounded-full px-3 h-8 text-xs font-medium transition-colors ${
            tab === 'pacotes' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
          }`}
        >
          Pacotes
        </button>
        <button
          type="button"
          onClick={() => setTab('pedidos')}
          className={`rounded-full px-3 h-8 text-xs font-medium transition-colors ${
            tab === 'pedidos' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
          }`}
        >
          Pedidos{pendingCount > 0 ? ` (${pendingCount})` : ''}
        </button>
      </div>

      <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-heading font-semibold text-foreground">Validade dos pedidos pendentes</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Pedidos não confirmados expiram automaticamente após esse prazo, em dias corridos.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="expiry-days">Dias</Label>
            <Input
              id="expiry-days"
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

      {tab === 'pacotes' ? (
        packages.length === 0 ? (
          <div className="text-center py-16">
            <Package className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="font-medium text-foreground">Nenhum pacote cadastrado</p>
            <p className="text-sm text-muted-foreground mt-1">
              Cadastre um pacote para disponibilizá-lo aos revendedores.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {packages.map((item) => (
              <div key={item.id} className={`rounded-2xl border border-border bg-card p-4 ${!item.active ? 'opacity-60' : ''}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-heading font-bold text-foreground truncate">{item.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{item.description || 'Sem descrição'}</p>
                  </div>
                  <Badge className={item.active ? 'bg-green-100 text-green-800' : 'bg-muted text-muted-foreground'}>
                    {item.active ? 'Ativo' : 'Inativo'}
                  </Badge>
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="font-heading text-2xl font-bold text-foreground">{item.credits}</span>
                  <span className="text-xs text-muted-foreground">créditos</span>
                </div>
                <p className="mt-0.5 text-sm font-medium text-foreground">{fmtMoney(item.price, item.currency)}</p>
                <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
                  <Button variant="outline" size="sm" onClick={() => openEditPackage(item)}>
                    <Pencil className="h-4 w-4" /> Editar
                  </Button>
                  <div className="ml-auto flex items-center gap-2">
                    <Switch checked={item.active} onCheckedChange={() => togglePackage(item)} />
                    <span className="text-xs text-muted-foreground">{item.active ? 'Ativo' : 'Inativo'}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        orderedOrders.length === 0 ? (
          <div className="text-center py-16">
            <Wallet className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="font-medium text-foreground">Nenhum pedido de compra</p>
            <p className="text-sm text-muted-foreground mt-1">
              Os pedidos criados pelos revendedores aparecerão aqui.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {orderedOrders.map((order) => (
              <div key={order.id} className="rounded-2xl border border-border bg-card p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-heading font-bold text-foreground">
                      {order.package_name} · {order.credits} créditos
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {resellerNames.get(order.reseller_id) || 'Revendedor'} · {fmtMoney(order.amount, order.currency)}
                    </p>
                  </div>
                  <Badge className={STATUS_TONE[order.status] || ''}>{creditOrderStatusLabel(order.status)}</Badge>
                </div>

                <div className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                  <p>Criado em {fmtDate(order.created_at, true)}</p>
                  {order.status === 'pendente' && order.pending_expires_at && (
                    <p>Expira em {fmtDate(order.pending_expires_at, true)}</p>
                  )}
                  {order.credited_at && <p>Creditado em {fmtDate(order.credited_at, true)}</p>}
                  {order.confirmed_amount != null && (
                    <p>Valor confirmado: {fmtMoney(order.confirmed_amount, order.currency)}</p>
                  )}
                  {order.canceled_at && <p>Cancelado em {fmtDate(order.canceled_at, true)}</p>}
                  {order.rejected_at && <p>Rejeitado em {fmtDate(order.rejected_at, true)}</p>}
                  {order.expired_at && <p>Expirado em {fmtDate(order.expired_at, true)}</p>}
                  {order.payment_reference && <p>Referência: {order.payment_reference}</p>}
                </div>

                {order.rejection_reason && (
                  <p className="mt-2 text-xs text-red-700">Motivo da rejeição: {order.rejection_reason}</p>
                )}

                {order.status === 'pendente' && (
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
                    <Button size="sm" onClick={() => openConfirm(order)}>
                      <Check className="h-4 w-4" /> Confirmar recebimento
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => openReject(order)}>
                      <X className="h-4 w-4" /> Rejeitar
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setCancelTarget(order)}>
                      <X className="h-4 w-4" /> Cancelar
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      )}

      <Dialog open={packageDialog} onOpenChange={(open) => { if (!savingPackage) setPackageDialog(open); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingPackage ? 'Editar pacote' : 'Novo pacote'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="package-name">Nome</Label>
              <Input
                id="package-name"
                value={form.name}
                onChange={(event) => updateForm('name', event.target.value)}
                placeholder="Nome comercial do pacote"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="package-description">Descrição</Label>
              <Textarea
                id="package-description"
                rows={2}
                value={form.description}
                onChange={(event) => updateForm('description', event.target.value)}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="package-credits">Créditos</Label>
                <Input
                  id="package-credits"
                  type="number"
                  min="1"
                  step="1"
                  value={form.credits}
                  onChange={(event) => updateForm('credits', event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="package-price">Preço</Label>
                <Input
                  id="package-price"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.price}
                  onChange={(event) => updateForm('price', event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="package-currency">Moeda</Label>
                <Input
                  id="package-currency"
                  maxLength={3}
                  value={form.currency}
                  onChange={(event) => updateForm('currency', event.target.value.toUpperCase())}
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="package-order">Ordem</Label>
                <Input
                  id="package-order"
                  type="number"
                  step="1"
                  value={form.sort_order}
                  onChange={(event) => updateForm('sort_order', event.target.value)}
                />
              </div>
              <div className="flex items-center gap-2 rounded-xl border border-border p-3">
                <Switch checked={!!form.active} onCheckedChange={(value) => updateForm('active', value)} />
                <Label className="cursor-pointer">Ativo no catálogo</Label>
              </div>
            </div>
            {formError && (
              <div className="rounded-lg bg-destructive/10 p-2.5 text-xs text-destructive">{formError}</div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPackageDialog(false)} disabled={savingPackage}>
              Cancelar
            </Button>
            <Button onClick={handleSavePackage} disabled={savingPackage}>
              {savingPackage ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!confirmOrder}
        onOpenChange={(open) => { if (!open && !confirming) setConfirmOrder(null); }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirmar pagamento</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-xl bg-muted/50 p-3 text-sm">
              <p className="font-medium text-foreground">{confirmOrder?.package_name}</p>
              <p className="text-muted-foreground mt-0.5">
                {confirmOrder?.credits} créditos · {fmtMoney(confirmOrder?.amount, confirmOrder?.currency)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {resellerNames.get(confirmOrder?.reseller_id) || 'Revendedor'}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="payment-reference">Referência do pagamento</Label>
              <Input
                id="payment-reference"
                value={paymentReference}
                onChange={(event) => setPaymentReference(event.target.value)}
                placeholder="Ex.: comprovante, Pix, observação"
                maxLength={200}
                disabled={confirming}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirmed-amount">Valor confirmado</Label>
              <Input
                id="confirmed-amount"
                type="number"
                min="0"
                step="0.01"
                value={confirmedAmount}
                onChange={(event) => setConfirmedAmount(event.target.value)}
                disabled={confirming}
              />
              <p className="text-[11px] text-muted-foreground">
                Deve ser igual ao valor do pedido: {fmtMoney(confirmOrder?.amount, confirmOrder?.currency)}.
              </p>
            </div>
            {confirmError && (
              <div className="rounded-lg bg-destructive/10 p-2.5 text-xs text-destructive">{confirmError}</div>
            )}
            <p className="text-[11px] text-muted-foreground">
              A confirmação credita o saldo e altera o pedido na mesma transação.
            </p>
            <Button className="w-full" onClick={handleConfirmPayment} disabled={confirming}>
              {confirming ? 'Confirmando...' : 'Confirmar e creditar'}
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
            <DialogTitle>Rejeitar pedido</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-xl bg-muted/50 p-3 text-sm">
              <p className="font-medium text-foreground">{rejectTarget?.package_name}</p>
              <p className="text-muted-foreground mt-0.5">
                {rejectTarget?.credits} créditos · {fmtMoney(rejectTarget?.amount, rejectTarget?.currency)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {resellerNames.get(rejectTarget?.reseller_id) || 'Revendedor'}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rejection-reason">Motivo da rejeição</Label>
              <Textarea
                id="rejection-reason"
                rows={3}
                value={rejectionReason}
                onChange={(event) => setRejectionReason(event.target.value)}
                placeholder="Descreva o motivo da rejeição"
                disabled={rejecting}
              />
            </div>
            {rejectError && (
              <div className="rounded-lg bg-destructive/10 p-2.5 text-xs text-destructive">{rejectError}</div>
            )}
            <p className="text-[11px] text-muted-foreground">
              A rejeição não apaga o pedido e não lança créditos.
            </p>
            <Button className="w-full" variant="destructive" onClick={handleRejectOrder} disabled={rejecting}>
              {rejecting ? 'Rejeitando...' : 'Rejeitar pedido'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!cancelTarget}
        onOpenChange={(open) => { if (!open && !canceling) setCancelTarget(null); }}
        title="Cancelar pedido"
        description={cancelTarget
          ? `Cancelar o pedido de ${cancelTarget.credits} créditos de ${cancelTarget.package_name}? Nenhum crédito será lançado.`
          : ''}
        confirmLabel={canceling ? 'Cancelando...' : 'Cancelar pedido'}
        onConfirm={handleCancelOrder}
      />
    </div>
  );
}
