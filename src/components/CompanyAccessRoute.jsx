import { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { supabase } from '@/api/supabaseClient';
import { getCompanyActiveAccess } from '@/api/company';
import { getPlatformAdminAccess } from '@/api/plans';
import { getResellerAccess } from '@/api/resellerAccess';
import { getMyResellerClientAccess } from '@/api/resellerClients';
import { useSupabaseAuth } from '@/lib/SupabaseAuthContext';
import {
  COMPANY_ACCESS_STATUS,
  readCompanyActiveAccess,
  resolveCompanyAccess,
  shouldRenderCompanyPanel,
} from '@/lib/companyAccess';

function Spinner() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-border border-t-primary" />
    </div>
  );
}

function RetryPanel({ message, onRetry }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
      <button
        type="button"
        className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        onClick={onRetry}
      >
        Tentar de novo
      </button>
    </div>
  );
}

export default function CompanyAccessRoute() {
  const location = useLocation();
  const { user, loading, currentCompany, refresh } = useSupabaseAuth();
  const [state, setState] = useState({ loading: true, status: 'checking' });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      if (loading) return;
      if (!user) {
        if (!cancelled) setState({ loading: false, status: 'no-user' });
        return;
      }

      if (currentCompany?.id) {
        let active;
        try {
          active = await readCompanyActiveAccess(
            () => getCompanyActiveAccess(supabase, currentCompany.id),
          );
        } catch {
          if (!cancelled) {
            setState({ loading: false, status: COMPANY_ACCESS_STATUS.ACCESS_ERROR });
          }
          return;
        }
        if (cancelled) return;
        if (active) {
          setState({ loading: false, status: COMPANY_ACCESS_STATUS.ACTIVE });
          return;
        }

        try {
          const [adminAccess, resellerAccess] = await Promise.all([
            getPlatformAdminAccess(supabase, user.id),
            getResellerAccess(supabase, user.id),
          ]);
          if (cancelled) return;
          setState({
            loading: false,
            status: resolveCompanyAccess({
              hasCompany: true,
              companyActive: false,
              adminStatus: adminAccess?.status,
              resellerStatus: resellerAccess?.status,
            }),
          });
        } catch {
          if (!cancelled) {
            setState({ loading: false, status: COMPANY_ACCESS_STATUS.ACCESS_ERROR });
          }
        }
        return;
      }

      try {
        const [adminAccess, resellerAccess, clientResult] = await Promise.all([
          getPlatformAdminAccess(supabase, user.id),
          getResellerAccess(supabase, user.id),
          getMyResellerClientAccess(supabase)
            .then((access) => ({ access, error: null }))
            .catch((error) => ({ access: null, error })),
        ]);
        if (cancelled) return;

        const status = resolveCompanyAccess({
          adminStatus: adminAccess?.status,
          resellerStatus: resellerAccess?.status,
          clientStatus: clientResult.access?.status || null,
        });

        if (status === COMPANY_ACCESS_STATUS.NO_COMPANY && clientResult.error) {
          setState({ loading: false, status: COMPANY_ACCESS_STATUS.ACCESS_ERROR });
          return;
        }

        setState({ loading: false, status });
      } catch {
        if (!cancelled) setState({ loading: false, status: COMPANY_ACCESS_STATUS.ACCESS_ERROR });
      }
    };

    check();
    return () => { cancelled = true; };
  }, [loading, user, currentCompany?.id, refresh, retry]);

  if (loading || state.loading) return <Spinner />;
  if (state.status === COMPANY_ACCESS_STATUS.NO_USER) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (state.status === COMPANY_ACCESS_STATUS.MASTER) return <Navigate to="/master" replace />;
  if (state.status === COMPANY_ACCESS_STATUS.RESELLER) return <Navigate to="/revenda" replace />;
  if (state.status === COMPANY_ACCESS_STATUS.PENDING) {
    return <Navigate to="/aguardando-ativacao" replace />;
  }
  if (state.status === COMPANY_ACCESS_STATUS.EXPIRED) {
    return <Navigate to="/acesso-expirado" replace />;
  }
  if (state.status === COMPANY_ACCESS_STATUS.NO_COMPANY) {
    return <Navigate to="/criar-restaurante" replace />;
  }
  if (state.status === COMPANY_ACCESS_STATUS.MISSING_COMPANY) {
    return (
      <RetryPanel
        message="Preparando o acesso da sua empresa..."
        onRetry={async () => {
          setState({ loading: true, status: 'checking' });
          await refresh();
          setRetry((value) => value + 1);
        }}
      />
    );
  }
  if (!shouldRenderCompanyPanel(state.status)) {
    return (
      <RetryPanel
        message="Não foi possível verificar seu acesso. Tente novamente."
        onRetry={() => {
          setState({ loading: true, status: 'checking' });
          setRetry((value) => value + 1);
        }}
      />
    );
  }

  return <Outlet />;
}
