import { supabase as defaultClient } from './supabaseClient.js';

// DELLVERY 3 — Adapter Supabase Team (FASE 5.5 ETAPA B1)
// Funcionários: company_members via RPC list_team (empresa derivada do
// auth.uid() no banco; p_company_id opcional só filtra as próprias).
// Entregadores: delivery_drivers direto (RLS tenant). company_id sempre do
// contexto; patches parciais; sem convite, sem upload, sem fornecedores.

const withClient = (client) => client || defaultClient;

function mustBeConfigured(client) {
  const c = withClient(client);
  if (!c) throw new Error('Supabase não configurado (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)');
  return c;
}

function requireCompanyId(companyId) {
  if (!companyId) throw new Error('Empresa atual não definida');
  return companyId;
}

function rpcError(error) {
  throw new Error(error?.message || 'Erro na operação');
}

export const TEAM_ROLE_LABELS = {
  OWNER: 'Proprietário',
  ADMIN: 'Administrador',
  MANAGER: 'Gerente',
  OPERATOR: 'Operador',
  CASHIER: 'Caixa',
  ATTENDANT: 'Atendente',
};

export const TEAM_ROLE_ORDER = ['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR', 'CASHIER', 'ATTENDANT'];

// ---------- Funcionários ----------

export async function listMembers(client, companyId) {
  const c = mustBeConfigured(client);
  const { data, error } = await c.rpc('list_team', { p_company_id: requireCompanyId(companyId) });
  if (error) rpcError(error);
  return Array.isArray(data) ? data : [];
}

export async function updateMemberRole(client, memberId, role) {
  const c = mustBeConfigured(client);
  if (!TEAM_ROLE_ORDER.includes(role)) throw new Error('Função inválida');
  const { data, error } = await c.from('company_members').update({ role }).eq('id', memberId).select().single();
  if (error) rpcError(error);
  return data;
}

export async function deactivateMember(client, memberId, active) {
  const c = mustBeConfigured(client);
  const { data, error } = await c.from('company_members').update({ active: !!active }).eq('id', memberId).select().single();
  if (error) rpcError(error);
  return data;
}

// ---------- Entregadores ----------

const DRIVER_WRITE_FIELDS = [
  'name', 'phone', 'email', 'document', 'vehicle_type', 'vehicle_plate',
  'photo_url', 'notes', 'status',
];

export function toSupabaseDriverPatch(data) {
  const out = {};
  for (const key of DRIVER_WRITE_FIELDS) {
    if (data[key] !== undefined) out[key] = data[key];
  }
  return out;
}

export async function listDrivers(client, companyId) {
  const c = mustBeConfigured(client);
  const { data, error } = await c
    .from('delivery_drivers')
    .select('*')
    .eq('company_id', requireCompanyId(companyId))
    .order('name', { ascending: true });
  if (error) rpcError(error);
  return data || [];
}

export async function getDriver(client, id) {
  const c = mustBeConfigured(client);
  const { data, error } = await c.from('delivery_drivers').select('*').eq('id', id).maybeSingle();
  if (error) rpcError(error);
  return data || null;
}

export async function createDriver(client, companyId, data) {
  const c = mustBeConfigured(client);
  if (!data?.name?.trim()) throw new Error('Nome é obrigatório');
  const { data: row, error } = await c
    .from('delivery_drivers')
    .insert({ ...toSupabaseDriverPatch({ status: 'ativo', ...data }), company_id: requireCompanyId(companyId) })
    .select()
    .single();
  if (error) rpcError(error);
  return row;
}

export async function updateDriver(client, id, data) {
  const c = mustBeConfigured(client);
  const { data: row, error } = await c.from('delivery_drivers').update(toSupabaseDriverPatch(data)).eq('id', id).select().single();
  if (error) rpcError(error);
  return row;
}

export async function deactivateDriver(client, id, active) {
  return updateDriver(client, id, { status: active ? 'ativo' : 'inativo' });
}
