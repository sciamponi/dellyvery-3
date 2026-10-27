import { supabase as defaultClient } from './supabaseClient.js';
import { MASTER_COMPANIES_LIMIT } from '../lib/masterCompaniesView.js';

// DELLYVERY 3 — Visão Master das empresas (somente leitura).
// A RLS já autoriza PLATFORM_ADMIN a ler companies/company_members/profiles/
// subscriptions/plans. Nenhuma migration ou escrita é feita aqui.

const withClient = (client) => client || defaultClient;

function mustBeConfigured(client) {
  const c = withClient(client);
  if (!c) throw new Error('Supabase não configurado (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)');
  return c;
}

function fail(error) {
  throw new Error(error?.message || 'Erro ao carregar empresas');
}

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

const BASE_SELECT = [
  'id',
  'name',
  'slug',
  'active',
  'created_at',
  'segment:business_segments(name)',
  'subscriptions(status,started_at,expires_at,plans(id,name,price,billing_cycle))',
].join(',');

const INNER_SELECT = BASE_SELECT.replace('subscriptions(', 'subscriptions!inner(');

export function normalizeMasterSearch(value) {
  return String(value || '')
    .trim()
    .replace(/[(),]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function mapMasterCompany(row, owner = null) {
  if (!row) return null;
  const subscription = first(row.subscriptions);
  const plan = first(subscription?.plans);
  const profile = first(owner?.profiles);
  const segment = first(row.segment);
  return {
    id: row.id,
    name: row.name || '',
    slug: row.slug || '',
    active: !!row.active,
    createdAt: row.created_at || null,
    segment: segment?.name || null,
    owner: owner ? {
      id: owner.user_id || profile?.id || null,
      name: profile?.name || '',
      email: profile?.email || '',
      phone: profile?.phone || '',
      active: !!owner.active,
    } : null,
    subscription: subscription ? {
      status: subscription.status || null,
      startedAt: subscription.started_at || null,
      expiresAt: subscription.expires_at || null,
    } : null,
    plan: plan ? {
      id: plan.id || null,
      name: plan.name || '',
      price: plan.price != null ? Number(plan.price) : 0,
      billingCycle: plan.billing_cycle || null,
    } : null,
  };
}

async function findOwnerCompanyIds(client, term) {
  const { data: profiles, error: profileError } = await client
    .from('profiles')
    .select('id')
    .ilike('email', `%${term}%`)
    .limit(500);
  if (profileError) fail(profileError);

  const userIds = (profiles || []).map((p) => p.id).filter(Boolean);
  if (userIds.length === 0) return [];

  const { data: members, error: memberError } = await client
    .from('company_members')
    .select('company_id,user_id,role')
    .in('user_id', userIds)
    .eq('role', 'OWNER')
    .limit(500);
  if (memberError) fail(memberError);

  return [...new Set((members || []).map((m) => m.company_id).filter(Boolean))];
}

async function loadOwners(client, companyIds) {
  if (!companyIds.length) return new Map();
  const { data, error } = await client
    .from('company_members')
    .select('company_id,user_id,role,active,created_at,profiles(name,email,phone)')
    .in('company_id', companyIds)
    .eq('role', 'OWNER')
    .order('created_at', { ascending: true });
  if (error) fail(error);

  const owners = new Map();
  for (const row of data || []) {
    const current = owners.get(row.company_id);
    if (!current || (!current.active && row.active)) owners.set(row.company_id, row);
  }
  return owners;
}

async function exactCount(query) {
  const { count, error } = await query;
  if (error) fail(error);
  return count || 0;
}

export async function getMasterCompanyMetrics(client) {
  const c = mustBeConfigured(client);
  const now = new Date();
  const inSevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const countCompanies = () => c.from('companies').select('id', { count: 'exact', head: true });
  const countSubscriptions = () => c.from('subscriptions').select('id', { count: 'exact', head: true });

  const [totalCompanies, activeCompanies, trials, expiringSoon, withPlan] = await Promise.all([
    exactCount(countCompanies()),
    exactCount(countCompanies().eq('active', true)),
    exactCount(countSubscriptions().eq('status', 'trial')),
    exactCount(
      countSubscriptions()
        .in('status', ['trial', 'ativo'])
        .gte('expires_at', now.toISOString())
        .lte('expires_at', inSevenDays.toISOString()),
    ),
    exactCount(countSubscriptions().not('plan_id', 'is', null)),
  ]);

  return {
    totalCompanies,
    activeCompanies,
    inactiveCompanies: Math.max(0, totalCompanies - activeCompanies),
    trials,
    expiringSoon,
    withoutSubscriptionOrPlan: Math.max(0, totalCompanies - withPlan),
  };
}

export async function listMasterCompanies(client, {
  search = '',
  companyStatus = 'all',
  subscriptionStatus = 'all',
  planId = 'all',
  limit = MASTER_COMPANIES_LIMIT,
} = {}) {
  const c = mustBeConfigured(client);
  const term = normalizeMasterSearch(search);
  const ownerCompanyIds = term ? await findOwnerCompanyIds(c, term) : [];
  const expiring = subscriptionStatus === 'expiring';
  const needsInner = (subscriptionStatus !== 'all' && subscriptionStatus !== 'none')
    || (planId !== 'all' && planId !== '');

  let query = c.from('companies')
    .select(needsInner ? INNER_SELECT : BASE_SELECT)
    .order('created_at', { ascending: false })
    .limit(limit + 1);

  if (companyStatus === 'active') query = query.eq('active', true);
  if (companyStatus === 'inactive') query = query.eq('active', false);

  if (subscriptionStatus === 'none') {
    query = query.is('subscriptions', null);
  } else if (expiring) {
    const now = new Date();
    const inSevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    query = query
      .in('subscriptions.status', ['trial', 'ativo'])
      .gte('subscriptions.expires_at', now.toISOString())
      .lte('subscriptions.expires_at', inSevenDays.toISOString());
  } else if (subscriptionStatus !== 'all') {
    query = query.eq('subscriptions.status', subscriptionStatus);
  }

  if (planId !== 'all' && planId !== '') {
    query = query.eq('subscriptions.plan_id', planId);
  }

  if (term) {
    const filters = [`name.ilike.%${term}%`, `slug.ilike.%${term}%`];
    if (ownerCompanyIds.length > 0) filters.push(`id.in.(${ownerCompanyIds.join(',')})`);
    query = query.or(filters.join(','));
  }

  const { data, error } = await query;
  if (error) fail(error);

  const rows = data || [];
  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const owners = await loadOwners(c, pageRows.map((row) => row.id));

  return {
    items: pageRows.map((row) => mapMasterCompany(row, owners.get(row.id))),
    limit,
    hasMore,
  };
}

export async function getMasterCompaniesOverview(client, options = {}) {
  const c = mustBeConfigured(client);
  const [metrics, page] = await Promise.all([
    getMasterCompanyMetrics(c),
    listMasterCompanies(c, options),
  ]);
  return { ...page, metrics };
}
