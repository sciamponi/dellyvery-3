// DELLYVERY 3 — Apresentação da tela Master > Empresas (puro).
// Mantém rótulos, estados e textos testáveis sem depender de React.

export const MASTER_COMPANIES_LIMIT = 200;

export const COMPANY_STATUS_OPTIONS = [
  { value: 'all', label: 'Todas as situações' },
  { value: 'active', label: 'Ativas' },
  { value: 'inactive', label: 'Inativas' },
];

export const SUBSCRIPTION_STATUS_OPTIONS = [
  { value: 'all', label: 'Todas as assinaturas' },
  { value: 'trial', label: 'Trial' },
  { value: 'ativo', label: 'Ativo' },
  { value: 'pendente', label: 'Pendente' },
  { value: 'cancelado', label: 'Cancelado' },
  { value: 'suspenso', label: 'Suspenso' },
  { value: 'expirado', label: 'Expirado' },
  { value: 'none', label: 'Sem assinatura/plano' },
];

const SUBSCRIPTION_META = {
  trial: { label: 'Trial', className: 'bg-blue-100 text-blue-700 border-blue-200' },
  ativo: { label: 'Ativo', className: 'bg-green-100 text-green-700 border-green-200' },
  pendente: { label: 'Pendente', className: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  cancelado: { label: 'Cancelado', className: 'bg-red-100 text-red-700 border-red-200' },
  suspenso: { label: 'Suspenso', className: 'bg-orange-100 text-orange-700 border-orange-200' },
  expirado: { label: 'Expirado', className: 'bg-gray-100 text-gray-700 border-gray-200' },
};

export function companyStatusMeta(active) {
  return active
    ? { label: 'Ativa', className: 'bg-green-100 text-green-700 border-green-200' }
    : { label: 'Inativa', className: 'bg-gray-100 text-gray-700 border-gray-200' };
}

export function subscriptionStatusMeta(status) {
  if (!status) {
    return { label: 'Sem assinatura', className: 'bg-muted text-muted-foreground border-border' };
  }
  return SUBSCRIPTION_META[status] || { label: status, className: 'bg-muted text-muted-foreground border-border' };
}

export function billingCycleLabel(cycle) {
  if (cycle === 'monthly') return 'Mensal';
  if (cycle === 'yearly') return 'Anual';
  return '—';
}

export function formatMasterMoney(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0);
}

export function formatPlanPrice(plan) {
  if (!plan) return '—';
  const cycle = plan.billingCycle || plan.billing_cycle;
  const suffix = cycle === 'monthly' ? '/mês' : cycle === 'yearly' ? '/ano' : '';
  return `${formatMasterMoney(plan.price)}${suffix}`;
}

export function companiesViewState({ loading, error, total }) {
  if (loading) return 'loading';
  if (error) return 'error';
  if (!total) return 'empty';
  return 'ready';
}

export function masterCompaniesEmptyMessage({ search = '', companyStatus = 'all', subscriptionStatus = 'all', planId = 'all' } = {}) {
  const filtered = Boolean(search.trim())
    || companyStatus !== 'all'
    || subscriptionStatus !== 'all'
    || planId !== 'all';
  return filtered
    ? 'Nenhuma empresa encontrada para os filtros atuais.'
    : 'Nenhuma empresa cadastrada na plataforma.';
}

export function masterCompaniesLimitNote({ hasMore = false, limit = MASTER_COMPANIES_LIMIT } = {}) {
  if (hasMore) {
    return `Exibindo as ${limit} empresas mais recentes. Há mais resultados; a paginação será uma evolução futura.`;
  }
  return `Lista limitada a ${limit} empresas; a paginação será uma evolução futura.`;
}
