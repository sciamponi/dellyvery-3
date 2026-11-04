import React, { useState, useEffect, useRef } from 'react';
import { Outlet, Link, useLocation, useNavigate, useOutletContext } from 'react-router-dom';
import { useSupabaseAuth } from '@/lib/SupabaseAuthContext';
import { supabase } from '@/api/supabaseClient';
import { isPlatformAdmin } from '@/api/plans';
import { getResellerAccess } from '@/api/resellerAccess';
import { getMyResellerClientAccess } from '@/api/resellerClients';
import NotificationBell from '@/components/NotificationBell';
import SelectGuard from '@/components/SelectGuard';
import { availablePanels, currentPanelFromPath } from '@/lib/panelSwitch';
import {
  LayoutDashboard, ShoppingBag, UtensilsCrossed, Users, User,
  Settings, LogOut, Menu as MenuIcon, X, Store, Wallet, CreditCard, LayoutGrid,
  ContactRound, Megaphone, UserPlus, ShieldCheck, Armchair, FileText,
  Handshake, Building2, Check
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
  { label: 'Empresas', path: '/master/empresas', icon: Building2 },
  { label: 'Interessados', path: '/master/interessados', icon: UserPlus },
  { label: 'Planos', path: '/master/planos', icon: LayoutGrid },
  {
    label: 'Revenda',
    path: '/master/revenda',
    icon: Handshake,
    activePrefixes: ['/master/revenda', '/master/compras'],
  },
  { label: 'Contratos', path: '/master/contratos', icon: FileText },
];

const RESELLER_NAV = [
  { label: 'Visão geral', path: '/revenda', icon: LayoutDashboard },
  { label: 'Clientes', path: '/revenda/clientes', icon: Users },
  { label: 'Créditos', path: '/revenda/creditos', icon: Wallet },
  { label: 'Ativações', path: '/revenda/ativacoes', icon: CreditCard },
];

const PANEL_META = {
  client: { label: 'Painel Cliente', icon: Store },
  master: { label: 'Painel Master', path: '/master', icon: ShieldCheck },
  reseller: { label: 'Painel Revendedor', path: '/revenda', icon: Handshake },
};

export default function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  // Repassa o contexto do gate pai (ex.: { reseller } de /revenda) para as
  // paginas filhas. Sem isso, o Outlet interno nao herda o reseller_id.
  const outletContext = useOutletContext();
  const [company, setCompany] = useState(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  // Empresa/usuário vêm do contexto Supabase (RLS).
  const { user: sbUser, currentCompany: sbCompany, memberships, signOut: sbSignOut } = useSupabaseAuth();
  // Área Master: o layout alterna para a navegação administrativa.
  const inMaster = location.pathname.startsWith('/master');
  // Área do revendedor: navegação própria, sem controles de empresa.
  const inReseller = location.pathname.startsWith('/revenda');
  // Acesso Master confirmado pela consulta segura (RLS), nunca por e-mail
  // ou estado local. Invisível até a confirmação (padrão: oculto).
  const [isAdmin, setIsAdmin] = useState(false);
  // Atalho de revenda apenas quando o vínculo ativo é confirmado pela RLS.
  const [isReseller, setIsReseller] = useState(false);
  const resellerAccessUserId = useRef(null);
  const [managedClient, setManagedClient] = useState(false);

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

  useEffect(() => {
    let active = true;
    if (!sbUser?.id) {
      resellerAccessUserId.current = null;
      setIsReseller(false);
      return undefined;
    }
    if (resellerAccessUserId.current !== sbUser.id) {
      resellerAccessUserId.current = sbUser.id;
      setIsReseller(false);
    }
    getResellerAccess(supabase, sbUser.id)
      .then((access) => { if (active) setIsReseller(access.status === 'allowed'); })
      .catch(() => { if (active) setIsReseller(false); });
    return () => { active = false; };
  }, [sbUser?.id, inReseller]);

  useEffect(() => {
    let active = true;
    setManagedClient(false);
    if (!sbUser?.id || inMaster || inReseller) return undefined;
    getMyResellerClientAccess(supabase)
      .then((access) => { if (active) setManagedClient(Boolean(access)); })
      .catch(() => { if (active) setManagedClient(false); });
    return () => { active = false; };
  }, [sbUser?.id, inMaster, inReseller]);

  const handleLogout = async () => {
    await sbSignOut();
    navigate('/login');
  };

  const isActive = (item) => {
    const path = item?.path;
    if (!path) return false;
    if (item.activePrefixes) {
      return item.activePrefixes.some(
        (prefix) => location.pathname === prefix || location.pathname.startsWith(`${prefix}/`),
      );
    }
    return location.pathname === path;
  };

  const handleSelectNotification = (notif) => {
    if (notif?.order_id) {
      navigate(`/pedidos?pedido=${notif.order_id}`);
    } else {
      navigate('/pedidos');
    }
  };

  const homePath = inMaster ? '/master' : inReseller ? '/revenda' : '/dashboard';
  const baseNavItems = inMaster ? MASTER_NAV : inReseller ? RESELLER_NAV : NAV_ITEMS;
  const navItems = !inMaster && !inReseller && managedClient
    ? baseNavItems.filter((item) => item.path !== '/assinatura')
    : baseNavItems;
  const companyHomePath = memberships?.length ? '/dashboard' : '/criar-restaurante';
  const currentPanel = currentPanelFromPath(location.pathname);
  const panelOptions = availablePanels({ isAdmin, isReseller, currentPanel })
    .map((key) => {
      const meta = PANEL_META[key];
      return {
        key,
        label: meta.label,
        icon: meta.icon,
        path: key === 'client' ? companyHomePath : meta.path,
      };
    });

  const handlePanelSelect = (panel) => {
    if (panel.key !== currentPanel) navigate(panel.path);
    setMobileOpen(false);
  };

  const panelSwitcher = panelOptions.length > 1 ? (
    <div className="mb-2">
      <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Painéis
      </p>
      <div className="space-y-1">
        {panelOptions.map((panel) => {
          const active = panel.key === currentPanel;
          return (
            <button
              key={panel.key}
              type="button"
              onClick={() => handlePanelSelect(panel)}
              disabled={active}
              aria-current={active ? 'page' : undefined}
              className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm transition-colors ${
                active
                  ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground hover:bg-sidebar-accent/50'
              }`}
            >
              <panel.icon className="h-5 w-5 shrink-0" />
              <span className="truncate">{panel.label}</span>
              {active && <Check className="ml-auto h-4 w-4 shrink-0" />}
            </button>
          );
        })}
      </div>
    </div>
  ) : null;

  return (
    <div className="min-h-screen bg-background lg:h-screen lg:overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-64 flex-col border-r border-border bg-sidebar">
        <div className="flex h-16 items-center gap-2 border-b border-sidebar-border px-5">
          <button
            type="button"
            onClick={() => navigate(homePath)}
            aria-label={inMaster ? 'Ir para o Dashboard Master' : inReseller ? 'Ir para a Área do Revendedor' : 'Ir para o Dashboard'}
            className="flex items-center gap-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary font-heading text-lg font-bold text-primary-foreground">D</div>
            <span className="font-heading font-bold text-sidebar-foreground">DELLYVERY</span>
          </button>
          {!inMaster && !inReseller && (
            <span className="ml-auto">
              <NotificationBell companyId={company?.id} onSelectOrder={handleSelectNotification} />
            </span>
          )}
        </div>
        {inMaster && (
          <p className="px-5 pt-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Master</p>
        )}
        {inReseller && (
          <p className="px-5 pt-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Revenda</p>
        )}
        <nav className="flex-1 space-y-1 p-3 overflow-y-auto">
          {navItems.map((item, i) => (
            <button
              key={i}
              onClick={() => !item.soon && navigate(item.path)}
              disabled={item.soon}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                    isActive(item) && !item.soon
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
          {panelSwitcher}
          {!inMaster && !inReseller && company && (
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
    onClick={() => navigate(homePath)}
    aria-label={inMaster ? 'Ir para o Dashboard Master' : inReseller ? 'Ir para a Área do Revendedor' : 'Ir para o Dashboard'}
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
    {!inMaster && !inReseller && <NotificationBell companyId={company?.id} onSelectOrder={handleSelectNotification} />}
      <button
        onClick={() => setMobileOpen(true)}
        className="relative z-50 flex h-12 w-12 items-center justify-center rounded-xl hover:bg-muted active:scale-95 transition-all"
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
              <span className="font-heading font-bold text-sidebar-foreground">{inMaster ? 'Master' : inReseller ? 'Revenda' : 'Menu'}</span>
              <button onClick={() => setMobileOpen(false)} className="p-2"><X className="h-10 w-10 text-sidebar-foreground" /></button>
            </div>
            <nav className="flex-1 space-y-1 p-3 overflow-y-auto">
              {navItems.map((item, i) => (
                <button
                  key={i}
                  onClick={() => { if (!item.soon) { navigate(item.path); setMobileOpen(false); } }}
                  disabled={item.soon}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive(item) && !item.soon
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
              {panelSwitcher}
              {!inMaster && !inReseller && company && (
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
        <div className="mx-auto max-w-6xl p-4 md:p-8 lg:h-full lg:min-h-0 lg:overflow-y-auto [font-size:98%]">
          <SelectGuard>
            <Outlet context={outletContext} />
          </SelectGuard>
        </div>
      </main>
    </div>
  );
}