import { supabase as defaultClient, isSupabaseConfigured } from './supabaseClient.js';

// DELLVERY 3 — Serviço Supabase Auth + contexto da empresa (FASE 5.1)
// Todas as funções recebem o client por injeção (default: singleton) para
// permitir testes sem rede. Nenhuma usa service_role; tudo respeita RLS
// (auth.uid() no backend; nunca user_id vindo do frontend como autoridade).

export { isSupabaseConfigured };

// Segmento inicial do onboarding. Demais segmentos virão em fases futuras.
export const ONBOARDING_SEGMENT_SLUG = 'restaurant';

const withClient = (client) => client || defaultClient;

const mustBeConfigured = (client) => {
  const c = withClient(client);
  if (!c) throw new Error('Supabase não configurado (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)');
  return c;
};

// ---------- Auth ----------

export async function signUpWithPassword(client, { email, password }) {
  const c = mustBeConfigured(client);
  const { data, error } = await c.auth.signUp({ email, password });
  if (error) throw error;
  return data; // { user, session } — sem confirmação, session já vem criada
}

export async function signInWithPassword(client, { email, password }) {
  const c = mustBeConfigured(client);
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data; // { user, session }
}

export async function signOut(client) {
  const c = mustBeConfigured(client);
  const { error } = await c.auth.signOut();
  if (error) throw error;
}

export async function getSession(client) {
  const c = mustBeConfigured(client);
  const { data, error } = await c.auth.getSession();
  if (error) throw error;
  return data.session || null;
}

export function onAuthStateChange(client, callback) {
  const c = mustBeConfigured(client);
  return c.auth.onAuthStateChange((_event, session) => callback(session || null));
}

// ---------- Profile (auth.uid() como verdade; RLS garante) ----------

export async function fetchProfile(client, userId) {
  const c = mustBeConfigured(client);
  const { data, error } = await c.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) throw error;
  return data || null;
}

// Garante linha em profiles para o usuário recém-criado.
// INSERT próprio permitido pela policy profiles_insert_own (platform_role='USER').
export async function ensureProfile(client, user) {
  const c = mustBeConfigured(client);
  const existing = await fetchProfile(c, user.id);
  if (existing) return existing;
  const { data, error } = await c
    .from('profiles')
    .insert({ id: user.id, email: user.email, name: user.email?.split('@')[0] || null, platform_role: 'USER' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ---------- Empresas / memberships ----------

export async function fetchMemberships(client, userId) {
  const c = mustBeConfigured(client);
  const { data, error } = await c
    .from('company_members')
    .select('company_id, role, active, companies(id, name, slug, active)')
    .eq('user_id', userId)
    .eq('active', true);
  if (error) throw error;
  return (data || []).map((m) => ({
    companyId: m.company_id,
    role: m.role,
    company: m.companies
      ? { id: m.companies.id, name: m.companies.name, slug: m.companies.slug, active: m.companies.active }
      : null,
  }));
}

// ---------- Segmento (somente leitura do catálogo ativo) ----------

export async function fetchRestaurantSegment(client) {
  const c = mustBeConfigured(client);
  const { data, error } = await c
    .from('business_segments')
    .select('id, slug, name')
    .eq('slug', ONBOARDING_SEGMENT_SLUG)
    .eq('active', true)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Segmento Restaurante indisponível');
  return data;
}

// ---------- Criação de empresa (sempre via SECURITY DEFINER) ----------
// Nunca INSERT direto em companies/company_members pelo frontend.

export function slugifyCompanyName(name) {
  const base = (name || '')
    .normalize('NFD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return base;
}

export async function createCompanyWithOwner(client, { name, slug, segmentId, description, phone, email, address }) {
  const c = mustBeConfigured(client);
  const finalSlug = slug || slugifyCompanyName(name);
  if (!finalSlug) throw new Error('slug é obrigatório');
  const { data, error } = await c.rpc('create_company_with_owner', {
    p_name: name,
    p_slug: finalSlug,
    p_segment_id: segmentId,
    p_description: description ?? null,
    p_phone: phone ?? null,
    p_email: email ?? null,
    p_address: address ?? null,
  });
  if (error) throw error;
  return data; // company_id (uuid)
}

// Fluxo completo de onboarding:
// Auth user → profile → create_company_with_owner() → company + OWNER +
// subscription Solo + company_order_seq + company_settings + store_themes
// (efeitos colaterais executados pela função DEFINER, não pelo frontend).
export async function signUpRestaurant(client, { email, password, companyName, slug, phone, address }) {
  const c = mustBeConfigured(client);
  const { user } = await signUpWithPassword(c, { email, password });
  if (!user) throw new Error('Cadastro não retornou usuário');
  await ensureProfile(c, user);
  const segment = await fetchRestaurantSegment(c);
  const companyId = await createCompanyWithOwner(c, {
    name: companyName,
    slug: slug || slugifyCompanyName(companyName),
    segmentId: segment.id,
    phone: phone ?? null,
    email,
    address: address ?? null,
  });
  const memberships = await fetchMemberships(c, user.id);
  return { user, companyId, memberships };
}
