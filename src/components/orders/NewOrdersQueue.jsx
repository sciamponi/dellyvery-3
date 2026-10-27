import React, { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { Check, Clock, Printer } from 'lucide-react';
import { changeOrderStatus, STATUS_LABELS } from '@/lib/orderStatusFlow';
import { supabase } from '@/api/supabaseClient';
import { getCompanySettings as sbGetSettings } from '@/api/company';
import { listStages as sbListStages, resolveCardPrimary } from '@/api/orderStages';
import { normalizePrintSettings, markPrinted } from '@/lib/printSettings';
import { decidePrintTrigger, openPrintWindow, printUrl, PRINT_FAILURE_MESSAGE } from '@/lib/printTrigger';
import PrintPromptModal from '@/components/orders/PrintPromptModal';

const fmtCurrency = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);

function timeSince(dateStr) {
  if (!dateStr) return '--';
  const min = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h`;
}

/**
 * Fila de pedidos NOVOS. Deriva de `orders` (realtime nativo, sem duplicar).
 * Aceitar usa o fluxo central; o painel permanece aberto.
 */
export default function NewOrdersQueue({ open, onClose, orders, stages = null, onOrderUpdated }) {
  const { toast } = useToast();
  const busyRef = useRef(new Set());
  const [, forceTick] = useState(0);
  // Impressão pós-aceite (mesma decisão do Kanban/modal).
  const [printCfg, setPrintCfg] = useState({ mode: 'manual', stages: [], width: '80' });
  // Stages reais só para a decisão de impressão (paridade com o Kanban).
  const [printStages, setPrintStages] = useState(null);
  const printCfgLoadedRef = useRef(false);
  const [printPrompt, setPrintPrompt] = useState(null);
  // Pedidos aceitos com impressão pendente/retry. Referência própria
  // (sobrevive a updates realtime e à saída da fila de novos); cada
  // entrada sai só com impressão confirmada ou ao fechar a fila.
  // { orderId, orderNumber, url, stageId, stageName, flow: 'auto'|'manual', failed: null|reason }
  const [pendingPrints, setPendingPrints] = useState([]);

  const companyId = (orders || []).find(o => o.company_id)?.company_id || null;

  useEffect(() => {
    if (!open || !companyId) return;
    let cancelled = false;
    printCfgLoadedRef.current = false;
    sbGetSettings(supabase, companyId)
      .then(s => {
        if (cancelled) return;
        setPrintCfg(normalizePrintSettings(s?.settings?.print));
        printCfgLoadedRef.current = true;
      })
      .catch(() => { if (!cancelled) { setPrintCfg({ mode: 'manual', stages: [], width: '80' }); printCfgLoadedRef.current = true; } });
    sbListStages(supabase, companyId)
      .then(list => { if (!cancelled) setPrintStages(list && list.length > 0 ? list : null); })
      .catch(() => { if (!cancelled) setPrintStages(null); });
    return () => { cancelled = true; };
  }, [open, companyId]);

  const pushPending = (entry) => {
    setPendingPrints(prev => {
      const rest = prev.filter(p => p.orderId !== entry.orderId);
      return [...rest, entry].slice(-5);
    });
  };

  const dropPending = (orderId) => {
    setPendingPrints(prev => prev.filter(p => p.orderId !== orderId));
  };

  // Abertura do cupom com falha detectável (popup/erros). Sucesso no fluxo
  // auto marca o dedupe e encerra a pendência; manual nunca marca e mantém
  // o botão (reimpressão sempre livre). Retorna true se abriu.
  const tryOpenPrint = (entry) => {
    const r = openPrintWindow(entry.url);
    if (r.ok) {
      if (entry.flow === 'auto') {
        markPrinted(entry.orderId, entry.stageId);
        dropPending(entry.orderId);
      } else {
        setPendingPrints(prev => prev.map(p => (p.orderId === entry.orderId ? { ...p, failed: null } : p)));
      }
      return true;
    }
    setPendingPrints(prev => prev.map(p => (p.orderId === entry.orderId ? { ...p, failed: r.reason } : p)));
    toast({ title: 'Falha na impressão', description: `${PRINT_FAILURE_MESSAGE[r.reason]} Tente de novo.`, variant: 'destructive' });
    return false;
  };

  const novos = orders
    .filter(o => o.status === 'novo')
    .sort((a, b) => new Date(b.created_date) - new Date(a.created_date));

  const handleAccept = async (order) => {
    const target = resolveCardPrimary(stages, order);
    if (!target?.next) {
      toast({
        title: 'Sem próxima etapa',
        description: 'Ative ou crie uma etapa depois de Novo para aceitar este pedido.',
        variant: 'destructive',
        duration: 4000,
      });
      return;
    }
    if (busyRef.current.has(order.id)) return;
    busyRef.current.add(order.id);
    forceTick(t => t + 1);
    try {
      const updated = await changeOrderStatus(order.id, target.next);
      onOrderUpdated(updated);
      toast({
        title: target.next === 'confirmado'
          ? `Pedido #${order.order_number} confirmado!`
          : `Pedido #${order.order_number} → ${STATUS_LABELS[target.next] || target.next}`,
      });
      // Impressão somente após sucesso confirmado; sem tocar de novo no
      // status (guarda busyRef + sem nova chamada à RPC aqui). Se a config
      // ainda não carregou, busca na hora (aceite rápido nunca cai à toa).
      let cfg = printCfg;
      let stgs = printStages;
      if (!printCfgLoadedRef.current) {
        try {
          const s = await sbGetSettings(supabase, order.company_id || companyId);
          cfg = normalizePrintSettings(s?.settings?.print);
          setPrintCfg(cfg);
          printCfgLoadedRef.current = true;
        } catch { /* mantém a atual */ }
        try {
          const l = await sbListStages(supabase, order.company_id || companyId);
          stgs = l && l.length > 0 ? l : null;
          setPrintStages(stgs);
        } catch { /* mantém */ }
      }
      const d = decidePrintTrigger({
        printCfg: cfg, stages: stgs, displayStages: stages, toStatus: target.next, orderId: updated?.id || order.id,
      });
      const orderId = updated?.id || order.id;
      const orderNumber = updated?.order_number || order.order_number;
      if (d.kind === 'none') {
        // Modo manual: sem nada automático; "Imprimir pedido" fica
        // disponível na seção de aceitos e no modal do pedido.
        pushPending({ orderId, orderNumber, url: printUrl(orderId), stageId: null, stageName: null, flow: 'manual', failed: null });
      } else {
        const entry = { orderId, orderNumber, url: d.url, stageId: d.stageId, stageName: d.stageName, flow: 'auto', failed: null };
        pushPending(entry);
        setPrintPrompt({ ...entry });
      }
    } catch (err) {
      toast({ title: 'Erro ao aceitar pedido', description: err?.message, variant: 'destructive' });
    } finally {
      busyRef.current.delete(order.id);
      forceTick(t => t + 1);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-md max-h-[90vh] overflow-hidden p-0 gap-0 flex flex-col">
        <DialogHeader className="shrink-0 px-4 pt-4 sm:px-6 sm:pt-6">
          <DialogTitle className="flex items-center justify-between pr-6">
            <span className="font-heading font-bold">NOVOS PEDIDOS</span>
            <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-sm font-bold text-primary">{novos.length}</span>
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-4">
          {pendingPrints.length > 0 && (
            <div className="mb-3 rounded-xl border border-border bg-muted/40 p-3 space-y-2">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                🖨️ Impressão {printCfg.mode === 'manual' ? 'manual' : 'pendente'}
              </p>
              {pendingPrints.map(p => (
                <div key={p.orderId} className="flex items-center gap-2">
                  <span className="flex-1 min-w-0 truncate text-sm font-medium">#{p.orderNumber || '—'}</span>
                  {p.failed && (
                    <span className="shrink-0 text-[11px] text-destructive">Falhou — tente de novo</span>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={() => tryOpenPrint(p)}
                  >
                    <Printer className="h-4 w-4" /> {p.failed ? 'Tentar de novo' : 'Imprimir pedido'}
                  </Button>
                </div>
              ))}
            </div>
          )}
          {novos.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-8">Nenhum pedido novo aguardando.</p>
          ) : (
            <div className="space-y-2">
              {novos.map(order => {
                const who = order.order_type === 'mesa' && order.table_number
                  ? `Mesa ${order.table_number}`
                  : (order.customer_name || '—');
                const busy = busyRef.current.has(order.id);
                const acceptAction = resolveCardPrimary(stages, order);
                const canAccept = !!acceptAction?.next;
                return (
                  <div key={order.id} className="rounded-xl border border-border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-heading font-bold truncate min-w-0">#{order.order_number} • {who}</p>
                      <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground whitespace-nowrap">
                        <Clock className="h-3 w-3" /> {timeSince(order.created_date)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {order.items?.length || 0} {(order.items?.length || 0) === 1 ? 'item' : 'itens'} • {fmtCurrency(order.total)}
                    </p>
                    <Button
                      className="w-full min-h-11 mt-2"
                      onClick={() => handleAccept(order)}
                      disabled={busy || !canAccept}
                      title={!canAccept ? 'Nenhuma etapa ativa depois de Novo' : undefined}
                    >
                      {busy
                        ? 'Aceitando...'
                        : !canAccept
                          ? 'Sem próxima etapa'
                          : <><Check className="h-4 w-4" /> Aceitar</>}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {printPrompt && (
          <PrintPromptModal
            open={!!printPrompt}
            onOpenChange={(open) => { if (!open) setPrintPrompt(null); }}
            orderNumber={printPrompt.orderNumber}
            stageName={printPrompt.stageName}
            onSkip={() => setPrintPrompt(null)}
            onPrint={() => {
              if (tryOpenPrint({ ...printPrompt })) setPrintPrompt(null);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
