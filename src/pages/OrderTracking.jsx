import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Package, CheckCircle, Clock, Bike, Store, Table2, Phone, MapPin, Receipt, ChefHat, ShoppingBag, Home, XCircle } from 'lucide-react';

const fmtCurrency = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);

const STATUS_FLOW = {
  delivery: [
    { key: 'novo', label: 'Pedido recebido', icon: Receipt },
    { key: 'confirmado', label: 'Confirmado', icon: CheckCircle },
    { key: 'em_preparo', label: 'Em preparo', icon: ChefHat },
    { key: 'saiu_entrega', label: 'Saiu para entrega', icon: Bike },
    { key: 'finalizado', label: 'Entregue', icon: Home },
  ],
  retirada: [
    { key: 'novo', label: 'Pedido recebido', icon: Receipt },
    { key: 'confirmado', label: 'Confirmado', icon: CheckCircle },
    { key: 'em_preparo', label: 'Em preparo', icon: ChefHat },
    { key: 'aguardando_retirada', label: 'Pronto para retirada', icon: Store },
    { key: 'finalizado', label: 'Finalizado', icon: CheckCircle },
  ],
  mesa: [
    { key: 'novo', label: 'Pedido recebido', icon: Receipt },
    { key: 'confirmado', label: 'Confirmado', icon: CheckCircle },
    { key: 'em_preparo', label: 'Em preparo', icon: ChefHat },
    { key: 'aguardando_retirada', label: 'Pronto', icon: Package },
    { key: 'finalizado', label: 'Finalizado', icon: CheckCircle },
  ],
};

export default function OrderTracking() {
  const { token } = useParams();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const timerRef = useRef(null);

  const fetchOrder = async () => {
    try {
      const res = await base44.functions.invoke('getOrderByToken', { tracking_token: token });
      if (res.data?.error) {
        setError(res.data.error);
      } else {
        setOrder(res.data.order);
      }
    } catch (err) {
      setError('Pedido não encontrado');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrder();
    // Poll every 5 seconds for realtime updates (customer is not authenticated)
    timerRef.current = setInterval(fetchOrder, 5000);
    return () => clearInterval(timerRef.current);
  }, [token]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-4 border-border border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="text-center">
          <XCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h1 className="font-heading text-xl font-bold text-foreground">Pedido não encontrado</h1>
          <p className="text-sm text-muted-foreground mt-2">{error || 'Verifique seu link de acompanhamento.'}</p>
          <Button asChild className="mt-4"><Link to="/">Voltar ao início</Link></Button>
        </div>
      </div>
    );
  }

  const isCancelled = order.status === 'cancelado';
  const isFinished = order.status === 'finalizado';
  const flow = STATUS_FLOW[order.order_type] || STATUS_FLOW.delivery;
  const currentStepIndex = flow.findIndex(s => s.key === order.status);

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-md px-4 py-6 space-y-6">
        {/* Header */}
        <div className="text-center">
          {isCancelled ? (
            <XCircle className="h-14 w-14 text-red-500 mx-auto mb-3" />
          ) : isFinished ? (
            <CheckCircle className="h-14 w-14 text-green-500 mx-auto mb-3" />
          ) : (
            <Clock className="h-14 w-14 text-primary mx-auto mb-3 animate-pulse" />
          )}
          <p className="text-sm text-muted-foreground">Pedido #{order.order_number}</p>
          <h1 className="font-heading text-2xl font-bold text-foreground mt-1">
            {isCancelled ? 'Pedido cancelado' : isFinished ? 'Pedido finalizado' : 'Acompanhando pedido'}
          </h1>
        </div>

        {/* Status timeline */}
        {isCancelled ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4">
            <p className="text-sm text-red-700 font-medium">Seu pedido foi cancelado.</p>
            {order.cancel_reason && <p className="text-xs text-red-600 mt-1">Motivo: {order.cancel_reason}</p>}
          </div>
        ) : (
          <div className="space-y-1">
            {flow.map((step, i) => {
              const Icon = step.icon;
              const isDone = i < currentStepIndex;
              const isCurrent = i === currentStepIndex;
              const isPending = i > currentStepIndex;
              return (
                <div key={step.key} className="flex items-center gap-3">
                  <div className="flex flex-col items-center">
                    <div
                      className={`flex h-10 w-10 items-center justify-center rounded-full transition-colors ${
                        isDone ? 'bg-green-500 text-white' : isCurrent ? 'bg-primary text-white animate-pulse' : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {isDone ? <CheckCircle className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
                    </div>
                    {i < flow.length - 1 && (
                      <div className={`w-0.5 h-8 ${isDone ? 'bg-green-500' : 'bg-border'}`} />
                    )}
                  </div>
                  <div>
                    <p className={`text-sm font-medium ${isPending ? 'text-muted-foreground' : 'text-foreground'}`}>
                      {step.label}
                    </p>
                    {isCurrent && <p className="text-xs text-primary">Em andamento...</p>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Order details */}
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <h2 className="font-heading font-semibold text-foreground">Resumo do pedido</h2>

          {/* Type */}
          <div className="flex items-center gap-2 text-sm">
            {order.order_type === 'delivery' && <><Bike className="h-4 w-4 text-muted-foreground" /> Delivery</>}
            {order.order_type === 'retirada' && <><Store className="h-4 w-4 text-muted-foreground" /> Retirada</>}
            {order.order_type === 'mesa' && <><Table2 className="h-4 w-4 text-muted-foreground" /> Mesa {order.table_number}</>}
          </div>

          {/* Items */}
          <div className="space-y-2 pt-2 border-t border-border">
            {order.items?.map((item, i) => (
              <div key={i} className="flex justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground">{item.quantity}x {item.name}</p>
                  {item.complements && item.complements.length > 0 && (
                    <p className="text-xs text-muted-foreground">{item.complements.map(c => c.option_name).join(', ')}</p>
                  )}
                  {item.notes && <p className="text-xs text-muted-foreground italic">📝 {item.notes}</p>}
                </div>
                <p className="text-sm font-medium shrink-0">{fmtCurrency(item.price)}</p>
              </div>
            ))}
          </div>

          {/* Totals */}
          <div className="space-y-1 pt-2 border-t border-border">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span>{fmtCurrency(order.subtotal)}</span>
            </div>
            {order.delivery_fee > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Taxa de entrega</span>
                <span>{fmtCurrency(order.delivery_fee)}</span>
              </div>
            )}
            {order.discount > 0 && (
              <div className="flex justify-between text-sm text-green-600">
                <span>Desconto</span>
                <span>-{fmtCurrency(order.discount)}</span>
              </div>
            )}
            <div className="flex justify-between font-heading font-bold text-lg pt-1">
              <span>Total</span>
              <span>{fmtCurrency(order.total)}</span>
            </div>
          </div>

          {/* Payment */}
          {order.payment_method && (
            <div className="flex items-center gap-2 text-sm pt-2 border-t border-border">
              <Receipt className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Pagamento:</span>
              <span className="font-medium text-foreground">{order.payment_method}</span>
            </div>
          )}

          {/* Notes */}
          {order.notes && (
            <div className="text-sm pt-2 border-t border-border">
              <span className="text-muted-foreground">Obs: </span>
              <span className="text-foreground">{order.notes}</span>
            </div>
          )}
        </div>

        {/* Customer info */}
        <div className="rounded-xl border border-border bg-card p-4 space-y-2">
          <h2 className="font-heading font-semibold text-foreground text-sm">Dados de entrega</h2>
          <div className="flex items-start gap-2 text-sm">
            <Phone className="h-4 w-4 text-muted-foreground mt-0.5" />
            <span className="text-foreground">{order.customer_name} • {order.customer_phone || '—'}</span>
          </div>
          {order.order_type === 'delivery' && order.customer_address && (
            <div className="flex items-start gap-2 text-sm">
              <MapPin className="h-4 w-4 text-muted-foreground mt-0.5" />
              <span className="text-foreground">
                {order.customer_address}
                {order.customer_neighborhood && `, ${order.customer_neighborhood}`}
                {order.customer_city && ` — ${order.customer_city}`}
              </span>
            </div>
          )}
        </div>

        <Button asChild variant="outline" className="w-full">
          <Link to="/">Voltar ao início</Link>
        </Button>
      </div>
    </div>
  );
}