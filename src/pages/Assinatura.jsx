import React, { useState, useEffect } from 'react';
import { supabase } from '@/api/supabaseClient';
import { listPlans } from '@/api/plans';
import { useCompany } from '@/hooks/useCompany';
import { useSubscription } from '@/hooks/useSubscription';
import PageHeader from '@/components/PageHeader';
import ConfirmDialog from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { Check, Crown, Clock, CreditCard, TrendingUp, Package, Users, Loader2, AlertCircle } from 'lucide-react';

const fmtCurrency = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);

const STATUS_CONFIG = {
  trial: { label: 'Trial', cls: 'bg-blue-100 text-blue-700' },
  ativo: { label: 'Ativo', cls: 'bg-green-100 text-green-700' },
  pendente: { label: 'Pendente', cls: 'bg-yellow-100 text-yellow-700' },
  cancelado: { label: 'Cancelado', cls: 'bg-red-100 text-red-700' },
  suspenso: { label: 'Suspenso', cls: 'bg-orange-100 text-orange-700' },
  expirado: { label: 'Expirado', cls: 'bg-gray-100 text-gray-700' },
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
  const { loading: subLoading, subscription, plan, trialDaysLeft, isCanceled, setSubscription } = useSubscription(company?.id);
  const { toast } = useToast();
  const [plans, setPlans] = useState([]);
  const [usage, setUsage] = useState({ products: 0, orders: 0, customers: 0 });
  const [actionLoading, setActionLoading] = useState(null);
  const [cancelDialog, setCancelDialog] = useState(false);

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

  if (companyLoading || subLoading) return <Spinner />;
  if (!company) return null;

  const currentPlanId = subscription?.plan_id;
  const status = subscription ? STATUS_CONFIG[subscription.status] : null;

  const handleUpgrade = async (planId) => {
    setActionLoading(planId);
    try {
      const res = await base44.functions.invoke('manageSubscription', { action: 'upgrade', plan_id: planId });
      setSubscription(res.data.subscription);
      toast({ title: 'Plano atualizado com sucesso!' });
    } catch (err) {
      toast({ title: 'Erro', description: err?.response?.data?.error || 'Tente novamente', variant: 'destructive' });
    } finally { setActionLoading(null); }
  };

  const handleCancel = async () => {
    try {
      const res = await base44.functions.invoke('manageSubscription', { action: 'cancel' });
      setSubscription(res.data.subscription);
      toast({ title: 'Assinatura cancelada' });
    } catch (err) {
      toast({ title: 'Erro', variant: 'destructive' });
    } finally { setCancelDialog(false); }
  };

  const handleReactivate = async () => {
    setActionLoading('reactivate');
    try {
      const res = await base44.functions.invoke('manageSubscription', { action: 'reactivate' });
      setSubscription(res.data.subscription);
      toast({ title: 'Assinatura reativada!' });
    } catch (err) {
      toast({ title: 'Erro', variant: 'destructive' });
    } finally { setActionLoading(null); }
  };

  const usageBars = [
    { icon: Package, label: 'Produtos', current: usage.products, limit: plan?.limits_products ?? -1 },
    { icon: TrendingUp, label: 'Pedidos', current: usage.orders, limit: plan?.limits_orders ?? -1 },
    { icon: Users, label: 'Clientes', current: usage.customers, limit: plan?.limits_customers ?? -1 },
  ];

  return (
    <div>
      <PageHeader title="Assinatura" description="Gerencie seu plano e cobrança" />

      {/* Current plan card */}
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
                {plan?.price ? `${fmtCurrency(plan.price)}/mês` : 'Gratuito'}
                {subscription?.current_period_end && subscription.status === 'ativo' && ` • Próxima cobrança: ${new Date(subscription.current_period_end).toLocaleDateString('pt-BR')}`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isCanceled ? (
              <Button onClick={handleReactivate} disabled={actionLoading === 'reactivate'} className="bg-primary hover:bg-primary/90">
                {actionLoading === 'reactivate' && <Loader2 className="h-4 w-4 animate-spin" />} Reativar
              </Button>
            ) : subscription?.status === 'trial' ? (
              <div className="flex items-center gap-2 rounded-xl bg-blue-50 px-4 py-2">
                <Clock className="h-4 w-4 text-blue-600" />
                <span className="text-sm font-medium text-blue-700">{trialDaysLeft} dias restantes</span>
              </div>
            ) : null}
            {!isCanceled && subscription && (
              <Button variant="outline" onClick={() => setCancelDialog(true)}>Cancelar</Button>
            )}
          </div>
        </div>

        {/* Trial warning */}
        {subscription?.status === 'trial' && trialDaysLeft <= 3 && trialDaysLeft > 0 && (
          <div className="mt-4 flex items-center gap-2 rounded-xl bg-yellow-50 p-3 text-sm text-yellow-700">
            <AlertCircle className="h-4 w-4 shrink-0" /> Seu trial termina em {trialDaysLeft} {trialDaysLeft === 1 ? 'dia' : 'dias'}. Assine um plano para continuar.
          </div>
        )}

        {/* Usage bars */}
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

      {/* Plan comparison */}
      <h3 className="font-heading text-lg font-semibold text-foreground mb-4">Escolha seu plano</h3>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {plans.map(p => {
          const isCurrent = p.id === currentPlanId;
          return (
            <div key={p.id} className={`relative rounded-2xl border bg-card p-5 flex flex-col ${p.is_popular ? 'border-primary shadow-lg' : 'border-border'} ${isCurrent ? 'ring-2 ring-primary' : ''}`}>
              {p.is_popular && <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">Popular</div>}
              <h4 className="font-heading font-bold text-foreground">{p.name}</h4>
              <p className="mt-1"><span className="font-heading text-2xl font-bold text-foreground">{fmtCurrency(p.price)}</span><span className="text-sm text-muted-foreground">/mês</span></p>
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
                  onClick={() => handleUpgrade(p.id)}
                  disabled={actionLoading === p.id}
                  className={`mt-4 ${p.is_popular ? 'bg-primary hover:bg-primary/90' : ''}`}
                  variant={p.is_popular ? 'default' : 'outline'}
                >
                  {actionLoading === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Assinar'}
                </Button>
              )}
            </div>
          );
        })}
      </div>

      {/* Payment history */}
      <div className="mt-8 rounded-2xl border border-border bg-card p-6">
        <h3 className="font-heading font-semibold text-foreground mb-4">Histórico de pagamentos</h3>
        <div className="text-center py-8 text-sm text-muted-foreground">
          <CreditCard className="mx-auto h-10 w-10 mb-2 opacity-50" />
          Nenhum pagamento registrado ainda.
        </div>
      </div>

      <ConfirmDialog
        open={cancelDialog}
        onOpenChange={setCancelDialog}
        title="Cancelar assinatura"
        description="Deseja realmente cancelar? Você continuará com acesso até o fim do período pago."
        onConfirm={handleCancel}
        confirmLabel="Cancelar assinatura"
      />
    </div>
  );
}