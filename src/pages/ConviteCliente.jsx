import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/api/supabaseClient';
import {
  claimResellerClientInvite, requestResellerInviteEmailProof,
  resolveResellerClientInvite, verifyResellerInviteEmailProof,
  RESELLER_INVITE_OTP_LENGTH, isValidResellerInviteCode, sanitizeResellerInviteCode,
} from '@/api/resellerClients';
import { useSupabaseAuth } from '@/lib/SupabaseAuthContext';
import AuthLayout from '@/components/AuthLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AlertCircle, CheckCircle2, KeyRound, Link2, Loader2, LogIn, MailCheck, UserPlus,
} from 'lucide-react';

export default function ConviteCliente() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { user, loading: authLoading, refresh, signOut } = useSupabaseAuth();
  const [invite, setInvite] = useState(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);
  const [proofVerified, setProofVerified] = useState(false);
  const [code, setCode] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    resolveResellerClientInvite(supabase, token)
      .then((result) => { if (!cancelled) setInvite(result); })
      .catch((err) => { if (!cancelled) setError(err?.message || 'Convite nao encontrado'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token]);

  const claimInvite = async () => {
    setClaiming(true);
    setError('');
    try {
      await claimResellerClientInvite(supabase, token);
      await refresh();
      navigate('/aguardando-ativacao', { replace: true });
    } catch (err) {
      setError(err?.message || 'Nao foi possivel aceitar o convite');
    } finally {
      setClaiming(false);
    }
  };

  const handleRequestCode = async () => {
    setVerifying(true);
    setError('');
    setNotice('');
    try {
      await requestResellerInviteEmailProof(supabase, token);
      setVerificationSent(true);
      setProofVerified(false);
      setCode('');
      setNotice(`Enviamos um codigo para ${invite?.invited_email || 'o e-mail do convite'}. Ele expira em 1 hora.`);
    } catch (err) {
      setError(err?.message || 'Nao foi possivel enviar o codigo de confirmacao');
    } finally {
      setVerifying(false);
    }
  };

  const handleVerifyAndClaim = async () => {
    setError('');
    setNotice('');
    if (!isValidResellerInviteCode(code)) {
      setError('Informe o codigo de 8 digitos recebido por e-mail');
      return;
    }
    setVerifying(true);
    try {
      await verifyResellerInviteEmailProof(supabase, token, code);
      setProofVerified(true);
      setVerificationSent(false);
      setNotice('E-mail confirmado. Concluindo o aceite do convite...');
      await claimInvite();
    } catch (err) {
      setError(err?.message || 'Nao foi possivel confirmar o codigo');
    } finally {
      setVerifying(false);
    }
  };

  const handleSwitchAccount = async () => {
    await signOut();
    navigate(`/login?invite=${encodeURIComponent(token)}`, { replace: true });
  };

  if (loading || authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const status = invite?.status;
  const isUnavailable = status === 'expired' || status === 'revoked';

  if (!invite) {
    return (
      <AuthLayout icon={AlertCircle} title="Convite indisponivel" subtitle={error || 'Este link nao e valido.'} footer={null}>
        <p className="text-sm text-center text-muted-foreground">
          Solicite um novo convite ao revendedor responsavel pelo seu cadastro.
        </p>
        <Button className="mt-5 w-full" variant="outline" asChild>
          <Link to="/login">Ir para o login</Link>
        </Button>
      </AuthLayout>
    );
  }

  if (isUnavailable) {
    return (
      <AuthLayout
        icon={AlertCircle}
        title={status === 'expired' ? 'Convite expirado' : 'Convite revogado'}
        subtitle={`Convite de ${invite.reseller_name}`}
        footer={null}
      >
        <p className="text-sm text-center text-muted-foreground">
          Este link nao pode mais ser usado. Solicite um novo convite ao revendedor.
        </p>
        <Button className="mt-5 w-full" variant="outline" asChild>
          <Link to="/login">Ir para o login</Link>
        </Button>
      </AuthLayout>
    );
  }

  if (status === 'accepted') {
    return (
      <AuthLayout
        icon={CheckCircle2}
        title="Convite ja utilizado"
        subtitle={`Cadastro de ${invite.client_name}`}
        footer={null}
      >
        <p className="text-sm text-center text-muted-foreground">
          Se voce ja criou sua conta, entre para acompanhar a ativacao do acesso.
        </p>
        <Button className="mt-5 w-full" onClick={() => navigate(user ? '/aguardando-ativacao' : '/login')}>
          {user ? 'Ir para meu acesso' : 'Entrar'}
        </Button>
      </AuthLayout>
    );
  }

  if (!user) {
    return (
      <AuthLayout
        icon={Link2}
        title="Voce foi convidado"
        subtitle={`${invite.reseller_name} esta liberando o acesso de ${invite.client_name}`}
        footer={null}
      >
        <div className="rounded-xl bg-muted/60 p-3 text-sm text-muted-foreground">
          Use o e-mail <strong className="text-foreground">{invite.invited_email}</strong> para criar sua conta.
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          Crie sua propria senha. O acesso sera ativado pelo revendedor depois do cadastro.
        </p>
        {error && (
          <div className="mt-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
        )}
        <div className="mt-5 space-y-2">
          <Button className="w-full" asChild>
            <Link to={`/register?invite=${encodeURIComponent(token)}&email=${encodeURIComponent(invite.invited_email)}`}>
              <UserPlus className="h-4 w-4" /> Criar minha conta
            </Link>
          </Button>
          <Button className="w-full" variant="outline" asChild>
            <Link to={`/login?invite=${encodeURIComponent(token)}`}>
              <LogIn className="h-4 w-4" /> Ja tenho conta
            </Link>
          </Button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      icon={CheckCircle2}
      title="Aceitar convite"
      subtitle={`${invite.reseller_name} esta liberando o acesso de ${invite.client_name}`}
      footer={null}
    >
      <p className="text-sm text-muted-foreground">
        Confirme que sua conta usa o e-mail <strong className="text-foreground">{invite.invited_email}</strong>.
        Para comprovar a posse, enviaremos um codigo de 8 digitos para esse endereco.
      </p>

      {notice && (
        <div className="mt-4 flex items-start gap-2 rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-700">
          <MailCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}
      {error && (
        <div className="mt-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
      )}

      {proofVerified ? (
        <Button className="mt-5 w-full" onClick={claimInvite} disabled={claiming || verifying}>
          {claiming ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          {claiming ? 'Aceitando...' : 'Aceitar convite'}
        </Button>
      ) : (
        <div className="mt-5 space-y-3 rounded-xl border bg-muted/30 p-4">
          <div className="flex items-start gap-2 text-sm text-muted-foreground">
            <KeyRound className="mt-0.5 h-4 w-4 shrink-0" />
            <span>O codigo e enviado pelo servidor e so pode ser usado uma vez.</span>
          </div>

          <Button
            className="w-full"
            variant={verificationSent ? 'outline' : 'default'}
            onClick={handleRequestCode}
            disabled={verifying || claiming}
          >
            {verifying && !verificationSent ? <Loader2 className="h-4 w-4 animate-spin" /> : <MailCheck className="h-4 w-4" />}
            {verifying && !verificationSent ? 'Enviando...' : verificationSent ? 'Reenviar codigo' : 'Enviar codigo de confirmacao'}
          </Button>

          {verificationSent && (
            <div className="space-y-2">
              <Label htmlFor="invite-code">Codigo recebido</Label>
              <Input
                id="invite-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="00000000"
                maxLength={RESELLER_INVITE_OTP_LENGTH}
                value={code}
                onChange={(event) => setCode(sanitizeResellerInviteCode(event.target.value))}
                disabled={verifying || claiming}
              />
              <Button className="w-full" onClick={handleVerifyAndClaim} disabled={verifying || claiming || !isValidResellerInviteCode(code)}>
                {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                {verifying ? 'Confirmando...' : 'Confirmar codigo e aceitar'}
              </Button>
            </div>
          )}
        </div>
      )}

      <Button className="mt-2 w-full" variant="ghost" onClick={handleSwitchAccount} disabled={claiming || verifying}>
        Entrar com outro e-mail
      </Button>
    </AuthLayout>
  );
}
