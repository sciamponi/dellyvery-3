import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/api/supabaseClient';
import { getSession, signUpRestaurant, provisionCompanyForCurrentUser } from '@/api/supabaseAuth';
import { updateCompany as sbUpdateCompany } from '@/api/company';
import { useSupabaseAuth } from '@/lib/SupabaseAuthContext';
import { getMyResellerClientAccess } from '@/api/resellerClients';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, ArrowLeft, Check } from 'lucide-react';

const baseBenefits = [
  'Cardápio digital ilimitado',
  'Pedidos em tempo real',
  'Cancele quando quiser',
];

export default function CreateRestaurant() {
  const { toast } = useToast();
  const navigate = useNavigate();
  // Onboarding Supabase-only: Auth + RPC create_company_with_owner().
  const { refresh: refreshSb } = useSupabaseAuth();
  const [authed, setAuthed] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [trialDays, setTrialDays] = useState(7);
  const [trialIsFree, setTrialIsFree] = useState(false);
  const [form, setForm] = useState({
    restaurantName: '', responsibleName: '', whatsapp: '',
    email: '', password: '', confirmPassword: '', acceptTerms: false,
  });

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const sess = await getSession(supabase).catch(() => null);
      if (cancelled) return;
      setAuthed(!!sess);
      if (!sess?.user) return;
      const access = await getMyResellerClientAccess(supabase).catch(() => null);
      if (cancelled || !access) return;
      navigate(
        access.status === 'active'
          ? '/dashboard'
          : access.status === 'pending' ? '/aguardando-ativacao' : '/acesso-expirado',
        { replace: true },
      );
    };
    check();
    return () => { cancelled = true; };
  }, [navigate]);

  useEffect(() => {
    let cancelled = false;
    const loadPlan = async () => {
      try {
        const { data } = await supabase
          .from('plans')
          .select('trial_days, is_free')
          .eq('slug', 'solo')
          .maybeSingle();
        if (cancelled || !data) return;
        setTrialDays(Number(data.trial_days ?? 7));
        setTrialIsFree(!!data.is_free);
      } catch {
        // Mantem o texto padrao; a criacao da empresa nao depende desta leitura.
      }
    };
    loadPlan();
    return () => { cancelled = true; };
  }, []);

  const trialBenefit = trialIsFree
    ? 'Plano gratuito, sem cartão'
    : trialDays > 0
      ? `${trialDays} dias grátis, sem cartão`
      : 'Teste sem período grátis, sem cartão';
  const trialHeadline = trialIsFree
    ? 'Comece gratuitamente'
    : trialDays > 0
      ? `${trialDays} dias grátis`
      : 'Teste o sistema';
  const trialSubtitle = trialIsFree
    ? 'Plano gratuito. Sem cartão de crédito.'
    : trialDays > 0
      ? `${trialDays} dias grátis. Sem cartão de crédito.`
      : 'Teste sem período grátis. Sem cartão de crédito.';
  const benefits = [trialBenefit, ...baseBenefits];

  const update = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

  const validate = () => {
    if (!form.restaurantName.trim() || !form.whatsapp.trim() || !form.email.trim()) {
      setError('Preencha todos os campos obrigatórios'); return false;
    }
    if (!authed) {
      if (form.password.length < 6) { setError('Senha deve ter no mínimo 6 caracteres'); return false; }
      if (form.password !== form.confirmPassword) { setError('As senhas não conferem'); return false; }
      if (!form.acceptTerms) { setError('Você precisa aceitar os termos'); return false; }
    }
    return true;
  };

  // FASE 5.1: criação via função SECURITY DEFINER (sem INSERT direto
  // em companies/company_members pelo frontend). Cria company + OWNER +
  // subscription Solo + order_seq + settings + themes.
  // Defaults operacionais equivalentes aos do fluxo antigo.
  const applyCompanyDefaults = async (companyId) => {
    try {
      await sbUpdateCompany(supabase, companyId, {
        slogan: 'Pedidos online • Controle completo',
        primary_color: '#DC2626',
        accent_color: '#F97316',
        is_open: true,
        minimum_order: 0,
        delivery_fee: 0,
        estimated_delivery_time: 30,
      });
    } catch {
      // Empresa já criada; defaults cosméticos não bloqueiam o onboarding.
    }
  };

  const createCompany = async () => {
    setLoading(true);
    setError('');
    try {
      // Sessão existente NÃO refaz signup (daria "User already registered").
      // Reaproveita a sessão e só provisiona.
      const existing = await getSession(supabase).catch(() => null);
      const payload = {
        email: form.email,
        companyName: form.restaurantName,
        phone: form.whatsapp,
      };
      const result = existing?.user
        ? await provisionCompanyForCurrentUser(supabase, payload)
        : await signUpRestaurant(supabase, { ...payload, password: form.password });
      if (result.created !== false && result.companyId) {
        await applyCompanyDefaults(result.companyId);
      }
      await refreshSb();
      // Sem sessão (Confirm Email ON): conta criada, falta clicar no link.
      const sess = await getSession(supabase).catch(() => null);
      if (!sess) {
        toast({ title: 'Conta criada!', description: 'Verifique seu email para ativar e entre.' });
        navigate('/login', { replace: true });
        return;
      }
      toast({
        title: result.created === false ? 'Bem-vindo de volta!' : 'Restaurante criado!',
        description: result.created === false
          ? 'Selecionamos sua empresa existente.'
          : trialIsFree
            ? 'Seu plano gratuito está ativo.'
            : trialDays > 0
              ? `Seu trial de ${trialDays} dias começou.`
              : 'Seu teste começou.',
      });
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err?.message || 'Erro ao criar restaurante');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!validate()) return;

    if (authed) {
      await createCompany();
    } else {
      // Cadastro + empresa em uma etapa (confirmação por link, sem OTP).
      if (form.password.length < 6) { setError('Senha deve ter no mínimo 6 caracteres'); return; }
      if (form.password !== form.confirmPassword) { setError('As senhas não conferem'); return; }
      if (!form.acceptTerms) { setError('Você precisa aceitar os termos'); return; }
      await createCompany();
    }
  };

  if (authed === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-border border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  // Registration / company creation form
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 py-10">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary font-heading text-2xl font-bold text-primary-foreground">H</div>
          <h1 className="font-heading text-2xl font-bold text-foreground">{trialHeadline}</h1>
          <p className="text-sm text-muted-foreground mt-1">{trialSubtitle}</p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="mb-6 grid grid-cols-2 gap-2">
            {benefits.map((b, i) => (
              <div key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Check className="h-3.5 w-3.5 text-green-600 shrink-0" /> {b}
              </div>
            ))}
          </div>

          {error && <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">{error}</div>}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Nome do restaurante *</Label>
              <Input value={form.restaurantName} onChange={e => update('restaurantName', e.target.value)} placeholder="Ex: Meu Restaurante" required />
            </div>
            <div className="space-y-2">
              <Label>Seu nome *</Label>
              <Input value={form.responsibleName} onChange={e => update('responsibleName', e.target.value)} placeholder="Responsável" required />
            </div>
            <div className="space-y-2">
              <Label>WhatsApp *</Label>
              <Input value={form.whatsapp} onChange={e => update('whatsapp', e.target.value)} placeholder="(11) 99999-9999" required />
            </div>
            <div className="space-y-2">
              <Label>Email *</Label>
              <Input type="email" value={form.email} onChange={e => update('email', e.target.value)} placeholder="voce@email.com" required />
            </div>
            {!authed && (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Senha *</Label>
                    <Input type="password" value={form.password} onChange={e => update('password', e.target.value)} placeholder="••••••••" required />
                  </div>
                  <div className="space-y-2">
                    <Label>Confirmar *</Label>
                    <Input type="password" value={form.confirmPassword} onChange={e => update('confirmPassword', e.target.value)} placeholder="••••••••" required />
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <Checkbox checked={form.acceptTerms} onCheckedChange={v => update('acceptTerms', v)} className="mt-0.5" />
                  <Label className="text-sm font-normal text-muted-foreground cursor-pointer">
                    Aceito os <a href="#" className="text-primary hover:underline">termos de uso</a> e a <a href="#" className="text-primary hover:underline">política de privacidade</a>
                  </Label>
                </div>
              </>
            )}
            <Button type="submit" disabled={loading} className="w-full h-12 bg-primary hover:bg-primary/90">
              {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Criando...</> : 'Criar meu restaurante'}
            </Button>
          </form>

          {!authed && (
            <div className="mt-6 text-center text-sm text-muted-foreground">
              Já tem uma conta? <Link to="/login" className="text-primary font-medium hover:underline">Entrar</Link>
            </div>
          )}
        </div>

        <div className="mt-6 text-center">
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            <ArrowLeft className="h-4 w-4" /> Voltar ao início
          </Link>
        </div>
      </div>
    </div>
  );
}