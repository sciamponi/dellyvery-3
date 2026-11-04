import { supabase as defaultClient } from './supabaseClient.js';

const withClient = (client) => client || defaultClient;

function mustBeConfigured(client) {
  const c = withClient(client);
  if (!c) throw new Error('Supabase nao configurado (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)');
  return c;
}

function requestError(error) {
  throw new Error(error?.message || 'Erro na operacao');
}

export const RESELLER_CLIENT_STATUSES = [
  { id: 'prospecto', label: 'Prospecto' },
  { id: 'ativo', label: 'Ativo' },
  { id: 'inativo', label: 'Inativo' },
];

export function resellerClientStatusLabel(status) {
  return RESELLER_CLIENT_STATUSES.find((item) => item.id === status)?.label || status || '-';
}

const CLIENT_TEXT_FIELDS = [
  'name', 'trade_name', 'document', 'phone', 'email', 'city', 'state', 'notes',
];

function cleanText(value) {
  return String(value ?? '').trim();
}

export function validateResellerClientForm(data, { partial = false } = {}) {
  if (!partial || data?.name !== undefined) {
    if (!cleanText(data?.name)) return 'Informe o nome do cliente';
  }
  if (data?.status !== undefined && !RESELLER_CLIENT_STATUSES.some((item) => item.id === data.status)) {
    return 'Status do cliente invalido';
  }
  const email = cleanText(data?.email);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return 'E-mail do cliente invalido';
  }
  return null;
}

export function fromSupabaseResellerClient(row) {
  if (!row) return row;
  return {
    id: row.id,
    reseller_id: row.reseller_id,
    name: row.name || '',
    trade_name: row.trade_name || '',
    document: row.document || '',
    phone: row.phone || '',
    email: row.email || '',
    city: row.city || '',
    state: row.state || '',
    notes: row.notes || '',
    status: row.status || 'prospecto',
    user_id: row.user_id || null,
    company_id: row.company_id || null,
    activated_at: row.activated_at || null,
    access_expires_at: row.access_expires_at || null,
    created_by: row.created_by || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

export function toSupabaseResellerClient(resellerId, data) {
  if (!resellerId) throw new Error('Revendedor nao identificado');
  const out = { reseller_id: resellerId, status: data?.status || 'prospecto' };
  for (const field of CLIENT_TEXT_FIELDS) out[field] = cleanText(data?.[field]);
  return out;
}

export function toSupabaseResellerClientPatch(data) {
  const out = {};
  for (const field of CLIENT_TEXT_FIELDS) {
    if (data?.[field] !== undefined) out[field] = cleanText(data[field]);
  }
  if (data?.status !== undefined) out.status = data.status;
  return out;
}

export async function listResellerClients(client, resellerId = null, { limit = 500 } = {}) {
  const c = mustBeConfigured(client);
  let query = c
    .from('reseller_clients')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (resellerId) query = query.eq('reseller_id', resellerId);
  const { data, error } = await query;
  if (error) requestError(error);
  return (data || []).map(fromSupabaseResellerClient);
}

export async function createResellerClient(client, resellerId, data) {
  const c = mustBeConfigured(client);
  const validationError = validateResellerClientForm(data);
  if (validationError) throw new Error(validationError);
  const { data: row, error } = await c
    .from('reseller_clients')
    .insert(toSupabaseResellerClient(resellerId, data))
    .select()
    .single();
  if (error) requestError(error);
  return fromSupabaseResellerClient(row);
}

export async function updateResellerClient(client, resellerId, id, data) {
  const c = mustBeConfigured(client);
  if (!id) throw new Error('Cliente nao identificado');
  if (!resellerId) throw new Error('Revendedor nao identificado');
  const validationError = validateResellerClientForm(data, { partial: true });
  if (validationError) throw new Error(validationError);
  const { data: row, error } = await c
    .from('reseller_clients')
    .update(toSupabaseResellerClientPatch(data))
    .eq('id', id)
    .eq('reseller_id', resellerId)
    .select()
    .single();
  if (error) requestError(error);
  return fromSupabaseResellerClient(row);
}

export const RESELLER_INVITE_STATUSES = [
  { id: 'pending', label: 'Aguardando cadastro' },
  { id: 'accepted', label: 'Conta criada' },
  { id: 'expired', label: 'Expirado' },
  { id: 'revoked', label: 'Revogado' },
];

export function resellerInviteStatusLabel(status) {
  return RESELLER_INVITE_STATUSES.find((item) => item.id === status)?.label || status || '-';
}

export function fromSupabaseResellerInvite(row) {
  if (!row) return row;
  return {
    id: row.invite_id || row.id,
    reseller_id: row.reseller_id || null,
    client_id: row.client_id,
    email: row.invited_email || row.email || '',
    status: row.status || 'pending',
    expires_at: row.expires_at || null,
    accepted_by: row.accepted_by || null,
    accepted_at: row.accepted_at || null,
    revoked_at: row.revoked_at || null,
    created_at: row.created_at || null,
  };
}

export async function listResellerClientInvites(client) {
  const c = mustBeConfigured(client);
  const { data, error } = await c.rpc('list_reseller_client_invites');
  if (error) requestError(error);
  return (data || []).map(fromSupabaseResellerInvite);
}

export async function createResellerClientInvite(client, clientId) {
  const c = mustBeConfigured(client);
  if (!clientId) throw new Error('Cliente nao identificado');
  const { data, error } = await c.rpc('create_reseller_client_invite', {
    p_client_id: clientId,
  });
  if (error) requestError(error);
  return data;
}

export async function revokeResellerClientInvite(client, inviteId) {
  const c = mustBeConfigured(client);
  if (!inviteId) throw new Error('Convite nao identificado');
  const { data, error } = await c.rpc('revoke_reseller_client_invite', {
    p_invite_id: inviteId,
  });
  if (error) requestError(error);
  return data;
}

export async function resolveResellerClientInvite(client, token) {
  const c = mustBeConfigured(client);
  if (!token) throw new Error('Convite nao identificado');
  const { data, error } = await c.rpc('resolve_reseller_client_invite', {
    p_token: String(token),
  });
  if (error) requestError(error);
  return data;
}

export async function claimResellerClientInvite(client, token) {
  const c = mustBeConfigured(client);
  if (!token) throw new Error('Convite nao identificado');
  const { data, error } = await c.rpc('claim_reseller_client_invite', {
    p_token: String(token),
  });
  if (error) requestError(error);
  return data;
}

async function inviteProofErrorMessage(error, fallback) {
  const message = error?.message || fallback;
  const context = error?.context;
  if (context && typeof context.json === 'function') {
    try {
      const payload = await context.json();
      if (payload && typeof payload.error === 'string' && payload.error.trim()) {
        return payload.error.trim();
      }
    } catch {
      return message;
    }
  }
  return message;
}

async function invokeInviteEmailProof(client, body, fallback) {
  const c = mustBeConfigured(client);
  if (!c.functions || typeof c.functions.invoke !== 'function') {
    throw new Error('Servico de verificacao de e-mail indisponivel');
  }
  const { data, error } = await c.functions.invoke('reseller-invite-email-proof', { body });
  if (error) throw new Error(await inviteProofErrorMessage(error, fallback));
  if (!data || data.ok !== true) {
    throw new Error(data?.error || fallback);
  }
  return data;
}

export async function requestResellerInviteEmailProof(client, token) {
  if (!token) throw new Error('Convite nao identificado');
  return invokeInviteEmailProof(
    client,
    { action: 'request', inviteToken: String(token) },
    'Nao foi possivel enviar o codigo de confirmacao',
  );
}

export async function verifyResellerInviteEmailProof(client, token, code) {
  if (!token) throw new Error('Convite nao identificado');
  const normalizedCode = String(code || '').trim();
  if (!/^\d{6}$/.test(normalizedCode)) throw new Error('Informe o codigo de 6 digitos');
  return invokeInviteEmailProof(
    client,
    { action: 'verify', inviteToken: String(token), code: normalizedCode },
    'Nao foi possivel confirmar o codigo',
  );
}

export async function getMyResellerClientAccess(client) {
  const c = mustBeConfigured(client);
  const { data, error } = await c.rpc('get_my_reseller_client_access');
  if (error) requestError(error);
  return data;
}
