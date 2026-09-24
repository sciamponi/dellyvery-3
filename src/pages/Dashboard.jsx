import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Image } from '@/components/ui/image';
import { isToday } from 'date-fns';
import { ShoppingBag, Clock, CheckCircle, Package, ArrowRight, Bell, Store } from 'lucide-react';
import OrderModal from '@/components/orders/OrderModal';
import CancelOrderDialog from '@/components/orders/CancelOrderDialog';

const STATUS_CONFIG = {
  novo: { label: 'Novo', cls: 'bg-blue-100 text-blue-700' },
  confirmado: { label: 'Confirmado', cls: 'bg-yellow-100 text-yellow-700' },
  em_preparo: { label: 'Em preparo', cls: 'bg-orange-100 text-orange-700' },
  aguardando_retirada: { label: 'Pronto', cls: 'bg-purple-100 text-purple-700' },
  saiu_entrega: { label: 'Saiu p/ entrega', cls: 'bg-indigo-100 text-indigo-700' },
  finalizado: { label: 'Finalizado', cls: 'bg-green-100 text-green-700' },
  cancelado: { label: 'Cancelado', cls: 'bg-red-100 text-red-700' },
};

const fmtCurrency = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);

// Tempo desde a criação do pedido: agora / N min / N h
function timeSince(dateStr) {
  if (!dateStr) return '--';
  const min = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h`;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [company, setCompany] = useState(null);
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [cancelOrderData, setCancelOrderData] = useState(null);
  const [, setTick] = useState(0);
  const companyIdRef = useRef(null);

  useEffect(() => {
    const load = async () => {
      try {
        const user = await base44.auth.me();
        if (!user.company_id) {
          navigate('/criar-restaurante');
          return;
        }
        companyIdRef.current = user.company_id;
        const [comp, ords, prods] = await Promise.all([
          base44.entities.Company.get(user.company_id),
          base44.entities.Order.filter({ company_id: user.company_id }, '-created_date', 50),
          base44.entities.Product.filter({ company_id: user.company_id }),
        ]);
        setCompany(comp);
        setOrders(ords);
        setProducts(prods);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    load();

    const unsub = base44.entities.Order.subscribe((event) => {
      if (!companyIdRef.current) return;
      if (event.data?.company_id && event.data.company_id !== companyIdRef.current) return;
      if (event.type === 'create') setOrders(prev => [event.data, ...prev].slice(0, 50));
      else if (event.type === 'update') setOrders(prev => prev.map(o => o.id === event.data.id ? event.data : o));
      else if (event.type === 'delete') setOrders(prev => prev.filter(o => o.id !== event.id));
    });
    // Timer único (30s) para atualizar todos os cronômetros da lista
    const timer = setInterval(() => setTick(t => t + 1), 30000);
    return () => { unsub?.(); clearInterval(timer); };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-border border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (!company) return null;

  const ordersToday = orders.filter(o => o.created_date && isToday(new Date(o.created_date)));
  const inProgress = orders.filter(o => ['novo', 'confirmado', 'em_preparo', 'aguardando_retirada', 'saiu_entrega'].includes(o.status));
  const finished = orders.filter(o => o.status === 'finalizado');

  // Mais recente primeiro (por created_date); realtime faz prepend, sort garante a ordem
  const recentOrders = [...orders]
    .sort((a, b) => new Date(b.created_date) - new Date(a.created_date))
    .slice(0, 8);

  const stats = [
    { icon: ShoppingBag, label: 'Pedidos hoje', value: ordersToday.length, color: 'text-blue-600', bg: 'bg-blue-50', ariaLabel: 'Ver pedidos de hoje' },
    { icon: Clock, label: 'Em andamento', value: inProgress.length, color: 'text-orange-600', bg: 'bg-orange-50', ariaLabel: 'Ver pedidos em andamento' },
    { icon: CheckCircle, label: 'Finalizados', value: finished.length, color: 'text-green-600', bg: 'bg-green-50', ariaLabel: 'Ver pedidos finalizados' },
  ];

  return (
    <div className="space-y-8 w-full max-w-full min-w-0">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-foreground">{company.name}</h1>
          <p className="text-sm text-muted-foreground">{company.slogan || 'Bem-vindo de volta!'}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to={`/cardapio/${company.slug}`}>
              <Store className="h-4 w-4 mr-2" /> Ver cardápio
            </Link>
          </Button>
          <div className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${company.is_open ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
            <span className={`h-2 w-2 rounded-full ${company.is_open ? 'bg-green-500' : 'bg-red-500'}`} />
            {company.is_open ? 'Aberto' : 'Fechado'}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((s, i) => (
          <button
            key={i}
            type="button"
            onClick={() => navigate('/pedidos')}
            aria-label={s.ariaLabel}
            className="w-full rounded-2xl border border-border bg-card p-5 text-left cursor-pointer transition-all hover:border-primary/50 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${s.bg} mb-3`}>
              <s.icon className={`h-5 w-5 ${s.color}`} />
            </div>
            <p className="text-sm text-muted-foreground">{s.label}</p>
            <p className="font-heading text-2xl font-bold text-foreground mt-1">{s.value}</p>
          </button>
        ))}
      </div>

      {/* Two columns */}
      <div className="grid gap-6 lg:grid-cols-3 min-w-0">
        {/* Recent orders */}
        <div className="lg:col-span-2 w-full max-w-full min-w-0 overflow-hidden rounded-2xl border border-border bg-card p-4 sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-heading font-semibold text-foreground">Últimos pedidos</h2>
            <Bell className="h-5 w-5 text-muted-foreground" />
          </div>
          {orders.length === 0 ? (
            <div className="text-center py-12">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
                <ShoppingBag className="h-7 w-7 text-muted-foreground" />
              </div>
              <p className="font-medium text-foreground">Nenhum pedido ainda</p>
              <p className="text-sm text-muted-foreground mt-1">Compartilhe seu cardápio para receber o primeiro pedido.</p>
              <Button asChild variant="outline" size="sm" className="mt-4">
                <Link to={`/cardapio/${company.slug}`}>Ver cardápio <ArrowRight className="h-4 w-4 ml-2" /></Link>
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {recentOrders.map(order => {
                const st = STATUS_CONFIG[order.status] || STATUS_CONFIG.novo;
                const who = order.order_type === 'mesa' && order.table_number ? `Mesa ${order.table_number}` : (order.customer_name || '—');
                return (
                  <button
                    key={order.id}
                    type="button"
                    onClick={() => setSelectedOrder(order)}
                    aria-label={`Ver pedido ${order.order_number} de ${who}`}
                    className="flex w-full min-w-0 items-center justify-between gap-2 sm:gap-3 rounded-xl border border-border p-3 text-left cursor-pointer transition-colors hover:bg-muted/50 hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                      <div className={`shrink-0 whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-medium ${st.cls}`}>{st.label}</div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-foreground truncate">#{order.order_number} • {who}</p>
                        <p className="text-xs text-muted-foreground truncate">{order.items?.length || 0} {order.items?.length === 1 ? 'item' : 'itens'} • {timeSince(order.created_date)}</p>
                      </div>
                    </div>
                    <p className="font-semibold text-foreground shrink-0 whitespace-nowrap ml-2">{fmtCurrency(order.total)}</p>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Products summary */}
        <div className="w-full max-w-full min-w-0 overflow-hidden rounded-2xl border border-border bg-card p-4 sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-heading font-semibold text-foreground">Cardápio</h2>
            <Package className="h-5 w-5 text-muted-foreground" />
          </div>
          {products.length === 0 ? (
            <div className="text-center py-8">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
                <Package className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">Nenhum produto cadastrado</p>
              <p className="text-xs text-muted-foreground mt-1">Adicione produtos ao seu cardápio.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {products.slice(0, 5).map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => navigate('/gestao-produtos')}
                  aria-label={`Gerenciar produto ${p.name}`}
                  className="flex w-full min-w-0 items-center gap-3 rounded-lg p-2 text-left cursor-pointer transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {p.image_url ? (
                    <Image src={p.image_url} fittingType="fill" className="h-10 w-10 rounded-lg shrink-0" alt={p.name} />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted shrink-0">
                      <Package className="h-5 w-5 text-muted-foreground" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground truncate">{p.name}</p>
                    <p className="text-xs text-muted-foreground">{p.available ? 'Disponível' : 'Indisponível'}</p>
                  </div>
                  <p className="text-sm font-semibold text-foreground shrink-0 whitespace-nowrap">{fmtCurrency(p.price)}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {selectedOrder && (
        <OrderModal
          order={selectedOrder}
          isOpen={!!selectedOrder}
          onClose={() => setSelectedOrder(null)}
          onOrderUpdated={(updated) => {
            setOrders(prev => prev.map(o => o.id === updated.id ? updated : o));
            setSelectedOrder(updated);
          }}
          onCancel={() => setCancelOrderData(selectedOrder)}
          onSelectOrder={(o) => setSelectedOrder(o)}
        />
      )}
      {cancelOrderData && (
        <CancelOrderDialog
          order={cancelOrderData}
          isOpen={!!cancelOrderData}
          onClose={() => setCancelOrderData(null)}
          onCancelled={(updated) => {
            setOrders(prev => prev.map(o => o.id === updated.id ? updated : o));
            setSelectedOrder(null);
          }}
        />
      )}
    </div>
  );
}