import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/api/supabaseClient';
import { useSupabaseAuth } from '@/lib/SupabaseAuthContext';
import { getCurrentCompany } from '@/api/company';

// Identidade via SupabaseAuthContext (memberships/currentCompany),
// dados complementares via adapter. Erro real nunca vira null silencioso
// sem redirect.
export function useCompany() {
  const [loading, setLoading] = useState(true);
  const [company, setCompany] = useState(null);
  const [error, setError] = useState(null);
  const navigate = useNavigate();
  const { user: sbUser, currentCompany: sbIdentity, loading: sbLoading } = useSupabaseAuth();

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
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
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setError(err);
          setCompany(null);
        }
      } finally {
        if (!cancelled && !sbLoading) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [sbLoading, sbUser, sbIdentity, navigate]);

  return { loading, company, setCompany, error };
}
