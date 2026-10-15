import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/api/supabaseClient';
import { useSupabaseAuth } from '@/lib/SupabaseAuthContext';
import { listPlans, isPlatformAdmin } from '@/api/plans';
import { listLeads, createLead } from '@/api/leads';
import { listAdhesions, getAdhesion, createAdhesion, updateAdhesion } from '@/api/adhesions';
import {
  ADHESION_STATUSES, ADHESION_PAYMENTS,
  fmtBRL, fmtDateBR, validateAdhesion, missingContractFields,
  buildContractModel, buildContractShareText,
} from '@/lib/contract';
import { toWaNumber, buildWaUrl } from '@/lib/whatsapp';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { Plus, ArrowLeft, ShieldAlert, Printer, MessageCircle, FileText, AlertTriangle } from 'lucide-react';

function Spinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-4 border-border border-t-primary rounded-full animate-spin" />
    </div>
  );
}

const CONTRACT_PRINT_CSS = `
@page { size: A4 portrait; margin: 12mm; }
@media print {
  body * { visibility: hidden; }
  .contract-print, .contract-print * { visibility: visible; }
  .contract-print { position: absolute; left: 0; top: 0; width: 100%; background: #fff; color: #000; }
  .no-print { display: none !important; }
}
`;

const emptyForm = () => ({
  lead_id: null,
  full_name: '', trade_name: '', person_type: 'pf', document: '', phone: '', email: '',
  address: { street: '', city: '', state: '', zip: '' },
  plan_id: '', plan_name: '', adhesion_fee: '', monthly_fee: '', discount_text: '',
  start_date: '', due_day: '', payment_method: '', status: 'rascunho',
  provider: { razao_social: '', document: '', address: '', city: '', phone: '', email: '' },
});

function leadLabel(l) {
  const name = l.full_name || l.trade_name || 'Sem nome';
  return `${name}${l.phone ? ` • ${l.phone}` : ''}`;
}

export default function MasterContratos() {
  const { toast } = useToast();
  const { user: sbUser } = useSupabaseAuth();
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adhesions, setAdhesions] = useState([]);
  const [plans, setPlans] = useState([]);
  const [leads, setLeads] = useState([]);
  const [filterStatus, setFilterStatus] = useState('all');
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [leadQuery, setLeadQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState(false);

  // Hook antes de qualquer return antecipado (regras dos hooks).
  // Busca sem duplicar: filtra cadastros existentes por nome/telefone/empresa.
  const leadMatches = useMemo(() => {
    const q = leadQuery.trim().toLowerCase();
    if (!q) return [];
    return (leads || []).filter((l) => [l.full_name, l.trade_name, l.phone, l.email]
      .some((v) => String(v || '').toLowerCase().includes(q))).slice(0, 6);
  }, [leads, leadQuery]);

  const loadAll = async () => {
    const [ads, pls, lds] = await Promise.all([
      listAdhesions(supabase, {}),
      listPlans(supabase, { onlyActive: true }).catch(() => []),
      listLeads(supabase, {}).catch(() => []),
    ]);
    setAdhesions(ads);
    setPlans(pls);
    setLeads(lds);
  };

  useEffect(() => {
    const init = async () => {
      try {
        const admin = await isPlatformAdmin(supabase, sbUser?.id);
        setIsAdmin(admin);
        if (admin) await loadAll();
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

  const upd = (patch) => setForm((prev) => ({ ...prev, ...patch }));
  const updAddr = (patch) => setForm((prev) => ({ ...prev, address: { ...prev.address, ...patch } }));
  const updProvider = (patch) => setForm((prev) => ({ ...prev, provider: { ...prev.provider, ...patch } }));

  const openNew = () => {
    setEditingId(null);
    setForm(emptyForm());
    setLeadQuery('');
  };

  const openEdit = async (id) => {
    try {
      const a = await getAdhesion(supabase, id);
      if (!a) throw new Error('Adesão não encontrada');
      setEditingId(id);
      setForm({
        ...emptyForm(), ...a,
        address: { street: '', city: '', state: '', zip: '', ...(a.address || {}) },
        provider: { razao_social: '', document: '', address: '', city: '', phone: '', email: '', ...(a.provider || {}) },
      });
      setLeadQuery('');
      window.scrollTo({ top: 0 });
    } catch (err) {
      toast({ title: 'Erro ao abrir', description: err?.message, variant: 'destructive' });
    }
  };

  // Busca sem duplicar: ver hook leadMatches no topo (antes dos returns).
  const pickLead = (l) => {
    setForm((prev) => ({
      ...prev,
      lead_id: l.id,
      full_name: prev.full_name || l.full_name || '',
      trade_name: prev.trade_name || l.trade_name || '',
      person_type: l.person_type || prev.person_type || 'pf',
      document: prev.document || l.cpf || l.cnpj || '',
      phone: prev.phone || l.phone || '',
      email: prev.email || l.email || '',
      address: {
        ...prev.address,
        street: prev.address.street || l.address || '',
      },
    }));
    setLeadQuery('');
  };

  // Novo cadastro via RPC oficial (evita duplicar: só quando a busca não achou).
  const handleCreateLead = async () => {
    if (!form.full_name.trim() || !form.phone.trim()) {
      toast({ title: 'Informe nome e telefone para cadastrar', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const res = await createLead(supabase, {
        full_name: form.full_name.trim(), phone: form.phone.trim(), email: form.email.trim(),
        trade_name: form.trade_name.trim(), person_type: form.person_type,
      });
      const leadId = res?.lead_id || res?.id;
      if (!leadId) throw new Error('Cadastro não retornou identificação');
      setForm((prev) => ({ ...prev, lead_id: leadId }));
      const lds = await listLeads(supabase, {}).catch(() => []);
      setLeads(lds);
      toast({ title: 'Cadastro criado e vinculado!' });
    } catch (err) {
      toast({ title: 'Erro ao cadastrar', description: err?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    const err = validateAdhesion(form);
    if (err) { toast({ title: err, variant: 'destructive' }); return; }
    setSaving(true);
    try {
      const plan = plans.find((p) => p.id === form.plan_id);
      const payload = { ...form, plan_name: plan?.name || form.plan_name };
      let saved;
      if (editingId) {
        saved = await updateAdhesion(supabase, editingId, payload,
          { action: 'atualizada', detail: { status: payload.status } }, sbUser?.id);
        toast({ title: 'Adesão atualizada!' });
      } else {
        saved = await createAdhesion(supabase, payload, sbUser?.id);
        setEditingId(saved.id);
        toast({ title: 'Contratação registrada!' });
      }
      setForm((prev) => ({ ...emptyForm(), ...saved }));
      const ads = await listAdhesions(supabase, {});
      setAdhesions(ads);
    } catch (e) {
      toast({ title: 'Erro ao salvar', description: e?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const plan = plans.find((p) => p.id === form.plan_id) || null;
  const model = buildContractModel({ ...form, plan_name: form.plan_name || plan?.name || '' }, plan);
  const missing = editingId ? missingContractFields({ ...form, plan_name: form.plan_name || plan?.name || '' }) : [];

  const handleEmit = async () => {
    if (!editingId) { toast({ title: 'Salve a adesão antes de emitir', variant: 'destructive' }); return; }
    const pend = missingContractFields({ ...form, plan_name: form.plan_name || plan?.name || '' });
    if (pend.length > 0) {
      toast({ title: 'Campos pendentes', description: pend.join('; '), variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const snapshot = buildContractModel({ ...form, plan_name: form.plan_name || plan?.name || '' }, plan);
      const saved = await updateAdhesion(supabase, editingId,
        { contract_snapshot: snapshot, contract_issued_at: new Date().toISOString() },
        { action: 'contrato_emitido', detail: { plan: snapshot.plan.name } }, sbUser?.id);
      setForm((prev) => ({ ...emptyForm(), ...saved }));
      const ads = await listAdhesions(supabase, {});
      setAdhesions(ads);
      toast({ title: 'Contrato emitido! Use Imprimir para gerar o PDF.' });
    } catch (e) {
      toast({ title: 'Erro ao emitir', description: e?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handlePrint = () => {
    setPrinting(true);
    setTimeout(() => { window.print(); setPrinting(false); }, 150);
  };

  const handleWhatsApp = () => {
    try {
      const wa = toWaNumber(form.phone);
      if (!wa) throw new Error('Telefone da contratante inválido para WhatsApp');
      window.open(buildWaUrl(wa, buildContractShareText(model)), '_blank', 'noopener');
    } catch (e) {
      toast({ title: 'WhatsApp', description: e?.message, variant: 'destructive' });
    }
  };

  const visible = adhesions.filter((a) => filterStatus === 'all' || a.status === filterStatus);
  const editing = editingId ? adhesions.find((a) => a.id === editingId) : null;

  return (
    <div>
      <style>{CONTRACT_PRINT_CSS}</style>
      <PageHeader title="Contratos e adesões" description="Contratações comerciais e documentos">
        <Button onClick={openNew} className="bg-primary hover:bg-primary/90">
          <Plus className="h-4 w-4" /> Nova contratação
        </Button>
      </PageHeader>

      <div className="no-print flex items-center gap-2 mb-4">
        <Label className="text-xs text-muted-foreground">Situação</Label>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            <SelectItem value="rascunho">Rascunho</SelectItem>
            <SelectItem value="ativa">Ativa</SelectItem>
            <SelectItem value="suspensa">Suspensa</SelectItem>
            <SelectItem value="cancelada">Cancelada</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="no-print grid gap-3 sm:grid-cols-2 lg:grid-cols-3 mb-6">
        {visible.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => openEdit(a.id)}
            className="rounded-2xl border border-border bg-card p-4 text-left hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="font-heading font-bold truncate">{a.full_name || 'Sem nome'}</p>
              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium">{a.status}</span>
            </div>
            <p className="text-sm text-muted-foreground truncate mt-0.5">{a.plan_name || 'Sem plano'} • {fmtBRL(a.monthly_fee)}/mês</p>
            <p className="text-xs text-muted-foreground mt-0.5">Adesão {fmtBRL(a.adhesion_fee)}{a.contract_issued_at ? ' • contrato emitido' : ''}</p>
          </button>
        ))}
        {visible.length === 0 && (
          <p className="text-sm text-muted-foreground sm:col-span-2 lg:col-span-3 py-6 text-center">Nenhuma contratação registrada.</p>
        )}
      </div>

      {/* Editor */}
      <div className="no-print rounded-2xl border border-border bg-card p-4 sm:p-6 space-y-5 max-w-3xl">
        <div className="flex items-center justify-between">
          <h3 className="font-heading font-semibold">{editingId ? `Adesão — ${form.full_name || 'sem nome'}` : 'Nova contratação'}</h3>
          {editingId && (
            <Button variant="ghost" size="sm" onClick={openNew}><ArrowLeft className="h-4 w-4" /> Nova</Button>
          )}
        </div>

        {/* 1. Contratante: localizar sem duplicar */}
        <div className="space-y-2">
          <Label>Contratante — localizar cadastro (evita duplicar)</Label>
          <Input value={leadQuery} onChange={(e) => setLeadQuery(e.target.value)} placeholder="Buscar por nome, empresa ou telefone..." />
          {leadMatches.length > 0 && (
            <div className="rounded-xl border border-border divide-y divide-border">
              {leadMatches.map((l) => (
                <button key={l.id} type="button" onClick={() => pickLead(l)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-muted">
                  {leadLabel(l)}
                </button>
              ))}
            </div>
          )}
          {form.lead_id && <p className="text-xs text-green-700">Cadastro vinculado ✓ (sem duplicar)</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>Nome completo *</Label><Input value={form.full_name} onChange={(e) => upd({ full_name: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Empresa / nome fantasia</Label><Input value={form.trade_name} onChange={(e) => upd({ trade_name: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Tipo</Label>
              <Select value={form.person_type} onValueChange={(v) => upd({ person_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="pf">Pessoa Física</SelectItem><SelectItem value="pj">Pessoa Jurídica</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>CPF/CNPJ</Label><Input value={form.document} onChange={(e) => upd({ document: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Telefone *</Label><Input value={form.phone} onChange={(e) => upd({ phone: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>E-mail</Label><Input value={form.email} onChange={(e) => upd({ email: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Endereço</Label><Input value={form.address.street} onChange={(e) => updAddr({ street: e.target.value })} /></div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1.5"><Label>Cidade</Label><Input value={form.address.city} onChange={(e) => updAddr({ city: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>UF</Label><Input value={form.address.state} onChange={(e) => updAddr({ state: e.target.value })} maxLength={2} /></div>
              <div className="space-y-1.5"><Label>CEP</Label><Input value={form.address.zip} onChange={(e) => updAddr({ zip: e.target.value })} /></div>
            </div>
          </div>
          {!form.lead_id && (
            <Button variant="outline" size="sm" onClick={handleCreateLead} disabled={saving}>
              Cadastrar como interessado (só se a busca não achou)
            </Button>
          )}
        </div>

        {/* 2. Plano */}
        <div className="space-y-2">
          <Label>Plano contratado (somente ativos)</Label>
          <Select value={form.plan_id || 'none'} onValueChange={(v) => {
            const p = plans.find((x) => x.id === v);
            upd({ plan_id: v === 'none' ? '' : v, plan_name: p?.name || '' });
          }}>
            <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Nenhum</SelectItem>
              {plans.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name} — {fmtBRL(p.price)}/mês</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {plan && plan.benefits?.length > 0 && (
            <p className="text-xs text-muted-foreground">Inclui: {plan.benefits.join(' • ')}</p>
          )}
        </div>

        {/* 3. Condições comerciais */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label>Taxa de adesão (R$, única)</Label><Input type="number" min="0" step="0.01" value={form.adhesion_fee} onChange={(e) => upd({ adhesion_fee: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Mensalidade negociada (R$)</Label><Input type="number" min="0" step="0.01" value={form.monthly_fee} onChange={(e) => upd({ monthly_fee: e.target.value })} /></div>
          <div className="space-y-1.5 sm:col-span-2"><Label>Descontos e condições especiais</Label><Textarea value={form.discount_text} onChange={(e) => upd({ discount_text: e.target.value })} rows={2} /></div>
          <div className="space-y-1.5"><Label>Data de início</Label><Input type="date" value={form.start_date || ''} onChange={(e) => upd({ start_date: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Dia do vencimento (1–28)</Label><Input type="number" min="1" max="28" value={form.due_day ?? ''} onChange={(e) => upd({ due_day: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Forma de pagamento</Label>
            <Select value={form.payment_method || 'none'} onValueChange={(v) => upd({ payment_method: v === 'none' ? '' : v })}>
              <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Não definida</SelectItem>
                {ADHESION_PAYMENTS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>Situação</Label>
            <Select value={form.status} onValueChange={(v) => upd({ status: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ADHESION_STATUSES.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* 4. Fornecedora */}
        <div className="space-y-2">
          <Label>Fornecedora (dados do contrato; sem tabela própria — preencher por contrato)</Label>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>Razão social *</Label><Input value={form.provider.razao_social} onChange={(e) => updProvider({ razao_social: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>CNPJ *</Label><Input value={form.provider.document} onChange={(e) => updProvider({ document: e.target.value })} /></div>
            <div className="space-y-1.5 sm:col-span-2"><Label>Endereço *</Label><Input value={form.provider.address} onChange={(e) => updProvider({ address: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Cidade/UF</Label><Input value={form.provider.city} onChange={(e) => updProvider({ city: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Telefone</Label><Input value={form.provider.phone} onChange={(e) => updProvider({ phone: e.target.value })} /></div>
            <div className="space-y-1.5 sm:col-span-2"><Label>E-mail</Label><Input value={form.provider.email} onChange={(e) => updProvider({ email: e.target.value })} /></div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <Button onClick={handleSave} disabled={saving} className="flex-1 min-h-11">
            {saving ? 'Salvando...' : (editingId ? 'Salvar alterações' : 'Registrar contratação')}
          </Button>
        </div>

        {/* 5. Prévia + emissão */}
        {editingId && (
          <div className="space-y-3 border-t border-border pt-4">
            <h4 className="font-heading font-semibold flex items-center gap-2"><FileText className="h-4 w-4" /> Prévia do contrato</h4>
            {missing.length > 0 && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <p className="font-medium flex items-center gap-1.5"><AlertTriangle className="h-4 w-4" /> Pendente para emissão:</p>
                <p className="mt-1">{missing.join('; ')}</p>
              </div>
            )}
            <div className="flex flex-col sm:flex-row gap-2">
              <Button variant="outline" onClick={handleEmit} disabled={saving} className="flex-1 min-h-11">Emitir contrato</Button>
              <Button variant="outline" onClick={handlePrint} disabled={printing} className="flex-1 min-h-11">
                <Printer className="h-4 w-4" /> {printing ? 'Preparando...' : 'Imprimir / PDF'}
              </Button>
              <Button variant="outline" onClick={handleWhatsApp} className="flex-1 min-h-11">
                <MessageCircle className="h-4 w-4" /> WhatsApp
              </Button>
            </div>
            {editing?.contract_issued_at && (
              <p className="text-xs text-muted-foreground">Contrato emitido em {new Date(editing.contract_issued_at).toLocaleString('pt-BR')} (snapshot congelado).</p>
            )}
            {editing?.events?.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Histórico</p>
                {editing.events.slice().reverse().map((ev, i) => (
                  <p key={i} className="text-xs text-muted-foreground">
                    {ev.at ? new Date(ev.at).toLocaleString('pt-BR') : ''} — {ev.action}{ev.detail?.status || ev.detail?.plan ? ` (${ev.detail.status || ev.detail.plan})` : ''}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Documento (prévia em tela + impressão) */}
      {editingId && (
        <div className="contract-print mx-auto mt-6 max-w-3xl rounded-2xl border border-border bg-card p-6 sm:p-8 space-y-4 text-sm">
          <div className="text-center space-y-1">
            <h2 className="font-heading text-xl font-bold">CONTRATO DE ADESÃO — DELLYVERY</h2>
            <p className="text-muted-foreground">Proposta comercial e condições de uso da plataforma</p>
          </div>
          <div className="space-y-1">
            <h3 className="font-heading font-semibold">1. Partes</h3>
            <p><b>Contratante:</b> {model.contractor.name || '—'}{model.contractor.tradeName ? ` (${model.contractor.tradeName})` : ''} — {model.contractor.personType}, documento {model.contractor.document || '—'}, telefone {model.contractor.phone || '—'}{model.contractor.email ? `, e-mail ${model.contractor.email}` : ''}.</p>
            {model.contractor.address && <p><b>Endereço:</b> {model.contractor.address}.</p>}
            <p><b>Contratada:</b> {model.provider.razaoSocial || '—'}, CNPJ {model.provider.document || '—'}{model.provider.address ? `, ${model.provider.address}` : ''}{model.provider.city ? ` — ${model.provider.city}` : ''}.</p>
          </div>
          <div className="space-y-1">
            <h3 className="font-heading font-semibold">2. Objeto e plano</h3>
            <p>Disponibilização da plataforma Dellyvery (cardápio digital, gestão de pedidos e áreas operacionais) no plano <b>{model.plan.name || '—'}</b>.</p>
            {model.plan.features.length > 0 && <p><b>Recursos:</b> {model.plan.features.join(' • ')}.</p>}
            {model.plan.benefits.length > 0 && <p><b>Benefícios:</b> {model.plan.benefits.join(' • ')}.</p>}
          </div>
          <div className="space-y-1">
            <h3 className="font-heading font-semibold">3. Valores e pagamento</h3>
            <p><b>Taxa de adesão (única):</b> {fmtBRL(model.commercial.adhesionFee)}.</p>
            <p><b>Mensalidade:</b> {fmtBRL(model.commercial.monthlyFee)}.</p>
            {model.commercial.discountText && <p><b>Condições especiais:</b> {model.commercial.discountText}.</p>}
            <p><b>Forma de pagamento:</b> {model.commercial.paymentMethod || '—'} • <b>Vencimento:</b> dia {model.commercial.dueDay ?? '—'}.</p>
          </div>
          <div className="space-y-1">
            <h3 className="font-heading font-semibold">4. Vigência, cancelamento e responsabilidades</h3>
            <p><b>Início:</b> {fmtDateBR(model.commercial.startDate)} • <b>Situação:</b> {model.commercial.status}.</p>
            <p>A contratante pode solicitar o cancelamento a qualquer tempo, sem multa sobre meses vincendos; valores já pagos não são reembolsados. A contratada mantém a plataforma disponível e o suporte nos canais informados. Este documento é uma proposta comercial e passa a valer como contrato mediante aceite expresso das partes.</p>
          </div>
          <div className="grid grid-cols-2 gap-6 pt-8">
            <div className="text-center"><p className="border-t border-foreground pt-1">Contratante — {model.contractor.name || 'assinatura'}</p></div>
            <div className="text-center"><p className="border-t border-foreground pt-1">Contratada — {model.provider.razaoSocial || 'assinatura'}</p></div>
          </div>
          <p className="text-xs text-muted-foreground text-center pt-2">Emitido em {new Date(model.issuedAt).toLocaleString('pt-BR')}. Sem validade de assinatura eletrônica.</p>
        </div>
      )}
    </div>
  );
}
