import { supabase as defaultClient } from './supabaseClient.js';

// Configuracao global de assinatura (Master). Leitura via RLS de
// PLATFORM_ADMIN; escrita somente pelas RPCs SECURITY DEFINER.
const withClient = (client) => client || defaultClient;

function mustBeConfigured(client) {
  const c = withClient(client);
  if (!c) throw new Error('Supabase nao configurado (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)');
  return c;
}

function rpcError(error) {
  throw new Error(error?.message || 'Erro na operacao');
}

export async function getSubscriptionSettings(client) {
  const c = mustBeConfigured(client);
  const { data, error } = await c
    .from('platform_settings')
    .select('subscription_grace_days, subscription_gate_enabled, updated_at, updated_by')
    .eq('id', true)
    .maybeSingle();
  if (error) rpcError(error);
  return data || {
    subscription_grace_days: 0,
    subscription_gate_enabled: false,
    updated_at: null,
    updated_by: null,
  };
}

export async function setSubscriptionGraceDays(client, days) {
  const c = mustBeConfigured(client);
  const value = Number(days);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error('Dias de carencia devem ser um inteiro maior ou igual a zero');
  }
  const { data, error } = await c.rpc('set_subscription_grace_days', { p_days: value });
  if (error) rpcError(error);
  return data;
}

export async function setSubscriptionGateEnabled(client, enabled) {
  const c = mustBeConfigured(client);
  const { data, error } = await c.rpc('set_subscription_gate_enabled', { p_enabled: !!enabled });
  if (error) rpcError(error);
  return data;
}

export async function grantCompanyGrace(client, companyId, days = null, reason = null) {
  const c = mustBeConfigured(client);
  if (!companyId) throw new Error('Empresa nao informada');
  const value = days === null || days === '' ? null : Number(days);
  if (value !== null && (!Number.isInteger(value) || value < 0)) {
    throw new Error('Dias de carencia devem ser um inteiro maior ou igual a zero');
  }
  const { data, error } = await c.rpc('grant_company_grace', {
    p_company_id: companyId,
    p_days: value,
    p_reason: reason || null,
  });
  if (error) rpcError(error);
  return data;
}
