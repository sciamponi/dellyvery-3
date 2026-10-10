import { supabase as defaultClient } from './supabaseClient.js';

// DELLVERY 3 — Adapter Leads (cadastro público de interessados).
// Escrita pública SOMENTE via RPC create_lead (anon permitido, validações
// no servidor). Leitura/atualização: PLATFORM_ADMIN (RLS) ou RPC admin.

const withClient = (client) => client || defaultClient;

function mustBeConfigured(client) {
  const c = withClient(client);
  if (!c) throw new Error('Supabase não configurado (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)');
  return c;
}

function rpcError(error) {
  throw new Error(error?.message || 'Erro na operação');
}

export const LEAD_SERVICES = [
  { id: 'dellyvery', label: 'Dellyvery', desc: 'Sistema de gestão e pedidos para restaurantes e delivery.', highlight: true },
  { id: 'barberia', label: 'BarberIA', desc: 'Sistema de gestão para barbearias.' },
  { id: 'midia-indoor', label: 'Mídia Indoor', desc: 'Divulgação de marcas e anúncios em telas.' },
  { id: 'automatiza', label: 'Automatiza Solução', desc: 'Automação, CRM e atendimento digital.' },
  { id: 'outro', label: 'Outro serviço', desc: 'Descreva o serviço desejado.' },
];

export const LEAD_STATUSES = [
  { id: 'novo', label: 'Novo interessado' },
  { id: 'em_contato', label: 'Em contato' },
  { id: 'aguardando_dados', label: 'Aguardando dados' },
  { id: 'proposta_enviada', label: 'Contrato enviado' },
  { id: 'contratado', label: 'Contratado' },
  { id: 'descartado', label: 'Não convertido' },
];

export const LEAD_PAYMENT_PREFERENCES = [
  { id: 'pix', label: 'Pix' },
  { id: 'cartao', label: 'Cartão' },
  { id: 'negociacao', label: 'Negociação' },
];

// Planos comerciais (informação; nunca iniciam cobrança).
export const LEAD_PLANS = [
  { id: 'dellyvery-completo', label: 'Dellyvery Completo' },
];

// Resolve ?plano= da URL para o rótulo exibido/pré-preenchido.
// Desconhecido ou ausente: devolve o texto livre (ou vazio).
export function resolvePlanInterest(param) {
  const raw = String(param || '').trim();
  if (!raw) return '';
  const hit = LEAD_PLANS.find((p) => p.id === raw.toLowerCase());
  return hit ? hit.label : raw.slice(0, 120);
}

// Periodicidade desejada (preferência declarada; sem vínculo com
// fidelidade, preços ou cobrança). Sem valores monetários aqui.
export const LEAD_BILLING_PERIODS = [
  { id: 'mensal', label: 'Mensal' },
  { id: 'semestral', label: 'Semestral' },
  { id: 'anual', label: 'Anual' },
];

export function leadBillingLabel(period) {
  return LEAD_BILLING_PERIODS.find((p) => p.id === period)?.label || period || '—';
}

export function leadPaymentLabel(pref) {
  return LEAD_PAYMENT_PREFERENCES.find((p) => p.id === pref)?.label || pref || '—';
}

export function leadStatusLabel(status) {
  return LEAD_STATUSES.find((s) => s.id === status)?.label || status || '—';
}

export async function createLead(client, payload) {
  const c = mustBeConfigured(client);
  if (!payload || typeof payload !== 'object') throw new Error('Dados inválidos');
  const { data, error } = await c.rpc('create_lead', { p_lead: payload });
  if (error) rpcError(error);
  return data; // { lead_id }
}

export async function listLeads(client, { status = null, limit = 100 } = {}) {
  const c = mustBeConfigured(client);
  let q = c.from('leads').select('*').order('created_at', { ascending: false }).limit(limit);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) rpcError(error);
  return data || [];
}

export async function setLeadStatus(client, leadId, status) {
  const c = mustBeConfigured(client);
  if (!leadId) throw new Error('Cadastro não identificado');
  const { data, error } = await c.rpc('set_lead_status', { p_lead_id: leadId, p_status: status });
  if (error) rpcError(error);
  return data;
}
