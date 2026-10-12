import React, { useState, useEffect } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useSupabaseAuth } from '@/lib/SupabaseAuthContext';
import { supabase } from '@/api/supabaseClient';
import { isPlatformAdmin } from '@/api/plans';
import { Button } from '@/components/ui/button';
import NotificationBell from '@/components/NotificationBell';
import SelectGuard from '@/components/SelectGuard';
import {
  LayoutDashboard, ShoppingBag, UtensilsCrossed, Users, User,
  Settings, LogOut, Menu as MenuIcon, X, Store, Wallet, CreditCard, LayoutGrid,
  ContactRound, Megaphone, UserPlus, ShieldCheck, Undo2, Armchair
} from 'lucide-react';

const NAV_ITEMS = [
  { label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
  { label: 'Pedidos', path: '/pedidos', icon: ShoppingBag },
  { label: 'Cardápio', path: '/gestao-produtos', icon: UtensilsCrossed },
  { label: 'Clientes', path: '/clientes', icon: Users },
  { label: 'Mesas', path: '/mesas', icon: Armchair },
  { label: 'Equipe', path: '/equipe', icon: ContactRound },
  { label: 'Assinatura', path: '/assinatura', icon: CreditCard },
  { label: 'Financeiro', path: '/financeiro', icon: Wallet },
  { label: 'Atualizações', path: '/atualizacoes', icon: Megaphone },
  { label: 'Configurações', path: '/configuracoes', icon: Settings },
  { label: 'Perfil', path: '/perfil', icon: User },
];

// Navegação do painel Master (contexto /master/*): dashboard + áreas
// administrativas + volta ao sistema (sem encerrar a sessão).
const MASTER_NAV = [
  { label: 'Dashboard', path: '/master', icon: LayoutDashboard },
  { label: 'Interessados', path: '/master/interessados', icon: UserPlus },
  { label: 'Planos', path: '/master/planos', icon: LayoutGrid },
];

export default function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [company, setCompany] = useState(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  // Empresa/usuário vêm do contexto Supabase (RLS).
  const { user: sbUser, currentCompany: sbCompany, signOut: sbSignOut } = useSupabaseAuth();
  // Área Master: o layout alterna para a navegação administrativa.
  const inMaster = location.pathname.startsWith('/master');
  // Acesso Master confirmado pela consulta segura (RLS), nunca por e-mail
  // ou estado local. Invisível até a confirmação (padrão: oculto).
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    setCompany(sbCompany || null);
  }, [sbCompany]);

  useEffect(() => {
    let active = true;
    setIsAdmin(false);
    if (!sbUser?.id) return undefined;
    isPlatformAdmin(supabase, sbUser.id)
      .then((ok) => { if (active) setIsAdmin(!!ok); })
      .catch(() => { if (active) setIsAdmin(false); });
    return () => { active = false; };
  }, [sbUser?.id]);

  const handleLogout = async () => {
    await sbSignOut();
    navigate('/login');
  };

  const isActive = (path) => location.pathname === path;

  const handleSelectNotification = (notif) => {
    if (notif?.order_id) {
      navigate(`/pedidos?pedido=${notif.order_id}`);
    } else {
      navigate('/pedidos');
    }
  };

  const homePath = inMaster ? '/master' : '/dashboard';
  const navItems = inMaster ? MASTER_NAV : NAV_ITEMS;

  return (
    <div className="min-h-screen bg-background lg:h-screen lg:overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-64 flex-col border-r border-border bg-sidebar">
        <div className="flex h-16 items-center gap-2 border-b border-sidebar-border px-5">
          <button
            type="button"
            onClick={() => navigate(homePath)}
            aria-label={inMaster ? 'Ir para o Dashboard Master' : 'Ir para o Dashboard'}
            className="flex items-center gap-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary font-heading text-lg font-bold text-primary-foreground">D</div>
            <span className="font-heading font-bold text-sidebar-foreground">DELLYVERY</span>
          </button>
          {!inMaster && (
            <span className="ml-auto">
              <NotificationBell companyId={company?.id} onSelectOrder={handleSelectNotification} />
            </span>
          )}
        </div>
        {inMaster && (
          <p className="px-5 pt-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Master</p>
        )}
        <nav className="flex-1 space-y-1 p-3 overflow-y-auto">
          {navItems.map((item, i) => (
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
        <div className="border-t border-sidebar-border p-3">
          {inMaster ? (
            <button onClick={() => navigate('/dashboard')} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors">
              <Undo2 className="h-5 w-5" /> Voltar ao sistema
            </button>
          ) : (
            <>
              {isAdmin && (
                <button onClick={() => navigate('/master')} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors mb-1">
                  <ShieldCheck className="h-5 w-5" /> Acessar Master
                </button>
              )}
              {company && (
                <Link to={`/cardapio/${company.slug}`} className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors mb-1">
                  <Store className="h-5 w-5" /> Ver cardápio
                </Link>
              )}
            </>
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
    onClick={() => navigate(homePath)}
    aria-label={inMaster ? 'Ir para o Dashboard Master' : 'Ir para o Dashboard'}
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
    {!inMaster && <NotificationBell companyId={company?.id} onSelectOrder={handleSelectNotification} />}
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
              <span className="font-heading font-bold text-sidebar-foreground">{inMaster ? 'Master' : 'Menu'}</span>
              <button onClick={() => setMobileOpen(false)} className="p-2"><X className="h-10 w-10 text-sidebar-foreground" /></button>
            </div>
            <nav className="flex-1 space-y-1 p-3 overflow-y-auto">
              {navItems.map((item, i) => (
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
              {inMaster ? (
                <button onClick={() => { navigate('/dashboard'); setMobileOpen(false); }} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors">
                  <Undo2 className="h-5 w-5" /> Voltar ao sistema
                </button>
              ) : (
                <>
                  {isAdmin && (
                    <button onClick={() => { navigate('/master'); setMobileOpen(false); }} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors mb-1">
                      <ShieldCheck className="h-5 w-5" /> Acessar Master
                    </button>
                  )}
                  {company && (
                    <Link to={`/cardapio/${company.slug}`} onClick={() => setMobileOpen(false)} className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors mb-1">
                      <Store className="h-5 w-5" /> Ver cardápio
                    </Link>
                  )}
                </>
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
        <div className="mx-auto max-w-6xl p-4 md:p-8 lg:h-full lg:min-h-0 lg:overflow-y-auto [font-size:98%]">
          <SelectGuard>
            <Outlet />
          </SelectGuard>
        </div>
      </main>
    </div>
  );
}