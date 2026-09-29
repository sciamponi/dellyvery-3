import React, { createContext, useState, useContext } from 'react';
import { supabase } from '@/api/supabaseClient';
import { signOut as sbSignOut } from '@/api/supabaseAuth';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  // Called ONLY by ProtectedRoute when accessing a protected route.
  // Never auto-called on mount — public pages render with zero auth dependency.
  // O gate real é a sessão Supabase (SupabaseAuthContext); aqui apenas
  // marcamos como verificado sem chamada legada.
  const checkUserAuth = async () => {
    setIsAuthenticated(false);
    setAuthChecked(true);
  };

  const logout = async (shouldRedirect = true) => {
    setUser(null);
    setIsAuthenticated(false);
    setAuthChecked(false);
    setAuthError(null);
    try {
      await sbSignOut(supabase);
    } catch {
      // logout local já aplicado acima
    }
    if (shouldRedirect) window.location.href = '/login';
  };

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated,
      isLoadingAuth,
      authError,
      authChecked,
      logout,
      checkUserAuth,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};