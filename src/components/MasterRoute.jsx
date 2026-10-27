import { Outlet, useLocation } from 'react-router-dom';
import { useState, useEffect, useReducer } from 'react';
import { supabase } from '@/api/supabaseClient';
import { useSupabaseAuth } from '@/lib/SupabaseAuthContext';
import { getPlatformAdminAccess } from '@/api/plans';
import {
  classifyMasterAccessError,
  createMasterGateState,
  masterGateReducer,
} from '@/lib/masterGate';
import { Button } from '@/components/ui/button';
import MasterLogin from '@/pages/MasterLogin';
import { AlertTriangle, ShieldAlert } from 'lucide-react';

// Gate exclusivo das rotas /master/*: sessão + PLATFORM_ADMIN.
// Sem sessão -> login dedicado (com retorno à rota solicitada).
// Com sessão sem permissão -> acesso restrito (sem entrar no painel).
// A autorização do banco/RLS continua valendo; o frontend não basta sozinho.
export default function MasterRoute() {
  const location = useLocation();
  const { user: sbUser, loading: sbLoading, signOut } = useSupabaseAuth();
  const [gate, dispatch] = useReducer(masterGateReducer, undefined, createMasterGateState);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let active = true;
    if (sbLoading) return undefined;
    if (!sbUser) {
      dispatch({ type: 'check:reset' });
      return undefined;
    }
    dispatch({ type: 'check:start' });
    getPlatformAdminAccess(supabase, sbUser.id)
      .then((access) => {
        if (!active) return;
        dispatch({
          type: 'check:result',
          status: access.status,
          error: access.error?.message || '',
        });
      })
      .catch((err) => {
        if (!active) return;
        // Falha de infraestrutura não é "sem permissão": distingue para a UI.
        dispatch({
          type: 'check:result',
          status: classifyMasterAccessError(err),
          error: err?.message || '',
        });
      });
    return () => { active = false; };
  }, [sbLoading, sbUser?.id, gate.attempt]);

  const handleSwitchAccount = async () => {
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
    return <MasterLogin returnTo={location.pathname} />;
  }

  if (gate.status === 'network' || gate.status === 'error') {
    const network = gate.status === 'network';
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center max-w-xs">
          {network
            ? <ShieldAlert className="h-8 w-8 text-amber-500 mx-auto mb-2" />
            : <AlertTriangle className="h-8 w-8 text-amber-500 mx-auto mb-2" />}
          <h2 className="font-heading text-base font-bold text-foreground">
            {network ? 'Sem conexão' : 'Não foi possível verificar o acesso'}
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            {network
              ? 'Não foi possível consultar sua permissão. Verifique a conexão e tente de novo.'
              : 'A consulta de permissão falhou. Tente novamente; se persistir, verifique o Supabase.'}
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

  if (gate.status !== 'allowed') {
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
