import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/api/supabaseClient';
import { useSupabaseAuth } from '@/lib/SupabaseAuthContext';
import { listLeads, setLeadStatus, LEAD_STATUSES, LEAD_BILLING_PERIODS, leadStatusLabel, leadPaymentLabel, leadBillingLabel } from '@/api/leads';
import { buildLeadFollowUpUrl } from '@/lib/whatsapp';
import { isPlatformAdmin } from '@/api/plans';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { ShieldAlert, Phone, Mail, Building2, RefreshCw, MessageCircle, ChevronDown, AlertTriangle } from 'lucide-react';

function Spinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-4 border-border border-t-primary rounded-full animate-spin" />
    </div>
  );
}

export default function MasterInteressados() {
  const { toast } = useToast();
  const { user: sbUser } = useSupabaseAuth();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [leads, setLeads] = useState([]);
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterService, setFilterService] = useState('all');
  const [filterBilling, setFilterBilling] = useState('all');
  const [updating, setUpdating] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [expanded, setExpanded] = useState(null);

  const load = async (status) => {
    setLoadError('');
    try {
      setLeads(await listLeads(supabase, { status: status === 'all' ? null : status }));
    } catch (err) {
      setLoadError(err?.message || 'Não foi possível carregar os cadastros.');
    }
  };

  useEffect(() => {
    const init = async () => {
      const statusParam = searchParams.get('status');
      const initialStatus = LEAD_STATUSES.some((s) => s.id === statusParam) ? statusParam : 'all';
      const billingParam = searchParams.get('billing');
      setFilterStatus(initialStatus);
      setFilterService(searchParams.get('service') || 'all');
      setFilterBilling(LEAD_BILLING_PERIODS.some((p) => p.id === billingParam) ? billingParam : 'all');
      try {
        const admin = await isPlatformAdmin(supabase, sbUser?.id);
        setIsAdmin(admin);
        if (admin) await load(initialStatus);
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    };
    init();
  }, [sbUser?.id]);

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

  const handleStatus = async (lead, status) => {
    setUpdating(lead.id);
    try {
      await setLeadStatus(supabase, lead.id, status);
      setLeads(prev => prev.map(l => (l.id === lead.id ? { ...l, status } : l)));
      toast({ title: 'Status atualizado!' });
    } catch (err) {
      toast({ title: 'Erro', description: err?.message, variant: 'destructive' });
    } finally {
      setUpdating(null);
    }
  };

  const visible = leads.filter(l => (
    (filterService === 'all' || l.service === filterService)
    && (filterBilling === 'all' || l.billing_period === filterBilling)
  ));
  const services = [...new Set(leads.map(l => l.service).filter(Boolean))];

  return (
    <div>
      <PageHeader title="Interessados" description="Cadastros recebidos pela página pública">
        <Button variant="outline" size="sm" onClick={() => load(filterStatus)}><RefreshCw className="h-4 w-4" /> Atualizar</Button>
      </PageHeader>

      <div className="flex flex-wrap gap-2 mb-4">
        <Select value={filterStatus} onValueChange={v => { setFilterStatus(v); load(v); }}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            {LEAD_STATUSES.map(s => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterService} onValueChange={setFilterService}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Serviço" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os serviços</SelectItem>
            {services.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterBilling} onValueChange={setFilterBilling}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Periodicidade" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as periodicidades</SelectItem>
            {LEAD_BILLING_PERIODS.map(p => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {loadError && (
        <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 mb-4 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{loadError}</span>
          <Button variant="outline" size="sm" className="ml-auto" onClick={() => load(filterStatus)}>Tentar de novo</Button>
        </div>
      )}

      {visible.length === 0 && !loadError ? (
        <p className="text-sm text-muted-foreground py-10 text-center">Nenhum cadastro encontrado.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map(lead => {
            let waUrl = '';
            try { waUrl = buildLeadFollowUpUrl(lead); } catch { waUrl = ''; }
            const isOpen = expanded === lead.id;
            const address = lead.address || {};
            const addressLine = [address.street, address.number, address.complement, address.neighborhood, address.city, address.state, address.zip_code].filter(Boolean).join(' • ');
            const toggleExpanded = () => setExpanded(isOpen ? null : lead.id);
            return (
            <div
              key={lead.id}
              role="button"
              tabIndex={0}
              aria-expanded={isOpen}
              aria-controls={`lead-detalhes-${lead.id}`}
              onClick={toggleExpanded}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggleExpanded();
                }
              }}
              className="rounded-2xl border border-border bg-card p-4 cursor-pointer transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-heading font-bold text-foreground truncate">{lead.full_name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {[lead.company_name, lead.trade_name].filter(Boolean).join(' • ') || 'Pessoa física'}
                  </p>
                </div>
                <Badge variant="secondary" className="shrink-0">{leadStatusLabel(lead.status)}</Badge>
              </div>
              <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                <p className="flex items-center gap-1.5"><Building2 className="h-3 w-3" /> {lead.service}{lead.service_other ? `: ${lead.service_other}` : ''}{lead.cnpj ? ` • ${lead.cnpj}` : ''}</p>
                <p className="flex items-center gap-1.5"><Phone className="h-3 w-3" /> {lead.phone}</p>
                <p className="flex items-center gap-1.5"><Mail className="h-3 w-3" /> {lead.email}</p>
                {lead.payment_preference && (
                  <p>Pagamento preferido: <span className="font-medium text-foreground">{leadPaymentLabel(lead.payment_preference)}</span></p>
                )}
                {lead.plan_interest && (
                  <p>Plano: <span className="font-medium text-foreground">{lead.plan_interest}</span></p>
                )}
                {lead.billing_period && (
                  <p>Periodicidade: <span className="font-medium text-foreground">{leadBillingLabel(lead.billing_period)}</span></p>
                )}
                <p>Cadastrado em {lead.created_at ? new Date(lead.created_at).toLocaleDateString('pt-BR') : '—'}</p>
              </div>
              {isOpen && (
                <dl id={`lead-detalhes-${lead.id}`} className="mt-2 rounded-xl bg-muted/50 p-3 space-y-1 text-xs">
                  {lead.cpf && <div className="flex justify-between gap-2"><dt className="text-muted-foreground">CPF</dt><dd className="font-medium text-right">{lead.cpf}</dd></div>}
                  {lead.role && <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Cargo</dt><dd className="font-medium text-right">{lead.role}</dd></div>}
                  {lead.state_registration && <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Inscr. estadual</dt><dd className="font-medium text-right">{lead.state_registration}</dd></div>}
                  {addressLine && <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Endereço</dt><dd className="font-medium text-right">{addressLine}</dd></div>}
                  {lead.notes && <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Observações</dt><dd className="font-medium text-right">{lead.notes}</dd></div>}
                  {lead.consent_at && <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Consentimento</dt><dd className="font-medium text-right">{new Date(lead.consent_at).toLocaleDateString('pt-BR')}</dd></div>}
                </dl>
              )}
              <div
                className="mt-3 flex gap-2"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                <Select value={lead.status} disabled={updating === lead.id} onValueChange={v => handleStatus(lead, v)}>
                  <SelectTrigger className="h-8 text-xs flex-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LEAD_STATUSES.map(s => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={() => setExpanded(isOpen ? null : lead.id)}
                  aria-expanded={isOpen}
                  aria-controls={`lead-detalhes-${lead.id}`}
                  aria-label={isOpen ? 'Ocultar detalhes' : 'Ver detalhes'}
                >
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </Button>
                {waUrl ? (
                  <Button size="sm" className="h-8" asChild>
                    <a href={waUrl} target="_blank" rel="noopener" aria-label={`Conversar com ${lead.full_name} no WhatsApp`}>
                      <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                    </a>
                  </Button>
                ) : (
                  <Button size="sm" className="h-8" disabled title="Cadastro sem telefone válido">WhatsApp</Button>
                )}
              </div>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
