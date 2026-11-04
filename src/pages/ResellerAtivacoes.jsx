import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useOutletContext, useSearchParams } from 'react-router-dom';
import { supabase } from '@/api/supabaseClient';
import { listPlans } from '@/api/plans';
import { listResellerClients } from '@/api/resellerClients';
import {
  activateResellerClient, activationStatusLabel, createActivationIdempotencyKey,
  getResellerCreditBalance, listResellerActivations,
} from '@/api/resellerCredits';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { CalendarDays, CreditCard, Plus, Users, Wallet } from 'lucide-react';

const STATUS_TONE = {
  ativa: 'bg-green-100 text-green-800',
  vencida: 'bg-amber-100 text-amber-900',
  cancelada: 'bg-muted text-muted-foreground',
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
  const [year, month, day] = String(value).slice(0, 10).split('-');
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

function emptyForm(clientId = '') {
  return {
    clientId,
    planId: '',
    idempotencyKey: createActivationIdempotencyKey(),
  };
}

export default function ResellerAtivacoes() {
  const outletContext = /** @type {{ reseller?: { id?: string } }} */ (useOutletContext());
  const reseller = outletContext?.reseller;
  const { toast } = useToast();
  const notify = (props) => toast({ duration: 4000, ...props });
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [activations, setActivations] = useState([]);
  const [clients, setClients] = useState([]);
  const [plans, setPlans] = useState([]);
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!reseller?.id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [activationRows, clientRows, planRows, currentBalance] = await Promise.all([
        listResellerActivations(supabase, reseller.id),
        listResellerClients(supabase, reseller.id),
        listPlans(supabase, { onlyActive: true }),
        getResellerCreditBalance(supabase, reseller.id),
      ]);
      setActivations(activationRows);
      setClients(clientRows);
      setPlans(planRows);
      setBalance(currentBalance);
    } catch (err) {
      notify({ title: 'Erro ao carregar ativações', description: err?.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reseller?.id]);

  const eligibleClients = useMemo(
    () => clients.filter((client) => client.user_id),
    [clients],
  );

  useEffect(() => {
    if (loading) return;
    const prefill = searchParams.get('cliente');
    if (!prefill) return;
    const match = eligibleClients.find((client) => client.id === prefill);
    if (!match) return;
    setForm(emptyForm(match.id));
    setDialogOpen(true);
    navigate('/revenda/ativacoes', { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, eligibleClients, searchParams]);

  const counts = useMemo(() => ({
    ativas: activations.filter((item) => item.status === 'ativa').length,
    vencidas: activations.filter((item) => item.status === 'vencida').length,
  }), [activations]);

  const selectedClient = eligibleClients.find((client) => client.id === form.clientId) || null;
  const selectedPlan = plans.find((plan) => plan.id === form.planId) || null;
  const isRenewal = Boolean(selectedClient?.company_id);
  const pendingAccountCount = clients.length - eligibleClients.length;
  const canActivate = Boolean(
    form.clientId
    && selectedPlan
    && selectedPlan.access_days > 0
    && balance >= 1
    && !saving,
  );

  const openNew = () => {
    setForm(emptyForm(eligibleClients[0]?.id || ''));
    setDialogOpen(true);
  };

  const updateField = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await activateResellerClient(supabase, {
        clientId: form.clientId,
        planId: form.planId,
        idempotencyKey: form.idempotencyKey,
      });
      notify({
        title: result?.kind === 'renewal' ? 'Acesso renovado' : 'Acesso ativado',
        description: `Novo vencimento: ${formatDate(result?.new_expires_at)}. Saldo restante: ${result?.balance ?? balance}.`,
      });
      setDialogOpen(false);
      setForm(emptyForm());
      await load();
    } catch (err) {
      notify({ title: 'Erro na ativação', description: err?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Spinner />;

  return (
    <div>
      <PageHeader title="Ativações" description="Ativações, renovações e vencimentos dos seus clientes">
        <Button onClick={openNew} disabled={eligibleClients.length === 0}>
          <Plus className="h-4 w-4" /> Nova ativação
        </Button>
      </PageHeader>

      <div className="grid gap-3 sm:grid-cols-3 mb-6">
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Saldo</p>
          <p className="font-heading text-2xl font-bold text-foreground mt-1">{balance}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Ativas</p>
          <p className="font-heading text-2xl font-bold text-foreground mt-1">{counts.ativas}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Vencidas</p>
          <p className="font-heading text-2xl font-bold text-foreground mt-1">{counts.vencidas}</p>
        </div>
      </div>

      {clients.length === 0 ? (
        <div className="text-center py-16">
          <Users className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="font-medium text-foreground">Cadastre um cliente primeiro</p>
          <p className="text-sm text-muted-foreground mt-1">
            A ativação precisa estar vinculada a um estabelecimento da sua carteira.
          </p>
          <Button variant="outline" className="mt-4" asChild>
            <Link to="/revenda/clientes">Ir para Clientes</Link>
          </Button>
        </div>
      ) : eligibleClients.length === 0 ? (
        <div className="text-center py-16">
          <Users className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="font-medium text-foreground">Nenhum cliente com conta criada</p>
          <p className="text-sm text-muted-foreground mt-1">
            Envie o convite e aguarde o cliente criar a conta antes de ativar o acesso.
          </p>
          <Button variant="outline" className="mt-4" asChild>
            <Link to="/revenda/clientes">Enviar convites</Link>
          </Button>
        </div>
      ) : activations.length === 0 ? (
        <div className="text-center py-16">
          <CreditCard className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="font-medium text-foreground">Nenhuma ativação registrada</p>
          <p className="text-sm text-muted-foreground mt-1">
            Escolha um cliente e um plano. Cada ativação consome 1 crédito.
          </p>
          <Button className="mt-4" onClick={openNew}>
            <Plus className="h-4 w-4" /> Nova ativação
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {activations.map((activation) => (
            <div key={activation.id} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-heading font-bold text-foreground truncate">
                    {activation.client_name || 'Cliente'}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">{activation.plan_name || 'Plano'}</p>
                </div>
                <Badge className={STATUS_TONE[activation.status] || ''}>
                  {activationStatusLabel(activation.status)}
                </Badge>
              </div>

              <div className="mt-3 space-y-1.5 text-sm text-muted-foreground">
                <p className="flex items-center gap-2">
                  <CalendarDays className="h-3.5 w-3.5" />
                  {formatDate(activation.starts_on)} até {formatDate(activation.new_expires_at || activation.expires_on)}
                </p>
                <p className="flex items-center gap-2">
                  <Wallet className="h-3.5 w-3.5" />
                  {activation.credits} crédito{activation.credits === 1 ? '' : 's'}
                  {activation.access_days ? ` · ${activation.access_days} dias` : ''}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {pendingAccountCount > 0 && eligibleClients.length > 0 && (
        <p className="mt-4 text-xs text-muted-foreground">
          {pendingAccountCount} cliente{pendingAccountCount === 1 ? '' : 's'} ainda aguardando criação de conta.
        </p>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-md">
          <DialogHeader>
            <DialogTitle>{isRenewal ? 'Renovar acesso' : 'Nova ativação'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-xl bg-muted/50 p-3 text-sm">
              Saldo disponível: <strong>{balance} crédito{balance === 1 ? '' : 's'}</strong>
              <span className="block text-xs text-muted-foreground mt-1">Cada ativação ou renovação consome 1 crédito.</span>
            </div>

            <div className="space-y-1.5">
              <Label>Cliente</Label>
              <Select value={form.clientId} onValueChange={(value) => updateField('clientId', value)}>
                <SelectTrigger><SelectValue placeholder="Escolha o cliente" /></SelectTrigger>
                <SelectContent>
                  {eligibleClients.map((client) => (
                    <SelectItem key={client.id} value={client.id}>
                      {client.name}{client.company_id ? ' (renovação)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedClient?.access_expires_at && (
                <p className="text-xs text-muted-foreground">
                  Vencimento atual: {formatDate(selectedClient.access_expires_at)}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Plano</Label>
              <Select value={form.planId} onValueChange={(value) => updateField('planId', value)}>
                <SelectTrigger><SelectValue placeholder="Escolha o plano" /></SelectTrigger>
                <SelectContent>
                  {plans.map((plan) => (
                    <SelectItem key={plan.id} value={plan.id} disabled={!plan.access_days}>
                      {plan.name} · {plan.access_days ? `${plan.access_days} dias` : 'duração não configurada'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedPlan && !selectedPlan.access_days && (
                <p className="text-xs text-destructive">
                  O Master precisa configurar a duração deste plano antes da ativação.
                </p>
              )}
            </div>

            {balance < 1 && (
              <p className="text-sm text-destructive">
                Saldo insuficiente. Compre créditos para ativar ou renovar.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={!canActivate}>
              {saving ? 'Processando...' : isRenewal ? 'Confirmar renovação' : 'Confirmar ativação'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
