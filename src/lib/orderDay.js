/**
 * Navegação por dia em "Últimos pedidos" (puro, testável).
 * Tudo em horário local; comparação sempre por início do dia.
 */

export function startOfDayLocal(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function isSameDay(a, b) {
  return startOfDayLocal(a).getTime() === startOfDayLocal(b).getTime();
}

export function isFutureDay(date, now = new Date()) {
  return startOfDayLocal(date).getTime() > startOfDayLocal(now).getTime();
}

export function addDaysLocal(date, n) {
  const x = new Date(date);
  x.setDate(x.getDate() + n);
  return startOfDayLocal(x);
}

export function formatDayLabel(date, now = new Date()) {
  const d = startOfDayLocal(date);
  if (isSameDay(d, now)) return 'Hoje';
  const label = d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' });
  const yesterday = addDaysLocal(startOfDayLocal(now), -1);
  if (isSameDay(d, yesterday)) return `Ontem — ${label}`;
  return label;
}

export function filterByDay(orders, date) {
  const start = startOfDayLocal(date).getTime();
  const end = start + 24 * 60 * 60 * 1000;
  return (orders || []).filter(o => {
    if (!o.created_date) return false;
    const t = new Date(o.created_date).getTime();
    return t >= start && t < end;
  });
}

export function calcPdvTotals(items, fee = 0) {
  const lineTotal = (x) => (Number(x.unit_price) || 0) * (Number(x.quantity) || 0)
    + (Array.isArray(x.complements) ? x.complements.reduce((s, c) => s + (Number(c.price) || 0) * (Number(c.quantity) || 0), 0) : 0);
  const subtotal = (items || []).reduce((s, x) => s + lineTotal(x), 0);
  const total = subtotal + (Number(fee) || 0);
  const count = (items || []).reduce((s, x) => s + (Number(x.quantity) || 0), 0);
  return { subtotal, fee: Number(fee) || 0, total, count };
}
