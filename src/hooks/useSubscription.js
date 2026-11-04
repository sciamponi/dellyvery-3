import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/api/supabaseClient';
import { fromSupabasePlan } from '@/api/plans';

// Assinatura Supabase-only: lê subscriptions (+plan) da empresa via RLS.
// trial_ends_at é derivado de expires_at; limites vêm de plans.limits.
export function useSubscription(companyId) {
  const [loading, setLoading] = useState(true);
  const [subscription, setSubscription] = useState(null);
  const [plan, setPlan] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const reload = useCallback(() => setRefreshKey((value) => value + 1), []);

  useEffect(() => {
    if (!companyId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const load = async () => {
      try {
        const { data: sub, error } = await supabase
          .from('subscriptions')
          .select('*')
          .eq('company_id', companyId)
          .maybeSingle();
        if (error) throw error;
        if (cancelled) return;
        setSubscription(sub || null);
        if (sub?.plan_id) {
          const { data: p, error: pErr } = await supabase
            .from('plans')
            .select('*')
            .eq('id', sub.plan_id)
            .maybeSingle();
          if (pErr) throw pErr;
          if (!cancelled) setPlan(p ? fromSupabasePlan(p) : null);
        } else if (!cancelled) {
          setPlan(null);
        }
      } catch (err) { console.error(err); }
      finally { if (!cancelled) setLoading(false); }
    };
    load();
    return () => { cancelled = true; };
  }, [companyId, refreshKey]);

  const now = Date.now();
  const trialEndsAt = subscription?.trial_ends_at || subscription?.expires_at || null;
  const expiresAt = subscription?.expires_at || null;
  const expiresInFuture = expiresAt ? new Date(expiresAt).getTime() > now : false;
  const isActive = subscription?.status === 'ativo';
  const isTrial = subscription?.status === 'trial';
  const isCanceled = subscription?.status === 'cancelado';
  const isFree = !!plan?.is_free;
  const trialDaysLeft = isTrial && trialEndsAt
    ? Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - now) / (24 * 60 * 60 * 1000)))
    : 0;
  const hasAccess = isFree
    ? (isActive || isTrial)
    : isActive
      ? (!expiresAt || expiresInFuture)
      : (isTrial && trialDaysLeft > 0) || (isCanceled && expiresInFuture);

  return {
    loading, subscription, plan, trialDaysLeft, isActive, isTrial, isCanceled,
    isFree, expiresAt, expiresInFuture, hasAccess, setSubscription, reload,
  };
}
