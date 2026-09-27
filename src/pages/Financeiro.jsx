import React, { useState, useEffect, useMemo } from 'react';
import { supabase, isSupabaseConfigured } from '@/api/supabaseClient';
import { useSupabaseAuth } from '@/lib/SupabaseAuthContext';
import { listOrders } from '@/api/orders';
import { useCompany } from '@/hooks/useCompany';
import PageHeader from '@/components/PageHeader';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TrendingUp, Receipt, ShoppingBag, XCircle, Ban, Wallet } from 'lucide-react';
import { PERIODS, getPeriodRange, filterByPeriod, summarizeOrders } from '@/lib/finance';

const fmtCurrency = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);

const TYPE_LABELS = { delivery: 'Delivery', retirada: 'Retirada', mesa: 'Mesa' };
const STATUS_LABELS = {
  novo: 'Novo', confirmado: 'Confirmado', em_preparo: 'Em preparo',
  aguardando_retirada: 'Pronto', saiu_entrega: 'Saiu p/ entrega',
  finalizado: 'Finalizado', cancelado: 'Cancelado',
};

function Spinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-4 border-border border-t-primary rounded-full animate-spin" />
    </div>
  );
}

export default function Financeiro() {
  const { loading, company: base44Company } = useCompany();
  // FASE 5.4: leitura de pedidos via Supabase quando há sessão (agregações intactas).
  const { user: sbUser, currentCompany: sbCompany } = useSupabaseAuth();
  const sbActive = isSupabaseConfigured() && !!sbUser && !!sbCompany;
  const company = sbActive ? { id: sbCompany.id, ...sbCompany } : base44Company;
  const [orders, setOrders] = useState([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [period, setPeriod] = useState('hoje');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  // Financeiro Supabase-only (agregações em @/lib/finance, intactas).
  useEffect(() => {
    if (!company) return;
    const load = async () => {
      try {
        setOrders(await listOrders(supabase, company.id, 500));
      } catch (err) { console.error(err); }
      finally { setDataLoading(false); }
    };
    load();
  }, [company?.id, sbActive]);

  const summary = useMemo(() => {
    const range = getPeriodRange(period, customStart, customEnd);
    return summarizeOrders(filterByPeriod(orders, range));
  }, [orders, period, customStart, customEnd]);

  if (loading || dataLoading) return <Spinner />;
  if (!company) return null;

  const cards = [
    { icon: TrendingUp, label: 'Receita do período', value: fmtCurrency(summary.revenue), color: 'text-green-600', bg: 'bg-green-50' },
    { icon: Receipt, label: 'Ticket médio', value: fmtCurrency(summary.avgTicket), color: 'text-primary', bg: 'bg-primary/5' },
    { icon: ShoppingBag, label: 'Pedidos pagos', value: summary.paidCount, color: 'text-blue-600', bg: 'bg-blue-50' },
    { icon: Ban, label: 'Pedidos cancelados', value: summary.canceledCount, color: 'text-red-600', bg: 'bg-red-50' },
    { icon: Wallet, label: 'Total de pedidos', value: summary.totalOrders, color: 'text-orange-600', bg: 'bg-orange-50' },
    { icon: XCircle, label: 'Taxa de cancelamento', value: summary.totalOrders > 0 ? `${Math.round((summary.canceledCount / summary.totalOrders) * 100)}%` : '0%', color: 'text-muted-foreground', bg: 'bg-muted' },
  ];

  return (
    <div>
      <PageHeader title="Financeiro" description="Receitas e indicadores por período" />

      <div className="flex flex-wrap gap-2 mb-4">
        {PERIODS.map(p => (
          <button
            key={p.id}
            onClick={() => setPeriod(p.id)}
            className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors ${period === p.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {period === 'custom' && (
        <div className="grid grid-cols-2 gap-3 mb-4 max-w-md">
          <div className="space-y-1 min-w-0"><Label>Início</Label><Input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} /></div>
          <div className="space-y-1 min-w-0"><Label>Fim</Label><Input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} /></div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-6">
        {cards.map((s, i) => (
          <div key={i} className="rounded-2xl border border-border bg-card p-5">
            <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${s.bg} mb-3`}>
              <s.icon className={`h-5 w-5 ${s.color}`} />
            </div>
            <p className="text-sm text-muted-foreground">{s.label}</p>
            <p className="font-heading text-2xl font-bold text-foreground mt-1">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card p-6">
          <h2 className="font-heading font-semibold text-foreground mb-4">Por status</h2>
          <div className="space-y-2">
            {Object.entries(summary.byStatus).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{STATUS_LABELS[k] || k} ({v.count})</span>
                <span className="font-semibold text-foreground">{fmtCurrency(v.total)}</span>
              </div>
            ))}
            {Object.keys(summary.byStatus).length === 0 && <p className="text-sm text-muted-foreground">Sem pedidos no período.</p>}
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6">
          <h2 className="font-heading font-semibold text-foreground mb-4">Por tipo de atendimento</h2>
          <div className="space-y-2">
            {Object.entries(summary.byType).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{TYPE_LABELS[k] || k} ({v.count})</span>
                <span className="font-semibold text-foreground">{fmtCurrency(v.total)}</span>
              </div>
            ))}
            {Object.keys(summary.byType).length === 0 && <p className="text-sm text-muted-foreground">Sem pedidos no período.</p>}
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6">
          <h2 className="font-heading font-semibold text-foreground mb-4">Por pagamento (pagos)</h2>
          <div className="space-y-2">
            {Object.entries(summary.byPayment).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground truncate mr-2">{k} ({v.count})</span>
                <span className="font-semibold text-foreground shrink-0">{fmtCurrency(v.total)}</span>
              </div>
            ))}
            {Object.keys(summary.byPayment).length === 0 && <p className="text-sm text-muted-foreground">Sem pagamentos no período.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
