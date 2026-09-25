import { useEffect } from 'react';
import { Outlet, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { useSupabaseAuth } from '@/lib/SupabaseAuthContext';
import { shouldAllowProtected } from '@/lib/routeGuard';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';

const DefaultFallback = () => (
  <div className="fixed inset-0 flex items-center justify-center">
    <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
  </div>
);

export default function ProtectedRoute({ fallback = <DefaultFallback /> }) {
  const { isAuthenticated, isLoadingAuth, authChecked, authError, checkUserAuth } = useAuth();
  // FASE 5.1: sessão Supabase também autoriza (transição; Base44 intacto).
  const { configured: sbConfigured, user: sbUser, loading: sbLoading } = useSupabaseAuth();
  const location = useLocation();

  const sbAuthenticated = sbConfigured && !!sbUser;

  // Validate session ONLY when a protected route is accessed (fluxo Base44)
  useEffect(() => {
    if (sbAuthenticated) return;
    if (!authChecked && !isLoadingAuth && !authError) {
      checkUserAuth();
    }
  }, [authChecked, isLoadingAuth, checkUserAuth, authError, sbAuthenticated]);

  // Platform-level: user has a valid token but isn't registered for this app
  if (!sbAuthenticated && authError?.type === 'user_not_registered') {
    return <UserNotRegisteredError />;
  }

  // While session is being validated, show spinner (protected routes only)
  if (sbLoading || isLoadingAuth || (!sbAuthenticated && !authChecked)) {
    return fallback;
  }

  // No valid session (nem Base44, nem Supabase) → redirect to login
  if (!shouldAllowProtected({ base44Authenticated: isAuthenticated, sbConfigured, sbUser })) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}