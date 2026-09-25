import React, { createContext, useState, useEffect, useContext, useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '@/api/supabaseClient';
import {
  getSession,
  onAuthStateChange,
  signOut as sbSignOut,
  fetchProfile,
  fetchMemberships,
} from '@/api/supabaseAuth';
import { resolveCurrentCompany, loadSavedCompanyId, saveCompanyId } from '@/lib/companySelection';

// DELLVERY 3 — AuthContext Supabase (FASE 5.1)
// Coexiste com o AuthContext/Base44 legado (src/lib/AuthContext.jsx), que NÃO
// foi alterado. Ativo somente quando VITE_SUPABASE_URL + ANON_KEY existem;
// sem elas, expõe estado neutro (loading=false, tudo null) e nada quebra.
const SupabaseAuthContext = createContext({
  configured: false,
  user: null,
  session: null,
  loading: false,
  profile: null,
  memberships: [],
  currentCompany: null,
  currentRole: null,
  needsCompanySelection: false,
  selectCompany: () => {},
  refresh: async () => {},
  signOut: async () => {},
});

export function SupabaseAuthProvider({ children }) {
  const configured = isSupabaseConfigured();
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(configured);
  const [profile, setProfile] = useState(null);
  const [memberships, setMemberships] = useState([]);
  const [currentCompany, setCurrentCompany] = useState(null);
  const [currentRole, setCurrentRole] = useState(null);
  const [needsCompanySelection, setNeedsCompanySelection] = useState(false);

  const loadContext = useCallback(async (sess) => {
    const u = sess?.user || null;
    setUser(u);
    setSession(sess);
    if (!u) {
      setProfile(null);
      setMemberships([]);
      setCurrentCompany(null);
      setCurrentRole(null);
      setNeedsCompanySelection(false);
      return;
    }
    try {
      const [prof, members] = await Promise.all([
        fetchProfile(supabase, u.id).catch(() => null),
        fetchMemberships(supabase, u.id).catch(() => []),
      ]);
      setProfile(prof);
      setMemberships(members);
      const saved = typeof window !== 'undefined'
        ? loadSavedCompanyId(window.localStorage, u.id)
        : null;
      const resolved = resolveCurrentCompany(members, saved);
      if (resolved) {
        setCurrentCompany(resolved.company);
        setCurrentRole(resolved.role);
        setNeedsCompanySelection(false);
        if (typeof window !== 'undefined') saveCompanyId(window.localStorage, u.id, resolved.companyId);
      } else {
        setCurrentCompany(null);
        setCurrentRole(null);
        // Sem empresa OU múltiplas sem escolha válida → tratável pela UI
        setNeedsCompanySelection(members.length !== 1 || members.length === 0 ? true : false);
        if (members.length === 0) setNeedsCompanySelection(true);
      }
    } catch {
      setProfile(null);
      setMemberships([]);
      setCurrentCompany(null);
      setCurrentRole(null);
      setNeedsCompanySelection(false);
    }
  }, []);

  useEffect(() => {
    if (!configured) return undefined;
    let active = true;
    getSession(supabase)
      .then((sess) => { if (active) return loadContext(sess); return undefined; })
      .catch(() => { if (active) return loadContext(null); return undefined; })
      .finally(() => { if (active) setLoading(false); });
    const { data } = onAuthStateChange(supabase, (sess) => {
      if (!active) return;
      setLoading(true);
      loadContext(sess).finally(() => { if (active) setLoading(false); });
    });
    return () => { active = false; data?.subscription?.unsubscribe(); };
  }, [configured, loadContext]);

  const selectCompany = useCallback((companyId) => {
    setMemberships((prev) => {
      const found = (prev || []).find((m) => m.companyId === companyId || m.company?.id === companyId);
      if (found?.company) {
        setCurrentCompany(found.company);
        setCurrentRole(found.role);
        setNeedsCompanySelection(false);
        if (user && typeof window !== 'undefined') saveCompanyId(window.localStorage, user.id, found.companyId);
      }
      return prev;
    });
  }, [user]);

  const refresh = useCallback(async () => {
    if (!configured) return;
    setLoading(true);
    try {
      const sess = await getSession(supabase);
      await loadContext(sess);
    } finally {
      setLoading(false);
    }
  }, [configured, loadContext]);

  const signOut = useCallback(async () => {
    if (!configured) return;
    await sbSignOut(supabase);
    await loadContext(null);
  }, [configured, loadContext]);

  return (
    <SupabaseAuthContext.Provider value={{
      configured,
      user,
      session,
      loading,
      profile,
      memberships,
      currentCompany,
      currentRole,
      needsCompanySelection,
      selectCompany,
      refresh,
      signOut,
    }}>
      {children}
    </SupabaseAuthContext.Provider>
  );
}

export const useSupabaseAuth = () => {
  const context = useContext(SupabaseAuthContext);
  if (!context) {
    throw new Error('useSupabaseAuth must be used within a SupabaseAuthProvider');
  }
  return context;
};
