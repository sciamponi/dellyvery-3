/**
 * Cálculos financeiros centralizados (regra atual do projeto):
 * receita = SOMENTE pedidos com status "finalizado".
 * Cancelados e demais status entram nas contagens, nunca na receita.
 * Ticket médio = receita ÷ nº de finalizados do período.
 */

export const PAID_STATUS = 'finalizado';
export const CANCELED_STATUS = 'cancelado';

export const PERIODS = [
  { id: 'hoje', label: 'Hoje' },
  { id: 'ontem', label: 'Ontem' },
  { id: '7dias', label: '7 dias' },
  { id: '30dias', label: '30 dias' },
  { id: 'mes', label: 'Este mês' },
  { id: 'custom', label: 'Personalizado' },
];

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function getPeriodRange(periodId, customStart, customEnd) {
  const now = new Date();
  const today = startOfDay(now);
  switch (periodId) {
    case 'ontem': {
      const s = new Date(today);
      s.setDate(s.getDate() - 1);
      const e = new Date(today);
      return { start: s, end: e };
    }
    case '7dias': {
      const s = new Date(today);
      s.setDate(s.getDate() - 6);
      const e = new Date(now);
      return { start: s, end: e };
    }
    case '30dias': {
      const s = new Date(today);
      s.setDate(s.getDate() - 29);
      const e = new Date(now);
      return { start: s, end: e };
    }
    case 'mes': {
      const s = new Date(now.getFullYear(), now.getMonth(), 1);
      return { start: s, end: new Date(now) };
    }
    case 'custom': {
      if (!customStart || !customEnd) return null;
      const s = startOfDay(new Date(`${customStart}T00:00:00`));
      const e = new Date(`${customEnd}T23:59:59`);
      if (isNaN(s) || isNaN(e) || s > e) return null;
      return { start: s, end: e };
    }
    case 'hoje':
    default: {
      return { start: today, end: new Date(now) };
    }
  }
}

export function filterByPeriod(orders, range) {
  if (!range) return [];
  return orders.filter(o => {
    if (!o.created_date) return false;
    const d = new Date(o.created_date);
    return d >= range.start && d <= range.end;
  });
}

export function normalizePayment(method) {
  const m = (method || '').trim();
  return m || 'Não informado';
}

export function summarizeOrders(orders) {
  const paid = orders.filter(o => o.status === PAID_STATUS);
  const canceled = orders.filter(o => o.status === CANCELED_STATUS);
  const revenue = paid.reduce((s, o) => s + (Number(o.total) || 0), 0);

  const byStatus = {};
  orders.forEach(o => {
    const k = o.status || 'indefinido';
    if (!byStatus[k]) byStatus[k] = { count: 0, total: 0 };
    byStatus[k].count += 1;
    byStatus[k].total += Number(o.total) || 0;
  });

  const byType = {};
  orders.forEach(o => {
    const k = o.order_type || 'indefinido';
    if (!byType[k]) byType[k] = { count: 0, total: 0 };
    byType[k].count += 1;
    if (o.status === PAID_STATUS) byType[k].total += Number(o.total) || 0;
  });

  const byPayment = {};
  paid.forEach(o => {
    const k = normalizePayment(o.payment_method);
    if (!byPayment[k]) byPayment[k] = { count: 0, total: 0 };
    byPayment[k].count += 1;
    byPayment[k].total += Number(o.total) || 0;
  });

  return {
    totalOrders: orders.length,
    paidCount: paid.length,
    canceledCount: canceled.length,
    revenue,
    avgTicket: paid.length > 0 ? revenue / paid.length : 0,
    byStatus,
    byType,
    byPayment,
  };
}
