import { Outlet, useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { supabase } from '@/api/supabaseClient';
import { useSupabaseAuth } from '@/lib/SupabaseAuthContext';
import { isPlatformAdmin } from '@/api/plans';
import { Button } from '@/components/ui/button';
import MasterLogin from '@/pages/MasterLogin';
import { ShieldAlert } from 'lucide-react';

// Gate exclusivo das rotas /master/*: sessão + PLATFORM_ADMIN.
// Sem sessão -> login dedicado (com retorno à rota solicitada).
// Com sessão sem permissão -> acesso restrito (sem entrar no painel).
// A autorização do banco/RLS continua valendo; o frontend não basta sozinho.
export default function MasterRoute() {
  const location = useLocation();
  const { user: sbUser, loading: sbLoading, signOut } = useSupabaseAuth();
  const [checking, setChecking] = useState(false);
  const [allowed, setAllowed] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let active = true;
    if (sbLoading) return undefined;
    if (!sbUser) {
      setAllowed(null);
      setLoadError('');
      return undefined;
    }
    setChecking(true);
    setLoadError('');
    isPlatformAdmin(supabase, sbUser.id)
      .then((ok) => { if (active) setAllowed(!!ok); })
      .catch((err) => {
        if (!active) return;
        // Falha de rede/sessão não é "sem permissão": distingue para a UI.
        const msg = `${err?.message || ''}`.toLowerCase();
        if (msg.includes('failed to fetch') || msg.includes('fetch failed') || msg.includes('network')) {
          setLoadError('network');
        } else {
          setAllowed(false);
        }
      })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [sbLoading, sbUser?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSwitchAccount = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  };

  if (sbLoading || (sbUser && (checking || (allowed === null && !loadError)))) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-6 h-6 border-[3px] border-slate-200 border-t-slate-800 rounded-full animate-spin" />
      </div>
    );
  }

  if (!sbUser) {
    return <MasterLogin returnTo={location.pathname} />;
  }

  if (loadError === 'network') {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center max-w-xs">
          <ShieldAlert className="h-8 w-8 text-amber-500 mx-auto mb-2" />
          <h2 className="font-heading text-base font-bold text-foreground">Sem conexão</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Não foi possível verificar sua permissão. Verifique se o Supabase local está ativo.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => { setLoadError(''); setAllowed(null); setChecking(true); }}
          >
            Tentar de novo
          </Button>
        </div>
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center max-w-xs">
          <ShieldAlert className="h-8 w-8 text-destructive mx-auto mb-2" />
          <h2 className="font-heading text-base font-bold text-foreground">Acesso restrito</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Esta conta não tem permissão de administração da plataforma.
          </p>
          <div className="flex gap-2 justify-center mt-3">
            <Button variant="outline" size="sm" disabled={signingOut} onClick={handleSwitchAccount}>
              {signingOut ? 'Saindo...' : 'Trocar de conta'}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return <Outlet />;
}
