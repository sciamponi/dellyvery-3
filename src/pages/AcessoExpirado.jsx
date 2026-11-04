import React, { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { supabase } from '@/api/supabaseClient';
import { getMyResellerClientAccess } from '@/api/resellerClients';
import { useSupabaseAuth } from '@/lib/SupabaseAuthContext';
import AuthLayout from '@/components/AuthLayout';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Loader2, LogOut, RefreshCw } from 'lucide-react';

function formatDate(value) {
  if (!value) return null;
  return new Date(value).toLocaleDateString('pt-BR');
}

export default function AcessoExpirado() {
  const navigate = useNavigate();
  const { user, loading: authLoading, currentCompany, refresh, signOut } = useSupabaseAuth();
  const [access, setAccess] = useState(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');

  const check = async (manual = false) => {
    if (manual) setChecking(true);
    setError('');
    try {
      if (currentCompany?.id) {
        const { data, error: rpcError } = await supabase.rpc('company_has_active_access', {
          p_company_id: currentCompany.id,
        });
        if (rpcError) throw rpcError;
        if (data === true) {
          navigate('/dashboard', { replace: true });
          return;
        }
      }
      const result = await getMyResellerClientAccess(supabase);
      setAccess(result);
      if (!result) return;
      if (result.status === 'pending') {
        navigate('/aguardando-ativacao', { replace: true });
        return;
      }
      if (result.status === 'active') {
        await refresh();
        navigate('/dashboard', { replace: true });
      }
    } catch (err) {
      setError(err?.message || 'Não foi possível verificar o acesso');
    } finally {
      setLoading(false);
      setChecking(false);
    }
  };

  useEffect(() => {
    if (authLoading) return;
    if (!user) return;
    check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user?.id, currentCompany?.id]);

  const logout = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: '/acesso-expirado' }} />;
  }

  const expires = formatDate(access?.access_expires_at);
  return (
    <AuthLayout
      icon={AlertTriangle}
      title="Acesso suspenso"
      subtitle="Sua assinatura venceu"
      footer={(
        <button type="button" onClick={logout} className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
          <LogOut className="h-4 w-4" /> Sair da conta
        </button>
      )}
    >
      {loading ? (
        <div className="flex justify-center py-6"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            O acesso de <strong className="text-foreground">{access?.company_name || 'sua empresa'}</strong>
            {expires ? ` venceu em ${expires}` : ' está vencido'}.
          </p>
          {access?.plan_name && (
            <p className="mt-1 text-sm text-muted-foreground">Plano: <strong className="text-foreground">{access.plan_name}</strong></p>
          )}
          <p className="mt-3 text-sm text-muted-foreground">
            Fale com <strong className="text-foreground">{access?.reseller_name || 'seu revendedor'}</strong> para
            renovar. Seus dados permanecem salvos.
          </p>
          {error && <div className="mt-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
          <Button className="mt-5 w-full" variant="outline" onClick={() => check(true)} disabled={checking}>
            <RefreshCw className={`h-4 w-4 ${checking ? 'animate-spin' : ''}`} /> Verificar novamente
          </Button>
        </>
      )}
    </AuthLayout>
  );
}
