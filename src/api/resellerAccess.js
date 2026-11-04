import { supabase as defaultClient } from './supabaseClient.js';
import { classifyResellerAccessError } from '../lib/resellerGate.js';

// DELLVERY 3 - Acesso do revendedor.
// A leitura respeita RLS (o revendedor ve apenas o proprio vinculo). A
// aprovacao/geracao de link passa pela Edge Function reseller-approve, que
// valida PLATFORM_ADMIN no backend e usa service_role somente no servidor.

const withClient = (client) => client || defaultClient;

function mustBeConfigured(client) {
  const c = withClient(client);
  if (!c) throw new Error('Supabase não configurado (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)');
  return c;
}

const RESELLER_FIELDS = 'id, user_id, invite_id, status, approved_at, approved_by, suspended_at';

export async function getResellerAccess(client, userId) {
  if (!userId) return { status: 'denied', reseller: null, error: null };
  const c = mustBeConfigured(client);
  const { data, error } = await c
    .from('resellers')
    .select(RESELLER_FIELDS)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    return {
      status: classifyResellerAccessError(error),
      reseller: null,
      error,
    };
  }
  if (!data) return { status: 'denied', reseller: null, error: null };
  if (data.status === 'suspenso') return { status: 'suspended', reseller: data, error: null };
  if (data.status !== 'ativo') return { status: 'denied', reseller: data, error: null };
  return { status: 'allowed', reseller: data, error: null };
}

export async function ensureMasterResellerAccess(client) {
  const c = mustBeConfigured(client);
  const { data, error } = await c.rpc('ensure_master_reseller_access');

  if (error) {
    throw new Error(error.message || 'Não foi possível liberar o acesso de revenda');
  }
  if (!data?.reseller_id) {
    throw new Error('Resposta inválida do acesso de revenda');
  }
  if (data.status !== 'ativo') {
    throw new Error('O acesso de revenda não está ativo');
  }

  return data;
}

async function functionErrorMessage(error) {
  const fallback = error?.message || 'Não foi possível concluir a aprovação';
  const context = error?.context;
  if (context && typeof context.json === 'function') {
    try {
      const payload = await context.json();
      if (payload && typeof payload.error === 'string' && payload.error.trim()) {
        return payload.error.trim();
      }
    } catch {
      // Mantem a mensagem original quando o corpo nao e JSON.
    }
  }
  return fallback;
}

export async function approveResellerAccess(client, inviteId) {
  const c = mustBeConfigured(client);
  if (!inviteId) throw new Error('Convite não identificado');
  if (!c.functions || typeof c.functions.invoke !== 'function') {
    throw new Error('Serviço de aprovação indisponível');
  }

  const { data, error } = await c.functions.invoke('reseller-approve', {
    body: { inviteId },
  });

  if (error) throw new Error(await functionErrorMessage(error));
  if (!data || data.ok !== true) {
    throw new Error(data?.error || 'Não foi possível concluir a aprovação');
  }

  return data;
}
