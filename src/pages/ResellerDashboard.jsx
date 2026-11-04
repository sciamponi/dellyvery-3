import React from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { useSupabaseAuth } from '@/lib/SupabaseAuthContext';
import PageHeader from '@/components/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Users, Wallet, CreditCard, Handshake, ShieldCheck, Clock, ArrowRight } from 'lucide-react';

function fmtDate(iso) {
  if (!iso) return '-';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('pt-BR');
}

export default function ResellerDashboard() {
  const outletContext = /** @type {{ reseller?: { status?: string, approved_at?: string } }} */ (useOutletContext());
  const reseller = outletContext?.reseller;
  const { profile, user } = useSupabaseAuth();
  const name = profile?.name || user?.email?.split('@')[0] || 'Revendedor';
  const email = profile?.email || user?.email || '-';
  const status = reseller?.status === 'ativo' ? 'Acesso ativo' : 'Acesso indisponível';

  const modules = [
    {
      title: 'Clientes',
      description: 'Cadastre e acompanhe os estabelecimentos da sua carteira.',
      icon: Users,
      path: '/revenda/clientes',
    },
    {
      title: 'Créditos',
      description: 'Compre pacotes, consulte o saldo e acompanhe suas movimentações.',
      icon: Wallet,
      path: '/revenda/creditos',
    },
    {
      title: 'Ativações',
      description: 'Ative clientes, renove vigências e acompanhe vencimentos.',
      icon: CreditCard,
      path: '/revenda/ativacoes',
    },
  ];

  return (
    <div>
      <PageHeader
        title="Área do Revendedor"
        description="Seu acesso foi aprovado pelo administrador master."
      >
        <Badge className="bg-green-100 text-green-800">
          <ShieldCheck className="h-3.5 w-3.5 mr-1" /> {status}
        </Badge>
      </PageHeader>

      <div className="rounded-2xl border border-border bg-card p-5 mb-5">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Handshake className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="font-heading font-bold text-foreground truncate">{name}</p>
            <p className="text-sm text-muted-foreground break-all">{email}</p>
            <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              Aprovado em {fmtDate(reseller?.approved_at)}
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5">
        <p className="font-heading font-semibold text-foreground">Seus módulos</p>
        <p className="text-sm text-muted-foreground mt-1">
          Gerencie sua carteira, acompanhe o saldo e registre ativações.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {modules.map((module) => (
            <Link
              key={module.title}
              to={module.path}
              className="group rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/50 hover:bg-muted/30"
            >
              <div className="flex items-center gap-2">
                <module.icon className="h-4 w-4 text-primary" />
                <p className="text-sm font-medium text-foreground">{module.title}</p>
                <ArrowRight className="ml-auto h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{module.description}</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
