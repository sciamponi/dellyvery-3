import React, { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/api/supabaseClient';
import { getMasterCompaniesOverview } from '@/api/masterCompanies';
import { listPlans } from '@/api/plans';
import {
  MASTER_COMPANIES_LIMIT,
  COMPANY_STATUS_OPTIONS,
  SUBSCRIPTION_STATUS_OPTIONS,
  companiesViewState,
  companyStatusMeta,
  formatPlanPrice,
  masterCompaniesEmptyMessage,
  masterCompaniesLimitNote,
  subscriptionStatusMeta,
} from '@/lib/masterCompaniesView';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  Clock,
  Mail,
  Phone,
  RefreshCw,
  Search,
  Store,
} from 'lucide-react';

function Spinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-4 border-border border-t-primary rounded-full animate-spin" />
    </div>
  );
}

function fmtDate(value) {
  return value ? new Date(value).toLocaleDateString('pt-BR') : '—';
}

function MetricCard({ icon: Icon, label, value, detail = null }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <Icon className="h-5 w-5 text-muted-foreground mb-2" />
      <p className="font-heading text-2xl font-bold text-foreground">{value == null ? '—' : value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
      {detail && <p className="text-[11px] text-muted-foreground mt-0.5">{detail}</p>}
    </div>
  );
}

function SubscriptionBadge({ status }) {
  const meta = subscriptionStatusMeta(status);
  return <Badge variant="outline" className={meta.className}>{meta.label}</Badge>;
}

function OwnerBlock({ owner, compact = false }) {
  if (!owner) {
    return <p className="text-xs text-muted-foreground">Proprietário não encontrado.</p>;
  }
  return (
    <div className="min-w-0 space-y-0.5">
      <p className={`font-medium text-foreground truncate ${compact ? 'text-sm' : ''}`}>{owner.name || 'Sem nome'}</p>
      <p className="text-xs text-muted-foreground flex items-center gap-1 min-w-0">
        <Mail className="h-3 w-3 shrink-0" />
        <span className="truncate">{owner.email || 'Sem e-mail'}</span>
      </p>
      <p className="text-xs text-muted-foreground flex items-center gap-1">
        <Phone className="h-3 w-3 shrink-0" />
        <span>{owner.phone || 'Sem telefone'}</span>
      </p>
    </div>
  );
}

function PlanBlock({ company }) {
  if (!company.plan) {
    return <p className="text-xs text-muted-foreground">Sem plano vinculado.</p>;
  }
  return (
    <div>
      <p className="font-medium text-foreground">{company.plan.name || 'Plano sem nome'}</p>
      <p className="text-xs text-muted-foreground">{formatPlanPrice(company.plan)}</p>
    </div>
  );
}

function SubscriptionDates({ subscription }) {
  if (!subscription) {
    return <p className="text-xs text-muted-foreground">Empresa sem assinatura registrada.</p>;
  }
  return (
    <div className="text-xs text-muted-foreground space-y-0.5">
      <p>Início: {fmtDate(subscription.startedAt)}</p>
      <p>Expira: {fmtDate(subscription.expiresAt)}</p>
    </div>
  );
}

function CompanyCard({ company }) {
  const status = companyStatusMeta(company.active);
  return (
    <article className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-heading font-bold text-foreground truncate">{company.name || 'Empresa sem nome'}</p>
          <p className="text-xs text-muted-foreground truncate">
            {company.slug ? `/${company.slug}` : 'Slug não informado'}
            {company.segment ? ` • ${company.segment}` : ''}
          </p>
          <p className="text-[11px] text-muted-foreground mt-1">Criada em {fmtDate(company.createdAt)}</p>
        </div>
        <Badge variant="outline" className={`shrink-0 ${status.className}`}>{status.label}</Badge>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-muted/40 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Proprietário</p>
          <OwnerBlock owner={company.owner} compact />
        </div>
        <div className="rounded-xl bg-muted/40 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Plano</p>
          <PlanBlock company={company} />
        </div>
      </div>

      <div className="mt-3">
        <SubscriptionBadge status={company.subscription?.status} />
      </div>
      <div className="mt-2">
        <SubscriptionDates subscription={company.subscription} />
      </div>
    </article>
  );
}

export default function MasterEmpresas() {
  const [loading, setLoading] = useState(true);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState({ items: [], hasMore: false, metrics: null });
  const [plans, setPlans] = useState([]);

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [companyStatus, setCompanyStatus] = useState('all');
  const [subscriptionStatus, setSubscriptionStatus] = useState('all');
  const [planId, setPlanId] = useState('all');
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const id = requestId.current + 1;
    requestId.current = id;
    setLoading(true);
    setError('');
    try {
      const result = await getMasterCompaniesOverview(supabase, {
        search,
        companyStatus,
        subscriptionStatus,
        planId,
        limit: MASTER_COMPANIES_LIMIT,
      });
      if (id !== requestId.current) return;
      setData(result);
    } catch (err) {
      if (id !== requestId.current) return;
      setError(err?.message || 'Não foi possível carregar as empresas.');
    } finally {
      if (id === requestId.current) {
        setLoading(false);
        setInitialLoading(false);
      }
    }
  }, [search, companyStatus, subscriptionStatus, planId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let active = true;
    listPlans(supabase, { onlyActive: false })
      .then((rows) => { if (active) setPlans(rows); })
      .catch(() => { if (active) setPlans([]); });
    return () => { active = false; };
  }, []);

  const handleSearch = (event) => {
    event.preventDefault();
    const next = searchInput.trim();
    if (next === search) load();
    else setSearch(next);
  };

  const handleSubscriptionChange = (value) => {
    setSubscriptionStatus(value);
    if (value === 'none') setPlanId('all');
  };

  const clearFilters = () => {
    setSearchInput('');
    setSearch('');
    setCompanyStatus('all');
    setSubscriptionStatus('all');
    setPlanId('all');
  };

  if (initialLoading) return <Spinner />;

  const metrics = data.metrics;
  const hasFilters = Boolean(search)
    || companyStatus !== 'all'
    || subscriptionStatus !== 'all'
    || planId !== 'all';
  const view = companiesViewState({
    loading: false,
    error: error && data.items.length === 0 ? error : '',
    total: data.items.length,
  });

  const cards = [
    { icon: Building2, label: 'Total de empresas', value: metrics?.totalCompanies },
    {
      icon: CheckCircle2,
      label: 'Empresas ativas',
      value: metrics?.activeCompanies,
      detail: metrics ? `${metrics.inactiveCompanies} inativas` : null,
    },
    { icon: Clock, label: 'Em trial', value: metrics?.trials },
    { icon: CalendarClock, label: 'Vencendo em 7 dias', value: metrics?.expiringSoon },
    { icon: AlertTriangle, label: 'Sem assinatura/plano', value: metrics?.withoutSubscriptionOrPlan },
  ];

  return (
    <div>
      <PageHeader title="Empresas" description="Visão consolidada das empresas e assinaturas da plataforma">
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Atualizar
        </Button>
      </PageHeader>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 mb-4 text-sm text-destructive" role="alert">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
          <Button variant="outline" size="sm" className="ml-auto" onClick={load}>Tentar de novo</Button>
        </div>
      )}

      <div className="grid grid-cols-2 xl:grid-cols-5 gap-3 mb-4">
        {cards.map((card) => <MetricCard key={card.label} {...card} />)}
      </div>
      <p className="text-[11px] text-muted-foreground mb-4">
        Indicadores globais da plataforma, independentes dos filtros abaixo.
      </p>

      <div className="rounded-2xl border border-border bg-card p-3 sm:p-4 mb-4">
        <form onSubmit={handleSearch} className="flex flex-col lg:flex-row gap-2">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Buscar por nome, slug ou e-mail do proprietário"
              className="pl-9"
              aria-label="Buscar empresas"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 lg:w-auto">
            <Select value={companyStatus} onValueChange={setCompanyStatus}>
              <SelectTrigger className="w-full lg:w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                {COMPANY_STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={subscriptionStatus} onValueChange={handleSubscriptionChange}>
              <SelectTrigger className="w-full lg:w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SUBSCRIPTION_STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={planId} onValueChange={setPlanId} disabled={subscriptionStatus === 'none'}>
              <SelectTrigger className="w-full lg:w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os planos</SelectItem>
                {plans.map((plan) => (
                  <SelectItem key={plan.id} value={plan.id}>{plan.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" className="h-10">Buscar</Button>
            {hasFilters && <Button type="button" variant="ghost" size="sm" className="h-10" onClick={clearFilters}>Limpar</Button>}
          </div>
        </form>
      </div>

      <p className="text-[11px] text-muted-foreground mb-3">
        {masterCompaniesLimitNote({ hasMore: data.hasMore, limit: MASTER_COMPANIES_LIMIT })}
      </p>

      <div aria-busy={loading} className={loading ? 'opacity-50 pointer-events-none' : ''}>
        {view === 'empty' && (
          <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
            <Store className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              {masterCompaniesEmptyMessage({ search, companyStatus, subscriptionStatus, planId })}
            </p>
          </div>
        )}

        {view === 'ready' && (
          <>
            <div className="hidden lg:block overflow-x-auto rounded-2xl border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Empresa</th>
                    <th className="px-4 py-3 font-semibold">Proprietário</th>
                    <th className="px-4 py-3 font-semibold">Plano</th>
                    <th className="px-4 py-3 font-semibold">Assinatura</th>
                    <th className="px-4 py-3 font-semibold">Situação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.items.map((company) => {
                    const status = companyStatusMeta(company.active);
                    return (
                      <tr key={company.id} className="align-top hover:bg-muted/30">
                        <td className="px-4 py-3">
                          <p className="font-medium text-foreground">{company.name || 'Empresa sem nome'}</p>
                          <p className="text-xs text-muted-foreground">
                            {company.slug ? `/${company.slug}` : 'Sem slug'}
                            {company.segment ? ` • ${company.segment}` : ''}
                          </p>
                          <p className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
                            <CalendarDays className="h-3 w-3" /> {fmtDate(company.createdAt)}
                          </p>
                        </td>
                        <td className="px-4 py-3 min-w-48"><OwnerBlock owner={company.owner} /></td>
                        <td className="px-4 py-3 min-w-40"><PlanBlock company={company} /></td>
                        <td className="px-4 py-3 min-w-44">
                          <SubscriptionBadge status={company.subscription?.status} />
                          <div className="mt-1"><SubscriptionDates subscription={company.subscription} /></div>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className={status.className}>{status.label}</Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="lg:hidden grid gap-3">
              {data.items.map((company) => <CompanyCard key={company.id} company={company} />)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
