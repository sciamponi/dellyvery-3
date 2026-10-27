import { supabase as defaultClient } from './supabaseClient.js';
import { toWaNumber, buildWaUrl } from '../lib/whatsapp.js';

// DELLVERY 3 — Adapter Revenda (convites de parceiros, Painel Master).
// Escrita admin: RPC create_reseller_invite + CRUD direto via RLS
// (reseller_invites_admin_all). Público (anon): SOMENTE via RPCs
// resolve/claim (pré-cadastro por token). Sem permissões antes da
// aprovação: status controla o ciclo; roles não são alteradas aqui.

const withClient = (client) => client || defaultClient;

function mustBeConfigured(client) {
  const c = withClient(client);
  if (!c) throw new Error('Supabase não configurado (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)');
  return c;
}

function rpcError(error) {
  throw new Error(error?.message || 'Erro na operação');
}

export const RESELLER_PRODUCT = { id: 'dellyvery', label: 'Dellyvery' };
export const RESELLER_MODALITY = { id: 'parceiro', label: 'Parceiro' };

export const RESELLER_STATUSES = [
  { id: 'criado', label: 'Convite criado' },
  { id: 'enviado', label: 'Enviado' },
  { id: 'aguardando_aprovacao', label: 'Aguardando aprovação' },
  { id: 'aprovado', label: 'Aprovado' },
  { id: 'recusado', label: 'Recusado' },
  { id: 'suspenso', label: 'Suspenso' },
  { id: 'expirado', label: 'Expirado' },
  { id: 'revogado', label: 'Revogado' },
];

export function resellerStatusLabel(status) {
  return RESELLER_STATUSES.find((s) => s.id === status)?.label || status || '—';
}

// Transições permitidas no ciclo do convite/inscrição.
// "Enviado" = WhatsApp aberto com mensagem pronta (entrega não confirmada).
const RESELLER_TRANSITIONS = {
  criado: ['enviado', 'revogado'],
  enviado: ['revogado'],
  aguardando_aprovacao: ['aprovado', 'recusado'],
  aprovado: ['suspenso'],
  suspenso: ['aprovado'],
  recusado: [],
  expirado: [],
  revogado: [],
};

export function allowedResellerTransitions(status) {
  return RESELLER_TRANSITIONS[status] || [];
}

// Validação de mudança de status (espelha o CHECK do banco).
// Retorna mensagem de erro ou null.
export function validateResellerTransition(from, to) {
  if (!RESELLER_STATUSES.some((s) => s.id === to)) return 'Status inválido';
  if (!(RESELLER_TRANSITIONS[from] || []).includes(to)) {
    return `Transição inválida: ${resellerStatusLabel(from)} → ${resellerStatusLabel(to)}`;
  }
  return null;
}

export function isValidInviteToken(token) {
  return /^[0-9a-f]{32}$/.test(String(token || '').trim());
}

// Validação do formulário de convite (nome + WhatsApp com DDI).
// Retorna mensagem de erro ou null.
export function validateInviteForm({ name, phone }) {
  if (!String(name || '').trim() || String(name).trim().length < 2) {
    return 'Informe o nome do interessado';
  }
  if (!toWaNumber(phone)) {
    return 'WhatsApp inválido (use DDI+DDD+número, ex.: +55 (11) 99999-9999)';
  }
  return null;
}

export function buildResellerInviteLink(origin, token) {
  const base = String(origin || '').replace(/\/$/, '');
  if (!base) throw new Error('Origem inválida para o link do convite');
  if (!isValidInviteToken(token)) throw new Error('Convite inválido');
  return `${base}/cadastro?convite=${token}`;
}

export function buildResellerInviteMessage({ name, link }) {
  const first = String(name || '').trim().split(/\s+/)[0] || 'tudo bem?';
  return [
    `Olá, ${first}! Tudo bem?`,
    '',
    'Estou convidando você para fazer parte da rede de parceiros do Dellyvery.',
    '',
    'Para iniciar seu cadastro como parceiro, acesse o link abaixo e complete suas informações:',
    '',
    link,
    '',
    'Após o envio, seu cadastro será analisado e você receberá a confirmação da aprovação.',
    '',
    'Seja bem-vindo!',
  ].join('\n');
}

// URL admin → interessado: abre o WhatsApp com a mensagem pronta.
// O envio é manual (o sistema NÃO confirma entrega automática).
export function buildResellerInviteUrl({ phone, name, link }) {
  const to = toWaNumber(phone);
  if (!to) throw new Error('WhatsApp do interessado inválido');
  return buildWaUrl(to, buildResellerInviteMessage({ name, link }));
}

// Normaliza linha do banco para o formulário/ficha.
// Inclui `token` (uso exclusivo do admin p/ remontar o link; a
// listagem já é restrita a PLATFORM_ADMIN via RLS).
export function fromSupabaseInvite(row) {
  if (!row) return row;
  const reg = row.registration && typeof row.registration === 'object' && !Array.isArray(row.registration)
    ? row.registration
    : {};
  return {
    id: row.id,
    token: row.token || null,
    name: row.name || reg.full_name || '',
    phone: row.phone || reg.phone || '',
    product: row.product || RESELLER_PRODUCT.id,
    modality: row.modality || RESELLER_MODALITY.id,
    status: row.status || 'criado',
    registration: reg,
    events: Array.isArray(row.events) ? row.events : [],
    created_at: row.created_at,
    sent_at: row.sent_at || null,
    claimed_at: row.claimed_at || null,
    decided_at: row.decided_at || null,
    expires_at: row.expires_at || null,
    updated_at: row.updated_at,
  };
}

// Evento de histórico (append-only): nunca edita/apaga anteriores.
export function appendResellerEvent(prevEvents, action, detail, userId) {
  const list = Array.isArray(prevEvents) ? [...prevEvents] : [];
  list.push({
    at: new Date().toISOString(),
    by: userId || null,
    action: String(action || ''),
    detail: detail === undefined ? null : detail,
  });
  return list;
}

export async function createResellerInvite(client, { name, phone }) {
  const c = mustBeConfigured(client);
  const err = validateInviteForm({ name, phone });
  if (err) throw new Error(err);
  // Normaliza com DDI (a RPC exige ^55…); aceita com ou sem código do país.
  const wa = toWaNumber(phone);
  const { data, error } = await c.rpc('create_reseller_invite', {
    p_name: String(name).trim(),
    p_phone: wa,
  });
  if (error) rpcError(error);
  return data; // { invite_id, token, status, reused }
}

export async function resolveResellerInvite(client, token) {
  const c = mustBeConfigured(client);
  if (!isValidInviteToken(token)) throw new Error('Convite não identificado');
  const { data, error } = await c.rpc('resolve_reseller_invite', { p_token: String(token).trim() });
  if (error) rpcError(error);
  return data; // { invite_id, name, phone, product, modality, status }
}

export async function claimResellerInvite(client, token, data) {
  const c = mustBeConfigured(client);
  if (!isValidInviteToken(token)) throw new Error('Convite não identificado');
  const { data: out, error } = await c.rpc('claim_reseller_invite', {
    p_token: String(token).trim(),
    p_data: data || {},
  });
  if (error) rpcError(error);
  return out; // { invite_id, status, reused }
}

export async function listResellerInvites(client, { status = null, limit = 200 } = {}) {
  const c = mustBeConfigured(client);
  let q = c.from('reseller_invites').select('*').order('created_at', { ascending: false }).limit(limit);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) rpcError(error);
  return (data || []).map(fromSupabaseInvite);
}

// Varredura de expirados (admin, transação própria no servidor).
// Chamada pelo Painel Master ao carregar (resolve/claim só detectam).
export async function sweepExpiredInvites(client) {
  const c = mustBeConfigured(client);
  const { data, error } = await c.rpc('sweep_expired_reseller_invites', {});
  if (error) rpcError(error);
  return data; // { swept }
}

export async function getResellerInvite(client, id) {
  const c = mustBeConfigured(client);
  if (!id) throw new Error('Convite não identificado');
  const { data, error } = await c.from('reseller_invites').select('*').eq('id', id).maybeSingle();
  if (error) rpcError(error);
  return fromSupabaseInvite(data);
}

// Atualização admin via RLS (transição validada antes da rede).
// `patch` parcial: name/phone (pré-inscrição) ou status/decided_at/sent_at.
export async function updateResellerInvite(client, id, patch, event, userId) {
  const c = mustBeConfigured(client);
  if (!id) throw new Error('Convite não identificado');
  const current = await getResellerInvite(client, id);
  if (!current) throw new Error('Convite não encontrado');
  const next = { ...(patch || {}) };
  if (next.status && next.status !== current.status) {
    const err = validateResellerTransition(current.status, next.status);
    if (err) throw new Error(err);
  }
  if (next.name !== undefined) next.name = String(next.name || '').trim();
  if (next.phone !== undefined) {
    const wa = toWaNumber(next.phone);
    if (!wa) throw new Error('WhatsApp inválido');
    next.phone = wa;
  }
  next.updated_at = new Date().toISOString();
  next.events = event
    ? appendResellerEvent(current.events, event.action, event.detail, userId)
    : (current.events || []);
  const { data: row, error } = await c.from('reseller_invites').update(next).eq('id', id).select().single();
  if (error) rpcError(error);
  return fromSupabaseInvite(row);
}
