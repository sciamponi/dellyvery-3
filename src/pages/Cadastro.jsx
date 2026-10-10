import React, { useState, useRef, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '@/api/supabaseClient';
import { createLead, LEAD_SERVICES, LEAD_BILLING_PERIODS, leadBillingLabel, resolvePlanInterest } from '@/api/leads';
import { buildLeadInboundUrl } from '@/lib/whatsapp';
import {
  onlyDigits, maskCNPJ, maskCPF, maskCEP, maskPhone,
  isValidCPF, isValidCNPJ, isValidEmail, isValidPhone, isValidCEP,
} from '@/lib/brdocs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { Building2, UserCheck, Package, ClipboardCheck, ArrowLeft, ArrowRight, CheckCircle, Loader2 } from 'lucide-react';

const STEPS = [
  { id: 1, label: 'Empresa', icon: Building2 },
  { id: 2, label: 'Responsável', icon: UserCheck },
  { id: 3, label: 'Serviço', icon: Package },
  { id: 4, label: 'Revisão', icon: ClipboardCheck },
];

const initialForm = {
  personType: 'pj',
  company_name: '', trade_name: '', cnpj: '', state_registration: '',
  zip_code: '', address: '', number: '', complement: '', neighborhood: '', city: '', state: '',
  full_name: '', cpf: '', role: '', phone: '', email: '',
  service: '', service_other: '', plan_interest: '', billing_period: '', notes: '', consent: false,
};

function FieldError({ message }) {
  if (!message) return null;
  return <p className="text-xs text-destructive mt-1">{message}</p>;
}

export default function Cadastro() {
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState(initialForm);
  const [errors, setErrors] = useState({});
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const sendingRef = useRef(false);

  // Plano vindo dos CTAs de /planos (?plano=): atribuição oculta — sem campo
  // visível no formulário, mas preservado no cadastro, WhatsApp e Master.
  // Não sobrescreve nada (estado só recebe o preset uma vez).
  useEffect(() => {
    const preset = resolvePlanInterest(searchParams.get('plano'));
    if (preset) setForm((prev) => (prev.plan_interest ? prev : { ...prev, plan_interest: preset }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
    setErrors(prev => ({ ...prev, [field]: null }));
  };

  const validateStep = (s) => {
    const e = {};
    if (s === 1) {
      if (form.personType === 'pj') {
        if (!onlyDigits(form.cnpj)) e.cnpj = 'CNPJ é obrigatório para pessoa jurídica.';
        else if (!isValidCNPJ(form.cnpj)) e.cnpj = 'CNPJ inválido. Confira os números.';
      }
      if (form.zip_code && !isValidCEP(form.zip_code)) e.zip_code = 'CEP inválido (8 dígitos).';
    }
    if (s === 2) {
      if (!form.full_name.trim()) e.full_name = 'Nome completo é obrigatório.';
      if (form.personType === 'pf' && !onlyDigits(form.cpf)) e.cpf = 'CPF é obrigatório para pessoa física.';
      else if (form.cpf && !isValidCPF(form.cpf)) e.cpf = 'CPF inválido. Confira os números.';
      if (!onlyDigits(form.phone)) e.phone = 'Telefone/WhatsApp é obrigatório.';
      else if (!isValidPhone(form.phone)) e.phone = 'Telefone inválido (DDD + número).';
      if (!form.email.trim()) e.email = 'E-mail é obrigatório.';
      else if (!isValidEmail(form.email)) e.email = 'E-mail inválido.';
    }
    if (s === 3) {
      if (!form.service) e.service = 'Escolha o serviço desejado.';
      if (form.service === 'outro' && !form.service_other.trim()) {
        e.service_other = 'Descreva o serviço desejado.';
      }
      if (!form.billing_period) e.billing_period = 'Escolha a periodicidade desejada.';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleNext = () => {
    if (!validateStep(step)) return;
    setStep(s => Math.min(4, s + 1));
    window.scrollTo({ top: 0 });
  };

  const handleSubmit = async () => {
    if (!form.consent) {
      setErrors({ consent: 'É necessário aceitar o uso dos dados para contato.' });
      return;
    }
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    try {
      await createLead(supabase, {
        service: form.service,
        service_other: form.service === 'outro' ? form.service_other.trim() : '',
        person_type: form.personType,
        company_name: form.company_name.trim(),
        trade_name: form.trade_name.trim(),
        cnpj: onlyDigits(form.cnpj),
        state_registration: form.state_registration.trim(),
        full_name: form.full_name.trim(),
        cpf: onlyDigits(form.cpf),
        role: form.role.trim(),
        phone: onlyDigits(form.phone),
        email: form.email.trim(),
        address: {
          street: form.address.trim(), number: form.number.trim(),
          complement: form.complement.trim(), neighborhood: form.neighborhood.trim(),
          city: form.city.trim(), state: form.state.trim(), zip_code: onlyDigits(form.zip_code),
        },
        notes: form.notes.trim(),
        plan_interest: form.plan_interest.trim(),
        billing_period: form.billing_period,
        consent: true,
      });
      setDone(true);
      window.scrollTo({ top: 0 });
    } catch (err) {
      toast({ title: 'Não foi possível concluir o envio', description: err?.message || 'Tente novamente.', variant: 'destructive' });
    } finally {
      setSending(false);
      sendingRef.current = false;
    }
  };

  // Declarado antes de qualquer return (evita TDZ na tela de sucesso).
  const serviceLabel = LEAD_SERVICES.find(s => s.id === form.service)?.label || '—';

  if (done) {
    // Link de WhatsApp é opcional: falha aqui nunca derruba a confirmação.
    let waUrl = '';
    try {
      waUrl = buildLeadInboundUrl({
        name: form.full_name.trim() || form.company_name.trim(),
        serviceLabel: serviceLabel !== '—' ? serviceLabel : '',
        plan: form.plan_interest.trim(),
        billingLabel: leadBillingLabel(form.billing_period),
      });
    } catch {
      waUrl = '';
    }
    return (
      <div className="min-h-screen bg-muted/40 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center">
          <CheckCircle className="h-12 w-12 text-green-600 mx-auto mb-4" />
          <h1 className="font-heading text-xl font-bold text-foreground">Dados enviados com sucesso!</h1>
          <p className="text-sm text-muted-foreground mt-2">Nossa equipe entrará em contato para dar continuidade ao processo de contratação.</p>
          {waUrl ? (
            <Button asChild className="mt-6 w-full"><a href={waUrl} target="_blank" rel="noopener">Continuar no WhatsApp</a></Button>
          ) : (
            <p className="mt-6 text-sm text-muted-foreground">Se preferir, chame a gente no WhatsApp comercial para agilizar o atendimento.</p>
          )}
          <Button asChild variant="outline" className="mt-2 w-full"><Link to="/">Voltar ao início</Link></Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/40">
      <div className="mx-auto max-w-2xl px-4 py-8">
        <div className="text-center mb-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">Automatiza Solução</p>
          <h1 className="font-heading text-2xl font-bold text-foreground mt-1">Vamos iniciar nossa parceria?</h1>
          <p className="text-sm text-muted-foreground mt-1">Preencha seus dados, escolha o serviço desejado e envie suas informações para iniciarmos o processo de contratação.</p>
        </div>

        <div className="flex items-center gap-1 mb-6">
          {STEPS.map(s => (
            <div key={s.id} className="flex items-center gap-1 flex-1">
              <div
                className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium shrink-0 ${s.id <= step ? 'text-white' : 'bg-muted text-muted-foreground'}`}
                style={s.id <= step ? { backgroundColor: 'var(--primary, #DC2626)' } : {}}
              >
                {s.id < step ? <CheckCircle className="h-3.5 w-3.5" /> : <s.icon className="h-3.5 w-3.5" />}
              </div>
              <span className={`text-[11px] hidden sm:block ${s.id <= step ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>{s.label}</span>
              {s.id < 4 && <div className="h-0.5 flex-1 rounded bg-muted" />}
            </div>
          ))}
        </div>

        <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
          {step === 1 && (
            <div className="space-y-4">
              <h2 className="font-heading font-semibold text-foreground">Dados da empresa</h2>
              <div className="flex gap-2">
                {[{ id: 'pj', label: 'Pessoa jurídica' }, { id: 'pf', label: 'Pessoa física' }].map(o => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => update('personType', o.id)}
                    className={`flex-1 rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${form.personType === o.id ? 'border-primary bg-primary/5 text-foreground' : 'border-border text-muted-foreground'}`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              {form.personType === 'pj' && (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label>CNPJ *</Label>
                      <Input value={form.cnpj} onChange={e => update('cnpj', maskCNPJ(e.target.value))} placeholder="00.000.000/0001-00" inputMode="numeric" />
                      <FieldError message={errors.cnpj} />
                    </div>
                    <div className="space-y-1.5"><Label>Razão social</Label><Input value={form.company_name} onChange={e => update('company_name', e.target.value)} /></div>
                    <div className="space-y-1.5"><Label>Nome fantasia</Label><Input value={form.trade_name} onChange={e => update('trade_name', e.target.value)} /></div>
                    <div className="space-y-1.5"><Label>Inscrição estadual (opcional)</Label><Input value={form.state_registration} onChange={e => update('state_registration', e.target.value)} /></div>
                  </div>
                </>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5"><Label>CEP</Label><Input value={form.zip_code} onChange={e => update('zip_code', maskCEP(e.target.value))} placeholder="01000-000" inputMode="numeric" /><FieldError message={errors.zip_code} /></div>
                <div className="space-y-1.5"><Label>Cidade</Label><Input value={form.city} onChange={e => update('city', e.target.value)} /></div>
                <div className="space-y-1.5 sm:col-span-2"><Label>Endereço</Label><Input value={form.address} onChange={e => update('address', e.target.value)} /></div>
                <div className="space-y-1.5"><Label>Número</Label><Input value={form.number} onChange={e => update('number', e.target.value)} /></div>
                <div className="space-y-1.5"><Label>Complemento</Label><Input value={form.complement} onChange={e => update('complement', e.target.value)} /></div>
                <div className="space-y-1.5"><Label>Bairro</Label><Input value={form.neighborhood} onChange={e => update('neighborhood', e.target.value)} /></div>
                <div className="space-y-1.5"><Label>Estado</Label><Input value={form.state} onChange={e => update('state', e.target.value)} placeholder="SP" maxLength={2} /></div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <h2 className="font-heading font-semibold text-foreground">Responsável pela contratação</h2>
              <div className="space-y-1.5"><Label>Nome completo *</Label><Input value={form.full_name} onChange={e => update('full_name', e.target.value)} /><FieldError message={errors.full_name} /></div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5"><Label>CPF {form.personType === 'pf' ? '*' : '(opcional)'}</Label><Input value={form.cpf} onChange={e => update('cpf', maskCPF(e.target.value))} placeholder="000.000.000-00" inputMode="numeric" /><FieldError message={errors.cpf} /></div>
                <div className="space-y-1.5"><Label>Cargo ou função</Label><Input value={form.role} onChange={e => update('role', e.target.value)} /></div>
                <div className="space-y-1.5"><Label>Telefone/WhatsApp *</Label><Input value={form.phone} onChange={e => update('phone', maskPhone(e.target.value))} placeholder="(11) 99999-9999" inputMode="tel" /><FieldError message={errors.phone} /></div>
                <div className="space-y-1.5"><Label>E-mail *</Label><Input type="email" value={form.email} onChange={e => update('email', e.target.value)} placeholder="voce@email.com" /><FieldError message={errors.email} /></div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <h2 className="font-heading font-semibold text-foreground">Qual serviço deseja contratar? *</h2>
              <div className="space-y-1.5">
                <Select value={form.service} onValueChange={v => update('service', v)}>
                  <SelectTrigger><SelectValue placeholder="Selecione o serviço" /></SelectTrigger>
                  <SelectContent>
                    {LEAD_SERVICES.map(s => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.label}{s.highlight ? ' ★' : ''} — {s.desc}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError message={errors.service} />
              </div>
              {form.service === 'outro' && (
                <div className="space-y-1.5">
                  <Label>Descreva o serviço desejado *</Label>
                  <Textarea value={form.service_other} onChange={e => update('service_other', e.target.value)} rows={3} />
                  <FieldError message={errors.service_other} />
                </div>
              )}
              <div className="space-y-1.5">
                <Label>Observações (opcional)</Label>
                <Textarea value={form.notes} onChange={e => update('notes', e.target.value)} rows={2} />
              </div>
              <div className="space-y-1.5">
                <Label>Periodicidade desejada *</Label>
                <Select value={form.billing_period} onValueChange={v => update('billing_period', v)}>
                  <SelectTrigger><SelectValue placeholder="Selecione a periodicidade" /></SelectTrigger>
                  <SelectContent>
                    {LEAD_BILLING_PERIODS.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError message={errors.billing_period} />
                <p className="text-xs text-muted-foreground">Preferência para a proposta — sem cobrança aqui.</p>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <h2 className="font-heading font-semibold text-foreground">Revisão</h2>
              <dl className="rounded-xl bg-muted/50 p-4 space-y-1.5 text-sm">
                <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Serviço</dt><dd className="font-medium text-right">{serviceLabel}{form.service === 'outro' ? `: ${form.service_other}` : ''}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Responsável</dt><dd className="font-medium text-right">{form.full_name}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Periodicidade</dt><dd className="font-medium text-right">{leadBillingLabel(form.billing_period)}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Contato</dt><dd className="font-medium text-right">{form.phone} • {form.email}</dd></div>
                {(form.company_name || form.cnpj) && (
                  <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Empresa</dt><dd className="font-medium text-right">{form.company_name || form.cnpj}</dd></div>
                )}
              </dl>
              <label className="flex items-start gap-2.5 rounded-xl border border-border p-3 cursor-pointer text-sm">
                <Checkbox checked={form.consent} onCheckedChange={v => update('consent', !!v)} className="mt-0.5" />
                <span className="text-muted-foreground">
                  Estou ciente de que meus dados serão usados para contato e elaboração da proposta/contrato, conforme a <Link to="/privacidade" className="text-primary hover:underline">política de privacidade</Link>.
                </span>
              </label>
              <FieldError message={errors.consent} />
            </div>
          )}

          {step < 4 ? (
            <div className="flex gap-3 mt-6">
              {step > 1 && <Button variant="outline" className="flex-1" onClick={() => setStep(s => s - 1)}><ArrowLeft className="h-4 w-4" /> Voltar</Button>}
              <Button className="flex-1" onClick={handleNext}>Continuar <ArrowRight className="h-4 w-4" /></Button>
            </div>
          ) : (
            <div className="flex gap-3 mt-6">
              <Button variant="outline" className="flex-1" onClick={() => setStep(3)} disabled={sending}><ArrowLeft className="h-4 w-4" /> Voltar</Button>
              <Button className="flex-1" onClick={handleSubmit} disabled={sending}>
                {sending ? <><Loader2 className="h-4 w-4 animate-spin" /> Enviando...</> : 'Enviar dados para contratação'}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
