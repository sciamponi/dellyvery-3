import { supabase as defaultClient } from './supabaseClient.js';

// DELLVERY 3 — Adapter Supabase Subscriptions (ONDA 3)
// Escrita SEMPRE via RPC manage_subscription (SECURITY DEFINER):
// a empresa deriva de auth.uid() + membership OWNER/ADMIN; o frontend
// nunca envia company_id. Leitura continua via RLS (member read).

const withClient = (client) => client || defaultClient;

function mustBeConfigured(client) {
  const c = withClient(client);
  if (!c) throw new Error('Supabase não configurado (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)');
  return c;
}

const VALID_ACTIONS = ['upgrade', 'cancel', 'reactivate'];

export async function manageSubscription(client, { action, planId = null } = {}) {
  const c = mustBeConfigured(client);
  if (!VALID_ACTIONS.includes(action)) throw new Error('Ação inválida');
  const { data, error } = await c.rpc('manage_subscription', {
    p_action: action,
    p_plan_id: planId || null,
  });
  if (error) throw new Error(error?.message || 'Erro na operação');
  return withPeriodEnd(data);
}

// Compatibilidade com a UI: o fluxo antigo devolvia current_period_end;
// o schema tem expires_at — expõe o alias sem migration.
export function withPeriodEnd(subscription) {
  if (!subscription || typeof subscription !== 'object') return subscription;
  if (subscription.current_period_end === undefined && subscription.expires_at !== undefined) {
    return { ...subscription, current_period_end: subscription.expires_at };
  }
  return subscription;
}
