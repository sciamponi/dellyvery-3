import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/api/supabaseClient';
import { listOrders } from '@/api/orders';
import { listDrivers } from '@/api/team';
import { listPayouts, getPayoutItems, createPayout, paidOrderIds } from '@/api/driverPayouts';
import {
  eligibleOrders, summarizePayout, excludePaidOrders,
  buildPayoutCsv,
} from '@/lib/driverPayout';
import { PERIODS, getPeriodRange, filterByPeriod } from '@/lib/finance';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { Printer, Download, Check } from 'lucide-react';

const fmtCurrency = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);

function toISODate(d) {
  const x = new Date(d);
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const day = String(x.getDate()).padStart(2, '0');
  return `${x.getFullYear()}-${m}-${day}`;
}

// Taxas dos entregadores: relatório por entregador/período + fechamento.
// Elegível = entrega concluída (finalizado) com entregador; cancelados e
// pendentes nunca entram. Valor = delivery_fee registrado no pedido.
// Anti-duplicidade no banco (UNIQUE + trigger); aqui, mensagens claras.
export default function DriverPayouts({ companyId }) {
  const { toast } = useToast();
  const [drivers, setDrivers] = useState([]);
  const [orders, setOrders] = useState([]);
  const [payouts, setPayouts] = useState([]);
  const [paidIds, setPaidIds] = useState([]);
  const [driverId, setDriverId] = useState('');
  const [period, setPeriod] = useState('7dias');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [detailItems, setDetailItems] = useState([]);

  const loadBase = async () => {
    if (!companyId) return;
    try {
      const [ds, os, ps] = await Promise.all([
        listDrivers(supabase, companyId).catch(() => []),
        listOrders(supabase, companyId, 500).catch(() => []),
        listPayouts(supabase, companyId, { limit: 50 }).catch(() => []),
      ]);
      setDrivers((ds || []).filter((d) => d.status === 'ativo'));
      setOrders(os || []);
      setPayouts(ps || []);
    } catch (err) {
      toast({ title: 'Erro ao carregar', description: err?.message, variant: 'destructive' });
    }
  };

  useEffect(() => { loadBase(); setSelected([]); setExpanded(null); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [companyId]);

  useEffect(() => {
    if (!companyId || !driverId) { setPaidIds([]); return; }
    paidOrderIds(supabase, companyId, driverId).then(setPaidIds).catch(() => setPaidIds([]));
  }, [companyId, driverId, payouts]);

  const range = useMemo(() => getPeriodRange(period, customStart, customEnd), [period, customStart, customEnd]);

  const eligible = useMemo(() => {
    if (!driverId || !range) return [];
    const inPeriod = filterByPeriod(orders, range);
    const open = excludePaidOrders(eligibleOrders(inPeriod, driverId), paidIds);
    return open;
  }, [orders, driverId, range, paidIds]);

  const summary = useMemo(() => summarizePayout(eligible), [eligible]);
  const selOrders = useMemo(
    () => eligible.filter((o) => selected.includes(o.id)),
    [eligible, selected],
  );
  const selSummary = useMemo(() => summarizePayout(selOrders), [selOrders]);

  const toggleOne = (id) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };
  const toggleAll = () => {
    setSelected((prev) => (prev.length === eligible.length ? [] : eligible.map((o) => o.id)));
  };

  const driverName = (drivers.find((d) => d.id === driverId) || {}).name || '';
  const periodLabel = period === 'custom' && customStart && customEnd
    ? `${customStart} a ${customEnd}`
    : (PERIODS.find((p) => p.id === period) || {}).label || '';

  const handleClose = async () => {
    if (selOrders.length === 0 || busy) return;
    setBusy(true);
    try {
      await createPayout(supabase, companyId, {
        driverId,
        periodStart: toISODate(range.start),
        periodEnd: toISODate(range.end),
        orders: selOrders,
      });
      toast({ title: `Fechamento registrado: ${selSummary.count} entregas, ${fmtCurrency(selSummary.totalFee)}!` });
      setSelected([]);
      setConfirming(false);
      const ps = await listPayouts(supabase, companyId, { limit: 50 }).catch(() => []);
      setPayouts(ps || []);
    } catch (err) {
      toast({ title: 'Erro ao fechar', description: err?.message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const openDetail = async (payout) => {
    if (expanded === payout.id) { setExpanded(null); return; }
    try {
      const items = await getPayoutItems(supabase, payout.id);
      setDetailItems(items || []);
      setExpanded(payout.id);
    } catch (err) {
      toast({ title: 'Erro ao abrir detalhe', description: err?.message, variant: 'destructive' });
    }
  };

  const orderById = useMemo(() => {
    const map = new Map();
    for (const o of orders) map.set(o.id, o);
    return map;
  }, [orders]);

  const exportCsv = () => {
    const csv = buildPayoutCsv({
      driverName, periodLabel, orders: eligible, total: summary.totalFee,
    });
    const blob = new Blob(["\ufeff" + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `taxas-${driverId || 'todos'}-${toISODate(new Date())}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Somente entregas concluídas com entregador. Cancelados e pendentes nunca entram. Valor = taxa registrada no pedido.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Entregador</Label>
          <Select value={driverId || 'none'} onValueChange={(v) => { setDriverId(v === 'none' ? '' : v); setSelected([]); }}>
            <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Selecione...</SelectItem>
              {drivers.map((d) => (
                <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Período</Label>
          <div className="flex flex-wrap gap-1.5">
            {PERIODS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPeriod(p.id)}
                className={`rounded-full px-3 h-8 text-xs font-medium border ${period === p.id ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted text-muted-foreground border-transparent'}`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      {period === 'custom' && (
        <div className="grid grid-cols-2 gap-3 max-w-md">
          <div className="space-y-1 min-w-0"><Label>Início</Label><Input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} /></div>
          <div className="space-y-1 min-w-0"><Label>Fim</Label><Input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} /></div>
        </div>
      )}

      {!driverId ? (
        <p className="text-sm text-muted-foreground text-center py-6">Escolha um entregador para ver as entregas elegíveis.</p>
      ) : eligible.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">Nenhuma entrega elegível no período (só concluídas entram; já pagas saem da lista).</p>
      ) : (
        <>
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-heading font-semibold text-sm">
                Elegíveis ({eligible.length}) — {fmtCurrency(summary.totalFee)}
              </h3>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={exportCsv}>
                  <Download className="h-3.5 w-3.5" /> CSV
                </Button>
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => window.print()}>
                  <Printer className="h-3.5 w-3.5" /> Imprimir
                </Button>
              </div>
            </div>
            <label className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-2 mb-2 cursor-pointer text-xs">
              <input type="checkbox" checked={selected.length === eligible.length && eligible.length > 0} onChange={toggleAll} className="h-4 w-4" />
              Selecionar todas
            </label>
            <div className="max-h-64 overflow-y-auto divide-y divide-border rounded-lg border border-border">
              {eligible.map((o) => (
                <label key={o.id} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-muted/50 text-sm">
                  <input
                    type="checkbox"
                    checked={selected.includes(o.id)}
                    onChange={() => toggleOne(o.id)}
                    className="h-4 w-4 shrink-0"
                    aria-label={`Selecionar pedido ${o.order_number ?? ''}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium truncate">#{o.order_number ?? '?'} • {o.created_date ? new Date(o.created_date).toLocaleDateString('pt-BR') : ''}</span>
                    <span className="block text-xs text-muted-foreground">{o.status}</span>
                  </span>
                  <span className="font-semibold shrink-0">{fmtCurrency(o.delivery_fee)}</span>
                </label>
              ))}
            </div>
          </div>

          {!confirming ? (
            <Button className="w-full min-h-11" disabled={selOrders.length === 0 || busy} onClick={() => setConfirming(true)}>
              Fechar {selSummary.count} entrega(s) • {fmtCurrency(selSummary.totalFee)}
            </Button>
          ) : (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-2">
              <p className="text-sm font-medium">
                Confirmar pagamento de <strong>{fmtCurrency(selSummary.totalFee)}</strong> para <strong>{driverName}</strong>?
              </p>
              <p className="text-xs text-muted-foreground">
                {selSummary.count} entrega(s) de {periodLabel}. Registra quem fechou, quando e o valor pago; cada entrega só pode ser paga uma vez.
              </p>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setConfirming(false)} disabled={busy}>Voltar</Button>
                <Button className="flex-1 min-h-11" onClick={handleClose} disabled={busy}>
                  <Check className="h-4 w-4" /> {busy ? 'Registrando...' : 'Confirmar pagamento'}
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="font-heading font-semibold text-sm mb-2">Histórico de fechamentos</h3>
        {payouts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum fechamento registrado.</p>
        ) : (
          <div className="space-y-1.5">
            {payouts.filter((p) => !driverId || p.driver_id === driverId).map((p) => (
              <div key={p.id} className="rounded-lg border border-border">
                <button
                  type="button"
                  onClick={() => openDetail(p)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium truncate">
                      {(drivers.find((d) => d.id === p.driver_id) || {}).name || 'Entregador'} • {p.period_start} a {p.period_end}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {p.total_orders} entrega(s) • {p.created_at ? new Date(p.created_at).toLocaleDateString('pt-BR') : ''}
                    </span>
                  </span>
                  <span className="font-semibold shrink-0">{fmtCurrency(p.paid_amount ?? p.total_fee)}</span>
                </button>
                {expanded === p.id && (
                  <div className="border-t border-border px-3 py-2 space-y-1">
                    {detailItems.length === 0 && <p className="text-xs text-muted-foreground">Sem itens.</p>}
                    {detailItems.map((it) => {
                      const o = orderById.get(it.order_id);
                      return (
                        <div key={it.order_id} className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">#{o?.order_number ?? '?'} • {o?.created_date ? new Date(o.created_date).toLocaleDateString('pt-BR') : ''}</span>
                          <span className="font-medium">{fmtCurrency(it.fee)}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
