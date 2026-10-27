import { Outlet, Navigate, useLocation } from 'react-router-dom';
import { useState, useEffect, useReducer } from 'react';
import { supabase } from '@/api/supabaseClient';
import { useSupabaseAuth } from '@/lib/SupabaseAuthContext';
import { getResellerAccess } from '@/api/resellerAccess';
import {
  classifyResellerAccessError,
  createResellerGateState,
  resellerGateReducer,
} from '@/lib/resellerGate';
import { Button } from '@/components/ui/button';
import { AlertTriangle, PauseCircle, ShieldAlert, LogOut } from 'lucide-react';

// Gate exclusivo de /revenda: sessao + vinculo ativo em resellers.
// A RLS continua sendo a autoridade do backend; este gate apenas evita
// renderizar a area para quem nao tem acesso. Suspensao e revogacao sao
// checadas no banco a cada carregamento.
export default function ResellerRoute() {
  const location = useLocation();
  const { user: sbUser, loading: sbLoading, signOut } = useSupabaseAuth();
  const [gate, dispatch] = useReducer(resellerGateReducer, undefined, createResellerGateState);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let active = true;
    if (sbLoading) return undefined;
    if (!sbUser) {
      dispatch({ type: 'check:reset' });
      return undefined;
    }
    dispatch({ type: 'check:start' });
    getResellerAccess(supabase, sbUser.id)
      .then((access) => {
        if (!active) return;
        dispatch({
          type: 'check:result',
          status: access.status,
          error: access.error?.message || '',
          reseller: access.reseller,
        });
      })
      .catch((err) => {
        if (!active) return;
        dispatch({
          type: 'check:result',
          status: classifyResellerAccessError(err),
          error: err?.message || '',
        });
      });
    return () => { active = false; };
  }, [sbLoading, sbUser?.id, gate.attempt]);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  };

  if (sbLoading || (sbUser && (gate.status === 'idle' || gate.status === 'checking'))) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-6 h-6 border-[3px] border-slate-200 border-t-slate-800 rounded-full animate-spin" />
      </div>
    );
  }

  if (!sbUser) {
    const target = `${location.pathname}${location.search || ''}`;
    return (
      <Navigate
        to={`/login?next=${encodeURIComponent(target)}`}
        replace
        state={{ from: target }}
      />
    );
  }

  if (gate.status === 'network' || gate.status === 'error') {
    const network = gate.status === 'network';
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center max-w-xs">
          <AlertTriangle className="h-8 w-8 text-amber-500 mx-auto mb-2" />
          <h2 className="font-heading text-base font-bold text-foreground">
            {network ? 'Sem conexao' : 'Nao foi possivel verificar o acesso'}
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            {network
              ? 'Nao foi possivel consultar seu vinculo de revenda. Verifique a conexao e tente de novo.'
              : 'A consulta de acesso falhou. Tente novamente; se persistir, verifique o Supabase.'}
          </p>
          {!network && gate.error && (
            <p className="mt-2 text-[11px] text-muted-foreground break-words">{gate.error}</p>
          )}
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => dispatch({ type: 'check:retry' })}
          >
            Tentar de novo
          </Button>
        </div>
      </div>
    );
  }

  if (gate.status === 'suspended') {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center max-w-xs">
          <PauseCircle className="h-8 w-8 text-amber-500 mx-auto mb-2" />
          <h2 className="font-heading text-base font-bold text-foreground">Acesso suspenso</h2>
          <p className="text-xs text-muted-foreground mt-1">
            O acesso deste revendedor esta suspenso. Fale com o administrador para reativar.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            disabled={signingOut}
            onClick={handleSignOut}
          >
            {signingOut ? 'Saindo...' : 'Sair'}
          </Button>
        </div>
      </div>
    );
  }

  if (gate.status !== 'allowed') {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center max-w-xs">
          <ShieldAlert className="h-8 w-8 text-destructive mx-auto mb-2" />
          <h2 className="font-heading text-base font-bold text-foreground">Acesso restrito</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Esta conta nao possui um vinculo ativo de revenda.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            disabled={signingOut}
            onClick={handleSignOut}
          >
            {signingOut ? 'Saindo...' : <><LogOut className="h-3.5 w-3.5 mr-1.5" /> Trocar de conta</>}
          </Button>
        </div>
      </div>
    );
  }

  return <Outlet context={{ reseller: gate.reseller }} />;
}
