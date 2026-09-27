import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { supabase, isSupabaseConfigured } from '@/api/supabaseClient';
import { useSupabaseAuth } from '@/lib/SupabaseAuthContext';
import { getCurrentCompany } from '@/api/company';

// FASE 5.4-C C4: identidade via SupabaseAuthContext (memberships/currentCompany),
// dados complementares via adapter. Sem Supabase configurado, fluxo Base44
// original é preservado. Erro real nunca vira null silencioso sem redirect.
export function useCompany() {
  const [loading, setLoading] = useState(true);
  const [company, setCompany] = useState(null);
  const [error, setError] = useState(null);
  const navigate = useNavigate();
  const { user: sbUser, currentCompany: sbIdentity, loading: sbLoading } = useSupabaseAuth();
  const useSupabase = isSupabaseConfigured();

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        if (useSupabase) {
          if (sbLoading) return; // aguarda identidade; sem null transitório
          if (!sbUser) {
            if (!cancelled) {
              setCompany(null);
              setLoading(false);
            }
            return;
          }
          if (!sbIdentity) {
            navigate('/criar-restaurante');
            if (!cancelled) {
              setCompany(null);
              setLoading(false);
            }
            return;
          }
          const full = await getCurrentCompany(supabase, sbIdentity.id);
          if (!cancelled) {
            if (!full) {
              setError(new Error('Empresa não encontrada'));
              setCompany(null);
            } else {
              setCompany(full);
            }
            setLoading(false);
          }
          return;
        }
        const user = await base44.auth.me();
        if (!user.company_id) {
          navigate('/criar-restaurante');
          return;
        }
        const c = await base44.entities.Company.get(user.company_id);
        if (!cancelled) setCompany(c);
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setError(err);
          setCompany(null);
        }
      } finally {
        if (!cancelled && !(useSupabase && sbLoading)) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [useSupabase, sbLoading, sbUser, sbIdentity, navigate]);

  return { loading, company, setCompany, error };
}
