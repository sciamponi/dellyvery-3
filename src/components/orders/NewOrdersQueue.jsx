import React, { useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { Check, Clock } from 'lucide-react';
import { changeOrderStatus } from '@/lib/orderStatusFlow';

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
export default function NewOrdersQueue({ open, onClose, orders, onOrderUpdated }) {
  const { toast } = useToast();
  const busyRef = useRef(new Set());
  const [, forceTick] = React.useState(0);

  const novos = orders
    .filter(o => o.status === 'novo')
    .sort((a, b) => new Date(b.created_date) - new Date(a.created_date));

  const handleAccept = async (order) => {
    if (busyRef.current.has(order.id)) return;
    busyRef.current.add(order.id);
    forceTick(t => t + 1);
    try {
      const updated = await changeOrderStatus(order.id, 'confirmado');
      onOrderUpdated(updated);
      toast({ title: `Pedido #${order.order_number} confirmado!` });
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
          {novos.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-8">Nenhum pedido novo aguardando.</p>
          ) : (
            <div className="space-y-2">
              {novos.map(order => {
                const who = order.order_type === 'mesa' && order.table_number
                  ? `Mesa ${order.table_number}`
                  : (order.customer_name || '—');
                const busy = busyRef.current.has(order.id);
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
                      disabled={busy}
                    >
                      {busy ? 'Aceitando...' : <><Check className="h-4 w-4" /> Aceitar</>}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
