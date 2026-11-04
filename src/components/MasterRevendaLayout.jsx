import React from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { CreditCard, Handshake, Wallet } from 'lucide-react';
import { MASTER_REVENDA_PATHS, masterRevendaTabFromPath } from '@/lib/masterRevendaNav';

const TABS = [
  { id: 'gestao', label: 'Gestão de revendedores', path: MASTER_REVENDA_PATHS.gestao, icon: Handshake },
  { id: 'creditos', label: 'Créditos Revenda', path: MASTER_REVENDA_PATHS.creditos, icon: Wallet },
  { id: 'compras', label: 'Compras Pix', path: MASTER_REVENDA_PATHS.compras, icon: CreditCard },
];

export default function MasterRevendaLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const activeTab = masterRevendaTabFromPath(location.pathname);

  return (
    <div>
      <div className="mb-4 rounded-2xl border border-border bg-card p-2">
        <p className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Revenda
        </p>
        <nav aria-label="Seções de Revenda" className="flex gap-1.5 overflow-x-auto no-scrollbar">
          {TABS.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => navigate(item.path)}
                aria-current={active ? 'page' : undefined}
                className={`flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors ${
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                <item.icon className="h-3.5 w-3.5" />
                {item.label}
              </button>
            );
          })}
        </nav>
      </div>
      <Outlet />
    </div>
  );
}
