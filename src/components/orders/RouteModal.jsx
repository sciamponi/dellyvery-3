import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { MapPin, Navigation } from 'lucide-react';
import { formatAddress, formatOrigin, buildRouteUrl, buildEmbedUrl } from '@/lib/deliveryRoute';

// FASE 5.4 UX — Modal de rota/entrega (somente delivery).
// Caminho principal: botão externo Google Maps (sempre funciona).
// Iframe é melhoria progressiva: se falhar, só ele some; o modal segue normal.
// Sem API key, sem distância/ETA inventados.
export default function RouteModal({ open, onClose, order, company }) {
  const [embedFailed, setEmbedFailed] = useState(false);

  React.useEffect(() => {
    if (open) setEmbedFailed(false);
  }, [open ]);

  if (!order || order.order_type !== 'delivery') return null;

  const origin = formatOrigin(company);
  const destination = formatAddress(order);
  const routeUrl = origin && destination ? buildRouteUrl(origin, destination) : '';
  const embedUrl = origin && destination ? buildEmbedUrl(origin, destination) : '';

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Navigation className="h-5 w-5" /> Rota de entrega #{order.order_number}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="rounded-2xl border border-border p-4 space-y-3">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-lg">🏪</span>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Origem — estabelecimento</p>
                <p className="font-medium text-foreground break-words">{company?.name || 'Estabelecimento'}</p>
                {origin && <p className="text-sm text-muted-foreground break-words">{origin}</p>}
              </div>
            </div>
            <div className="flex items-center gap-2 pl-4 text-muted-foreground" aria-hidden="true">
              <span className="h-6 w-px bg-border ml-4" />
              <span className="text-xs">↓</span>
            </div>
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-lg">📍</span>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Destino — cliente</p>
                <p className="font-medium text-foreground break-words">{order.customer_name}</p>
                {destination ? (
                  <p className="text-sm text-muted-foreground break-words">{destination}</p>
                ) : (
                  <p className="text-sm text-muted-foreground">Endereço não informado</p>
                )}
              </div>
            </div>
          </div>

          {embedUrl && !embedFailed && (
            <div className="overflow-hidden rounded-2xl border border-border">
              <iframe
                title={`Mapa da entrega #${order.order_number}`}
                src={embedUrl}
                className="h-64 w-full"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                onError={() => setEmbedFailed(true)}
              />
            </div>
          )}

          {routeUrl ? (
            <Button asChild className="w-full min-h-11">
              <a href={routeUrl} target="_blank" rel="noopener noreferrer">
                <MapPin className="h-4 w-4 mr-2" /> Abrir rota no Google Maps
              </a>
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground text-center">Endereço insuficiente para gerar a rota.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
