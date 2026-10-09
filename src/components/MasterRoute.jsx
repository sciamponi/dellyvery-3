import { Outlet, useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { supabase } from '@/api/supabaseClient';
import { useSupabaseAuth } from '@/lib/SupabaseAuthContext';
import { isPlatformAdmin } from '@/api/plans';
import MasterLogin from '@/pages/MasterLogin';
import { ShieldAlert } from 'lucide-react';

// Gate exclusivo das rotas /master/*: sessão + PLATFORM_ADMIN.
// Sem sessão -> login dedicado (com retorno à rota solicitada).
// Com sessão sem permissão -> acesso restrito (sem entrar no painel).
// A autorização do banco/RLS continua valendo; o frontend não basta sozinho.
export default function MasterRoute() {
  const location = useLocation();
  const { user: sbUser, loading: sbLoading } = useSupabaseAuth();
  const [checking, setChecking] = useState(false);
  const [allowed, setAllowed] = useState(null);

  useEffect(() => {
    let active = true;
    if (sbLoading) return undefined;
    if (!sbUser) {
      setAllowed(null);
      return undefined;
    }
    setChecking(true);
    isPlatformAdmin(supabase, sbUser.id)
      .then((ok) => { if (active) setAllowed(!!ok); })
      .catch(() => { if (active) setAllowed(false); })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [sbLoading, sbUser?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (sbLoading || (sbUser && (checking || allowed === null))) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-6 h-6 border-[3px] border-slate-200 border-t-slate-800 rounded-full animate-spin" />
      </div>
    );
  }

  if (!sbUser) {
    return <MasterLogin returnTo={location.pathname} />;
  }

  if (!allowed) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center max-w-xs">
          <ShieldAlert className="h-8 w-8 text-destructive mx-auto mb-2" />
          <h2 className="font-heading text-base font-bold text-foreground">Acesso restrito</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Esta área é exclusiva da administração da plataforma.
          </p>
        </div>
      </div>
    );
  }

  return <Outlet />;
}
