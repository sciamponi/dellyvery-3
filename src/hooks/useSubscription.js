import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';

export function useSubscription() {
  const [loading, setLoading] = useState(true);
  const [subscription, setSubscription] = useState(null);
  const [plan, setPlan] = useState(null);

  useEffect(() => {
    const load = async () => {
      try {
        const user = await base44.auth.me();
        if (!user.company_id) { setLoading(false); return; }
        const subs = await base44.entities.Subscription.filter({ company_id: user.company_id });
        const sub = subs[0];
        setSubscription(sub);
        if (sub?.plan_id) {
          try {
            const p = await base44.entities.Plan.get(sub.plan_id);
            setPlan(p);
          } catch (e) { /* ignore */ }
        }
      } catch (err) { console.error(err); }
      finally { setLoading(false); }
    };
    load();
  }, []);

  const now = Date.now();
  const isActive = subscription?.status === 'ativo';
  const isTrial = subscription?.status === 'trial';
  const trialDaysLeft = isTrial && subscription?.trial_ends_at
    ? Math.max(0, Math.ceil((new Date(subscription.trial_ends_at).getTime() - now) / (24 * 60 * 60 * 1000)))
    : 0;
  const isCanceled = subscription?.status === 'cancelado';
  const hasAccess = isActive || (isTrial && trialDaysLeft > 0);

  return { loading, subscription, plan, isActive, isTrial, trialDaysLeft, isCanceled, hasAccess, setSubscription };
}