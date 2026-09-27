import React, { useState, useEffect } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useSupabaseAuth } from '@/lib/SupabaseAuthContext';
import { Button } from '@/components/ui/button';
import NotificationBell from '@/components/NotificationBell';
import SelectGuard from '@/components/SelectGuard';
import {
  LayoutDashboard, ShoppingBag, UtensilsCrossed, Users, User,
  Settings, LogOut, Menu as MenuIcon, X, Store, Wallet, CreditCard, LayoutGrid,
  ContactRound
} from 'lucide-react';

const NAV_ITEMS = [
  { label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
  { label: 'Pedidos', path: '/pedidos', icon: ShoppingBag },
  { label: 'Cardápio', path: '/gestao-produtos', icon: UtensilsCrossed },
  { label: 'Clientes', path: '/clientes', icon: Users },
  { label: 'Equipe', path: '/equipe', icon: ContactRound },
  { label: 'Assinatura', path: '/assinatura', icon: CreditCard },
  { label: 'Financeiro', path: '/financeiro', icon: Wallet },
  { label: 'Configurações', path: '/configuracoes', icon: Settings },
  { label: 'Perfil', path: '/perfil', icon: User },
];

const MASTER_ITEMS = [
  { label: 'Planos', path: '/master/planos', icon: LayoutGrid },
];

export default function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [company, setCompany] = useState(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  // FASE 5.1: quando há sessão Supabase, empresa/usuário vêm do contexto
  // Supabase (RLS). Sem sessão Supabase, carga Base44 original é preservada.
  const { user: sbUser, currentCompany: sbCompany, signOut: sbSignOut } = useSupabaseAuth();

  useEffect(() => {
    if (sbUser) {
      setUser({ email: sbUser.email });
      setCompany(sbCompany);
      return;
    }
    const load = async () => {
      try {
        const u = await base44.auth.me();
        setUser(u);
        if (u.company_id) {
          const c = await base44.entities.Company.get(u.company_id);
          setCompany(c);
        }
      } catch (err) { /* ignore */ }
    };
    load();
  }, [sbUser, sbCompany]);

  const handleLogout = async () => {
    if (sbUser) {
      await sbSignOut();
      navigate('/login');
      return;
    }
    await base44.auth.logout();
  };

  const isActive = (path) => location.pathname === path;

  const handleSelectNotification = (notif) => {
    if (notif?.order_id) {
      navigate(`/pedidos?pedido=${notif.order_id}`);
    } else {
      navigate('/pedidos');
    }
  };

  return (
    <div className="min-h-screen bg-background lg:h-screen lg:overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-64 flex-col border-r border-border bg-sidebar">
        <div className="flex h-16 items-center gap-2 border-b border-sidebar-border px-5">
          <button
            type="button"
            onClick={() => navigate('/dashboard')}
            aria-label="Ir para o Dashboard"
            className="flex items-center gap-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary font-heading text-lg font-bold text-primary-foreground">D</div>
            <span className="font-heading font-bold text-sidebar-foreground">DELLYVERY</span>
          </button>
          <span className="ml-auto">
            <NotificationBell companyId={company?.id} onSelectOrder={handleSelectNotification} />
          </span>
        </div>
        <nav className="flex-1 space-y-1 p-3 overflow-y-auto">
          {NAV_ITEMS.map((item, i) => (
            <button
              key={i}
              onClick={() => !item.soon && navigate(item.path)}
              disabled={item.soon}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive(item.path) && !item.soon
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground hover:bg-sidebar-accent/50'
              } ${item.soon ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <item.icon className="h-5 w-5 shrink-0" />
              {item.label}
              {item.soon && <span className="ml-auto text-xs text-muted-foreground">em breve</span>}
            </button>
          ))}
        </nav>
        {user?.role === 'admin' && (
          <div className="border-t border-sidebar-border p-3">
            <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Master</p>
            {MASTER_ITEMS.map((item, i) => (
              <button
                key={i}
                onClick={() => navigate(item.path)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive(item.path) ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground hover:bg-sidebar-accent/50'
                }`}
              >
                <item.icon className="h-5 w-5 shrink-0" />
                {item.label}
              </button>
            ))}
          </div>
        )}
        <div className="border-t border-sidebar-border p-3">
          {company && (
            <Link to={`/cardapio/${company.slug}`} className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors mb-1">
              <Store className="h-5 w-5" /> Ver cardápio
            </Link>
          )}
          <button onClick={handleLogout} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-muted-foreground hover:bg-sidebar-accent/50 transition-colors">
            <LogOut className="h-5 w-5" /> Sair
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
<header className="lg:hidden sticky top-0 z-50 flex min-h-16 items-center justify-between border-b border-border bg-card px-4">
  <button
    type="button"
    onClick={() => navigate('/dashboard')}
    aria-label="Ir para o Dashboard"
    className="flex items-center gap-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
  >
    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary font-heading text-sm font-bold text-primary-foreground">
      D
    </div>
    <span className="font-heading font-bold text-foreground">
      DELLYVERY
    </span>
  </button>

  <div className="flex items-center gap-1">
    <NotificationBell companyId={company?.id} onSelectOrder={handleSelectNotification} />
    <button
      onClick={() => setMobileOpen(true)}
      className="relative z-50 -mr-2 flex h-12 w-12 items-center justify-center rounded-xl hover:bg-muted active:scale-95 transition-all"
      aria-label="Abrir menu"
    >
      <MenuIcon className="h-7 w-7 text-foreground" />
    </button>
  </div>
</header>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <div className="relative flex w-72 flex-col bg-sidebar">
            <div className="flex h-14 items-center justify-between border-b border-sidebar-border px-4">
              <span className="font-heading font-bold text-sidebar-foreground">Menu</span>
              <button onClick={() => setMobileOpen(false)} className="p-2"><X className="h-10 w-10 text-sidebar-foreground" /></button>
            </div>
            <nav className="flex-1 space-y-1 p-3 overflow-y-auto">
              {NAV_ITEMS.map((item, i) => (
                <button
                  key={i}
                  onClick={() => { if (!item.soon) { navigate(item.path); setMobileOpen(false); } }}
                  disabled={item.soon}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                    isActive(item.path) && !item.soon
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                      : 'text-sidebar-foreground hover:bg-sidebar-accent/50'
                  } ${item.soon ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <item.icon className="h-5 w-5 shrink-0" />
                  {item.label}
                  {item.soon && <span className="ml-auto text-xs text-muted-foreground">em breve</span>}
                </button>
              ))}
            </nav>
            <div className="border-t border-sidebar-border p-3">
              {company && (
                <Link to={`/cardapio/${company.slug}`} onClick={() => setMobileOpen(false)} className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors mb-1">
                  <Store className="h-5 w-5" /> Ver cardápio
                </Link>
              )}
              <button onClick={handleLogout} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-muted-foreground hover:bg-sidebar-accent/50 transition-colors">
                <LogOut className="h-5 w-5" /> Sair
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="lg:pl-64 lg:h-screen">
        <div className="mx-auto max-w-6xl p-4 md:p-8 lg:h-full lg:min-h-0 lg:overflow-y-auto">
          <SelectGuard>
            <Outlet />
          </SelectGuard>
        </div>
      </main>
    </div>
  );
}