import React, { useState, useEffect } from 'react';
import { useParams, useSearchParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '@/api/supabaseClient';
import { useCompany } from '@/hooks/useCompany';
import { getOrderDetail } from '@/api/orders';
import { buildKitchenTicket, buildPackageLabel } from '@/lib/kitchenTicket';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Printer } from 'lucide-react';

const fmtCurrency = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
const fmtDateTime = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch { return '—'; }
};

function Spinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-4 border-border border-t-primary rounded-full animate-spin" />
    </div>
  );
}

// Impressão operacional: cupom de cozinha ou etiqueta de pacote.
// Rota dedicada e protegida; window.print() SOMENTE em clique explícito.
// Nunca afirma sucesso: o navegador apenas abre o diálogo.
export default function Impressao() {
  const { orderId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { loading: companyLoading, company } = useCompany();
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');
  const [printRequested, setPrintRequested] = useState(false);
  const modo = searchParams.get('modo') === 'pacote' ? 'pacote' : 'cozinha';
  const etapa = (searchParams.get('etapa') || '').slice(0, 60);
  const [width, setWidth] = useState('80');

  useEffect(() => {
    if (!company?.id || !orderId) return;
    let active = true;
    getOrderDetail(supabase, company.id, orderId)
      .then((d) => { if (active) { if (!d) setError('Pedido não encontrado.'); else setDetail(d); } })
      .catch((err) => { if (active) setError(err?.message || 'Erro ao carregar pedido.'); });
    return () => { active = false; };
  }, [company?.id, orderId]);

  if (companyLoading) return <Spinner />;
  if (!company) return null;

  const ticket = detail ? buildKitchenTicket(detail, company) : null;
  const label = detail ? buildPackageLabel(detail) : null;

  const handlePrint = () => {
    setPrintRequested(true);
    window.print();
  };

  return (
    <div className="min-h-screen bg-muted/40">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .print-sheet, .print-sheet * { visibility: visible; }
          .print-sheet { position: absolute; left: 0; top: 0; width: 100%; margin: 0; }
          .no-print { display: none !important; }
        }
        @page { size: auto; margin: 4mm; }
        .ticket { font-family: ui-monospace, monospace; color: #000; background: #fff; }
        .ticket h1 { font-size: 18px; font-weight: 800; }
        .ticket h2 { font-size: 15px; font-weight: 800; }
        .ticket .item { break-inside: avoid; }
      `}</style>

      <div className="no-print mx-auto max-w-2xl px-4 py-4 flex items-center gap-2 flex-wrap">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/pedidos"><ArrowLeft className="h-4 w-4" /> Pedidos</Link>
        </Button>
        <div className="flex-1" />
        <div className="flex rounded-lg border border-border overflow-hidden text-xs">
          <button
            type="button"
            onClick={() => navigate(`/impressao/${orderId}?modo=cozinha`)}
            className={`px-3 h-8 font-medium ${modo === 'cozinha' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
          >
            Cozinha
          </button>
          <button
            type="button"
            onClick={() => navigate(`/impressao/${orderId}?modo=pacote`)}
            className={`px-3 h-8 font-medium ${modo === 'pacote' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
          >
            Pacote
          </button>
        </div>
        <div className="flex rounded-lg border border-border overflow-hidden text-xs">
          {['58', '80'].map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setWidth(w)}
              className={`px-3 h-8 font-medium ${width === w ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}
            >
              {w}mm
            </button>
          ))}
        </div>
        <Button size="sm" onClick={handlePrint} disabled={!detail}>
          <Printer className="h-4 w-4" /> Imprimir
        </Button>
      </div>

      {error && (
        <div className="no-print mx-auto max-w-2xl px-4">
          <p className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>
        </div>
      )}
      {!error && !detail && <Spinner />}

      {printRequested && (
        <p className="no-print mx-auto max-w-2xl px-4 mt-2 text-xs text-muted-foreground">
          Diálogo de impressão aberto — confirme na janela do navegador. Para reimprimir, clique em Imprimir de novo (nenhum pedido novo é criado).
        </p>
      )}

      {ticket && modo === 'cozinha' && (
        <div className="mx-auto px-4 pb-10">
          <div
            className="print-sheet ticket mx-auto rounded-md border border-border p-4 space-y-3"
            style={{ maxWidth: width === '58' ? '52mm' : '72mm' }}
          >
            <div className="text-center">
              <h1>{ticket.companyName}</h1>
              <p className="text-xs">CUPOM DE PRODUÇÃO — {ticket.typeLabel.toUpperCase()}</p>
              {etapa && <p className="text-xs">Etapa: {etapa}</p>}
            </div>
            <hr className="border-dashed" />
            <div className="text-sm">
              <p><b>Pedido #{ticket.orderNumber}</b> • {fmtDateTime(ticket.createdAt)}</p>
              {ticket.table && <p><b>Mesa/Comanda:</b> {ticket.table}</p>}
              {(ticket.customerName || ticket.customerPhone) && (
                <p>{ticket.customerName}{ticket.customerPhone ? ` • ${ticket.customerPhone}` : ''}</p>
              )}
              {ticket.address && <p><b>Entrega:</b> {ticket.address}</p>}
            </div>
            <hr className="border-dashed" />
            <div className="space-y-2">
              {ticket.items.map((item, i) => (
                <div key={i} className="item text-sm">
                  <p><b>{item.quantity}x {item.name}</b></p>
                  {item.complements.length > 0 && <p>+ {item.complements.join(', ')}</p>}
                  {item.notes && <p><b>OBS: {item.notes}</b></p>}
                </div>
              ))}
              {ticket.items.length === 0 && <p className="text-sm">(sem itens)</p>}
            </div>
            {ticket.orderNotes && (
              <>
                <hr className="border-dashed" />
                <p className="text-sm"><b>OBS DO PEDIDO: {ticket.orderNotes}</b></p>
              </>
            )}
            <hr className="border-dashed" />
            <div className="text-xs">
              <p className="font-bold">PAGAMENTO (informativo)</p>
              {ticket.payment && <p>{ticket.payment}</p>}
              {ticket.changeFor != null && <p>Troco para: {fmtCurrency(ticket.changeFor)}</p>}
              <p>Total: {fmtCurrency(ticket.totals.total)}</p>
            </div>
          </div>
        </div>
      )}

      {label && modo === 'pacote' && (
        <div className="mx-auto px-4 pb-10">
          <div
            className="print-sheet ticket mx-auto rounded-md border-2 border-black p-4 space-y-2"
            style={{ maxWidth: width === '58' ? '52mm' : '72mm' }}
          >
            <h2 className="text-center">PEDIDO #{label.orderNumber}</h2>
            <hr className="border-solid" />
            <div className="text-sm">
              <p><b>{label.customer}</b></p>
              <p>{label.phone}</p>
              <p>{label.address}</p>
            </div>
            <hr className="border-solid" />
            <div className="text-sm space-y-0.5">
              {label.itemsSummary.map((s, i) => <p key={i}>{s}</p>)}
            </div>
            <hr className="border-solid" />
            <p className="text-sm">Total: <b>{fmtCurrency(label.total)}</b>{label.payment ? ` • ${label.payment}` : ''}</p>
          </div>
        </div>
      )}
    </div>
  );
}
