import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { BellRing } from 'lucide-react';

const fmtCurrency = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);

/**
 * Alerta de novo pedido. Não altera status nem cria fluxos próprios:
 * VER PEDIDO abre o OrderModal existente; FECHAR apenas dispensa o alerta.
 */
export default function NewOrderAlert({ order, open, onView, onClose }) {
  if (!order) return null;
  const itemCount = order.items?.length || 0;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-sm p-6 text-center">
        <DialogHeader className="items-center text-center sm:text-center">
          <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <BellRing className="h-7 w-7 text-primary" />
          </div>
          <DialogTitle className="font-heading text-xl font-bold">NOVO PEDIDO</DialogTitle>
        </DialogHeader>
        <div className="space-y-1">
          <p className="font-heading text-lg font-bold text-foreground">Pedido #{order.order_number}</p>
          <p className="font-medium text-foreground truncate">{order.customer_name}</p>
          <p className="text-sm text-muted-foreground">
            {itemCount} {itemCount === 1 ? 'item' : 'itens'} • {fmtCurrency(order.total)}
          </p>
          <p className="text-sm text-muted-foreground pt-2">Há um novo pedido aguardando aceite.</p>
        </div>
        <div className="flex flex-col gap-2 pt-2">
          <Button className="w-full min-h-11" onClick={onView}>VER PEDIDO</Button>
          <Button variant="outline" className="w-full min-h-11" onClick={onClose}>FECHAR</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
