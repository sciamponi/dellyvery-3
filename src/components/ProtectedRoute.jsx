import { useEffect } from 'react';
import { Outlet, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';

const DefaultFallback = () => (
  <div className="fixed inset-0 flex items-center justify-center">
    <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
  </div>
);

export default function ProtectedRoute({ fallback = <DefaultFallback /> }) {
  const { isAuthenticated, isLoadingAuth, authChecked, authError, checkUserAuth } = useAuth();
  const location = useLocation();

  // Validate session ONLY when a protected route is accessed
  useEffect(() => {
    if (!authChecked && !isLoadingAuth && !authError) {
      checkUserAuth();
    }
  }, [authChecked, isLoadingAuth, checkUserAuth, authError]);

  // Platform-level: user has a valid token but isn't registered for this app
  if (authError?.type === 'user_not_registered') {
    return <UserNotRegisteredError />;
  }

  // While session is being validated, show spinner (protected routes only)
  if (isLoadingAuth || !authChecked) {
    return fallback;
  }

  // No valid session → redirect to login, preserving the originally requested path
  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}