import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Clock } from 'lucide-react';
import { STATUS_LABELS } from '@/lib/orderStatusFlow';
import { waitMinutes } from '@/lib/orderQueue';

const fmtCurrency = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);

// Modal de lista compacta de pedidos (fila/atraso). Clicar abre o OrderModal
// existente via onSelect; este modal fecha sem alterar pedidos.
export default function OrdersListModal({ open, onClose, title, orders, headerExtra }) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-lg max-h-[90vh] overflow-hidden p-0 gap-0 flex flex-col">
        <DialogHeader className="shrink-0 px-4 pt-4 sm:px-6 sm:pt-6">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              aria-label="Voltar"
              className="flex h-9 w-9 items-center justify-center rounded-xl hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <DialogTitle className="font-heading font-bold pr-6">{title}</DialogTitle>
          </div>
          {headerExtra && <div className="mt-3">{headerExtra}</div>}
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-4">
          {orders.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-8">Nenhum pedido aqui.</p>
          ) : (
            <div className="space-y-2">
              {orders.map(order => (
                <button
                  key={order.id}
                  type="button"
                  onClick={() => onClose(order)}
                  className="flex w-full items-center gap-3 rounded-xl border border-border bg-card p-3 text-left hover:border-primary/50 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-all"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-heading font-bold truncate">
                      #{order.order_number} • {order.customer_name || '—'}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      {order.items?.length || 0} {(order.items?.length || 0) === 1 ? 'item' : 'itens'} • {STATUS_LABELS[order.status] || order.status}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-heading font-bold text-sm">{fmtCurrency(order.total)}</p>
                    <p className="flex items-center justify-end gap-1 text-xs text-muted-foreground mt-0.5">
                      <Clock className="h-3 w-3" /> {waitMinutes(order.created_date || order.created_at) < 1 ? 'agora' : `${waitMinutes(order.created_date || order.created_at)} min`}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="shrink-0 border-t border-border px-4 sm:px-6 py-3">
          <Button variant="outline" className="w-full min-h-11" onClick={() => onClose()}>
            <ArrowLeft className="h-4 w-4 mr-2" /> Voltar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
