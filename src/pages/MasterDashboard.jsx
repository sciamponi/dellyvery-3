import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/api/supabaseClient';
import { listLeads, leadStatusLabel, leadBillingLabel } from '@/api/leads';
import { summarizeLeads } from '@/lib/leadStats';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, AlertTriangle, Users, UserPlus, LayoutGrid, CalendarClock } from 'lucide-react';

function Spinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-4 border-border border-t-primary rounded-full animate-spin" />
    </div>
  );
}

// Dashboard Master: indicadores derivados dos leads reais (RLS: só admin).
// Sem metas ou gráficos fictícios; vazio/erro de rede com estados próprios.
export default function MasterDashboard() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [leads, setLeads] = useState([]);

  const load = async () => {
    setError('');
    setLoading(true);
    try {
      setLeads(await listLeads(supabase, { limit: 1000 }));
    } catch (err) {
      setError(err?.message || 'Não foi possível carregar os interessados.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (loading) return <Spinner />;

  const stats = summarizeLeads(leads);

  const cards = [
    { icon: Users, label: 'Interessados', value: stats.total },
    { icon: UserPlus, label: 'Novos cadastros', value: stats.novos },
    { icon: LayoutGrid, label: 'Serviços', value: stats.byService.length },
    { icon: CalendarClock, label: 'Periodicidades', value: stats.byBilling.filter((b) => b.label !== '—').length },
  ];

  const distBlock = (title, rows, emptyHint) => (
    <div className="rounded-2xl border border-border bg-card p-4">
      <h3 className="font-heading font-bold text-sm text-foreground mb-3">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyHint}</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.label}>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-muted-foreground truncate">{r.label}</span>
                <span className="font-semibold text-foreground ml-2">{r.count}</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${stats.total > 0 ? Math.round((r.count / stats.total) * 100) : 0}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div>
      <PageHeader title="Dashboard Master" description="Acompanhamento dos interessados">
        <Button variant="outline" size="sm" onClick={load}><RefreshCw className="h-4 w-4" /> Atualizar</Button>
      </PageHeader>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 mb-4 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
          <Button variant="outline" size="sm" className="ml-auto" onClick={load}>Tentar de novo</Button>
        </div>
      )}

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-2xl border border-border bg-card p-4">
            <c.icon className="h-5 w-5 text-muted-foreground mb-2" />
            <p className="font-heading text-2xl font-bold text-foreground">{c.value}</p>
            <p className="text-xs text-muted-foreground">{c.label}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-3 mb-4">
        {distBlock('Por serviço', stats.byService, 'Nenhum cadastro ainda.')}
        {distBlock('Por periodicidade', stats.byBilling, 'Nenhuma periodicidade informada.')}
        {distBlock(
          'Por status',
          stats.byStatus.map((r) => ({ ...r, label: leadStatusLabel(r.label) })),
          'Nenhum cadastro ainda.',
        )}
      </div>

      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-heading font-bold text-sm text-foreground">Mais recentes</h3>
          <Button variant="ghost" size="sm" asChild><Link to="/master/interessados">Ver todos</Link></Button>
        </div>
        {stats.recent.length === 0 ? (
          <p className="text-xs text-muted-foreground py-6 text-center">Nenhum cadastro encontrado.</p>
        ) : (
          <div className="space-y-2">
            {stats.recent.map((lead) => (
              <div key={lead.id} className="flex items-center gap-3 rounded-xl bg-muted/40 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground truncate">{lead.full_name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {lead.service}
                    {lead.billing_period ? ` • ${leadBillingLabel(lead.billing_period)}` : ''}
                    {lead.created_at ? ` • ${new Date(lead.created_at).toLocaleDateString('pt-BR')}` : ''}
                  </p>
                </div>
                <Badge variant="secondary" className="shrink-0">{leadStatusLabel(lead.status)}</Badge>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
