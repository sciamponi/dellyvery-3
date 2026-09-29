import { Outlet, Navigate, useLocation } from 'react-router-dom';
import { useSupabaseAuth } from '@/lib/SupabaseAuthContext';
import { shouldAllowProtected } from '@/lib/routeGuard';

const DefaultFallback = () => (
  <div className="fixed inset-0 flex items-center justify-center">
    <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
  </div>
);

export default function ProtectedRoute({ fallback = <DefaultFallback /> }) {
  // Gate exclusivo Supabase: sessão + usuário do SupabaseAuthContext.
  const { configured: sbConfigured, user: sbUser, loading: sbLoading } = useSupabaseAuth();
  const location = useLocation();

  // While session is being validated, show spinner (protected routes only)
  if (sbLoading) {
    return fallback;
  }

  // No valid session → redirect to login
  if (!shouldAllowProtected({ base44Authenticated: false, sbConfigured, sbUser })) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}