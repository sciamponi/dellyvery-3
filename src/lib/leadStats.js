// DELLVERY 3 — Indicadores do dashboard Master (puro, sem rede).
// Opera sobre leads já carregados (RLS garante acesso só a PLATFORM_ADMIN).
// Sem metas ou dados fictícios: tudo deriva da lista real.

export function summarizeLeads(leads = [], { recentLimit = 8 } = {}) {
  const list = Array.isArray(leads) ? leads : [];
  const byKey = (fn) => {
    const map = new Map();
    for (const lead of list) {
      const key = fn(lead) || '—';
      map.set(key, (map.get(key) || 0) + 1);
    }
    return [...map.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || String(a.label).localeCompare(String(b.label)));
  };
  const recent = [...list]
    .sort((a, b) => String(b.created_at || '') > String(a.created_at || '') ? 1 : -1)
    .slice(0, Math.max(0, recentLimit));
  return {
    total: list.length,
    novos: list.filter((l) => l.status === 'novo').length,
    byService: byKey((l) => l.service),
    byBilling: byKey((l) => l.billing_period),
    byStatus: byKey((l) => l.status),
    recent,
  };
}
