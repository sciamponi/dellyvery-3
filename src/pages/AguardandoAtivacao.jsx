import React, { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { supabase } from '@/api/supabaseClient';
import { getMyResellerClientAccess } from '@/api/resellerClients';
import { useSupabaseAuth } from '@/lib/SupabaseAuthContext';
import AuthLayout from '@/components/AuthLayout';
import { Button } from '@/components/ui/button';
import { Clock3, Loader2, LogOut, RefreshCw } from 'lucide-react';

export default function AguardandoAtivacao() {
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
        await refresh();
        navigate('/dashboard', { replace: true });
        return;
      }
      const result = await getMyResellerClientAccess(supabase);
      setAccess(result);
      if (!result) {
        navigate('/criar-restaurante', { replace: true });
        return;
      }
      if (result.status === 'active') {
        await refresh();
        navigate('/dashboard', { replace: true });
        return;
      }
      if (result.status === 'expired') {
        navigate('/acesso-expirado', { replace: true });
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
    const timer = setInterval(() => { check(); }, 15000);
    return () => clearInterval(timer);
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
    return <Navigate to="/login" replace state={{ from: '/aguardando-ativacao' }} />;
  }

  return (
    <AuthLayout
      icon={Clock3}
      title="Aguardando ativação"
      subtitle="Seu cadastro foi recebido"
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
            O acesso de <strong className="text-foreground">{access?.client_name || 'sua empresa'}</strong> precisa
            ser ativado por <strong className="text-foreground">{access?.reseller_name || 'seu revendedor'}</strong>.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Esta página verifica automaticamente. Você pode fechar e voltar depois.
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
