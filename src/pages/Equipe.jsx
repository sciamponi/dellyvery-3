import React, { useState, useEffect } from 'react';
import { supabase, isSupabaseConfigured } from '@/api/supabaseClient';
import { useSupabaseAuth } from '@/lib/SupabaseAuthContext';
import {
  listMembers, updateMemberRole, deactivateMember,
  listDrivers, deactivateDriver,
  TEAM_ROLE_LABELS, TEAM_ROLE_ORDER,
} from '@/api/team';
import PageHeader from '@/components/PageHeader';
import DriverFormDialog from '@/components/team/DriverFormDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Image } from '@/components/ui/image';
import { useToast } from '@/components/ui/use-toast';
import { Plus, Search, Pencil } from 'lucide-react';

function Spinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-4 border-border border-t-primary rounded-full animate-spin" />
    </div>
  );
}

function initials(name) {
  return (name || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

export default function Equipe() {
  const { toast } = useToast();
  // FASE 5.5 B1: Equipe só existe no Supabase (sem entidade legada).
  const { user: sbUser, currentCompany: sbCompany, currentRole, loading: sbLoading } = useSupabaseAuth();
  const sbActive = isSupabaseConfigured() && !!sbUser && !!sbCompany;
  const [tab, setTab] = useState('funcionarios');
  const [members, setMembers] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [search, setSearch] = useState('');
  const [driverDialog, setDriverDialog] = useState(false);
  const [editDriver, setEditDriver] = useState(null);
  const [dataLoading, setDataLoading] = useState(true);

  const canManageMembers = currentRole === 'OWNER' || currentRole === 'ADMIN';
  const canActOn = (m) => {
    if (!canManageMembers) return false;
    // ADMIN nunca toca no OWNER (banco também bloqueia); OWNER pode tudo.
    if (currentRole === 'ADMIN' && m.role === 'OWNER') return false;
    return true;
  };
  const roleOptions = (m) => TEAM_ROLE_ORDER.filter(r => {
    if (currentRole === 'ADMIN' && r === 'OWNER') return false;
    return true;
  });

  const loadData = async () => {
    if (!sbActive) return;
    try {
      const [ms, ds] = await Promise.all([
        listMembers(supabase, sbCompany.id),
        listDrivers(supabase, sbCompany.id),
      ]);
      setMembers(ms);
      setDrivers(ds);
    } catch (err) {
      toast({ title: 'Erro ao carregar equipe', description: err?.message, variant: 'destructive' });
    } finally {
      setDataLoading(false);
    }
  };

  useEffect(() => {
    if (sbActive) loadData();
    else setDataLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sbActive, sbCompany?.id]);

  if (sbLoading || (sbActive && dataLoading)) return <Spinner />;
  if (!sbActive) {
    return (
      <div className="text-center py-16">
        <p className="font-medium text-foreground">Equipe disponível com Supabase</p>
        <p className="text-sm text-muted-foreground mt-1">Entre com sua conta Supabase para gerenciar a equipe.</p>
      </div>
    );
  }

  const filteredMembers = members.filter(m => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (m.name || '').toLowerCase().includes(q) || (m.email || '').toLowerCase().includes(q);
  });
  const filteredDrivers = drivers.filter(d => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (d.name || '').toLowerCase().includes(q) || (d.phone || '').includes(search);
  });

  const handleRoleChange = async (m, role) => {
    try {
      await updateMemberRole(supabase, m.id, role);
      setMembers(prev => prev.map(x => x.id === m.id ? { ...x, role } : x));
      toast({ title: 'Função atualizada!' });
    } catch (err) {
      toast({ title: 'Erro ao atualizar função', description: err?.message, variant: 'destructive' });
    }
  };

  const handleToggleActive = async (m) => {
    try {
      await deactivateMember(supabase, m.id, !m.active);
      setMembers(prev => prev.map(x => x.id === m.id ? { ...x, active: !x.active } : x));
      toast({ title: m.active ? 'Membro desativado' : 'Membro reativado' });
    } catch (err) {
      toast({ title: 'Erro', description: err?.message, variant: 'destructive' });
    }
  };

  const handleToggleDriver = async (d) => {
    try {
      const active = d.status !== 'ativo';
      await deactivateDriver(supabase, d.id, active);
      setDrivers(prev => prev.map(x => x.id === d.id ? { ...x, status: active ? 'ativo' : 'inativo' } : x));
    } catch (err) {
      toast({ title: 'Erro', description: err?.message, variant: 'destructive' });
    }
  };

  return (
    <div>
      <PageHeader title="Equipe" description="Funcionários e entregadores do estabelecimento">
        {tab === 'entregadores' && canManageMembers && (
          <Button onClick={() => { setEditDriver(null); setDriverDialog(true); }} className="bg-primary hover:bg-primary/90">
            <Plus className="h-4 w-4" /> Novo entregador
          </Button>
        )}
      </PageHeader>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="funcionarios">Funcionários ({members.length})</TabsTrigger>
          <TabsTrigger value="entregadores">Entregadores ({drivers.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="funcionarios" className="mt-6">
          <div className="relative flex-1 mb-6">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nome ou email..." className="pl-9" />
          </div>
          {filteredMembers.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-16">Nenhum membro encontrado.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredMembers.map(m => (
                <div key={m.id} className="rounded-2xl border border-border bg-card p-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 font-heading font-bold text-primary">
                      {initials(m.name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-heading font-semibold text-foreground truncate">
                        {m.name || 'Membro da equipe'}
                        {m.user_id === sbUser?.id && <span className="text-xs text-muted-foreground font-normal"> • você</span>}
                      </h3>
                      <p className="text-xs text-muted-foreground truncate">{m.email || '—'}</p>
                    </div>
                    <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-medium ${m.active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {m.active ? 'Ativo' : 'Inativo'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border">
                    {canActOn(m) ? (
                      <>
                        <Select value={m.role} onValueChange={v => handleRoleChange(m, v)}>
                          <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {roleOptions(m).map(r => <SelectItem key={r} value={r}>{TEAM_ROLE_LABELS[r]}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <div className="flex items-center gap-2">
                          <Switch checked={!!m.active} onCheckedChange={() => handleToggleActive(m)} />
                        </div>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">{TEAM_ROLE_LABELS[m.role] || m.role}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="entregadores" className="mt-6">
          <div className="relative flex-1 mb-6">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar entregador..." className="pl-9" />
          </div>
          {filteredDrivers.length === 0 ? (
            <div className="text-center py-16">
              <p className="font-medium text-foreground">Nenhum entregador cadastrado</p>
              <p className="text-sm text-muted-foreground mt-1">Cadastre quem faz as entregas.</p>
              {canManageMembers && (
                <Button onClick={() => { setEditDriver(null); setDriverDialog(true); }} className="mt-4 bg-primary hover:bg-primary/90">
                  <Plus className="h-4 w-4" /> Novo entregador
                </Button>
              )}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredDrivers.map(d => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => { if (canManageMembers) { setEditDriver(d); setDriverDialog(true); } }}
                  className="rounded-2xl border border-border bg-card p-4 text-left hover:shadow-md transition-shadow"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {d.photo_url ? (
                      <Image src={d.photo_url} fittingType="fill" className="h-12 w-12 rounded-xl shrink-0" alt={d.name} />
                    ) : (
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 font-heading font-bold text-primary">
                        {initials(d.name)}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <h3 className="font-heading font-semibold text-foreground truncate">{d.name}</h3>
                      <p className="text-xs text-muted-foreground">Entregador</p>
                    </div>
                    <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-medium ${d.status === 'ativo' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {d.status === 'ativo' ? '● Ativo' : '● Inativo'}
                    </span>
                  </div>
                  <div className="mt-3 space-y-1.5 text-sm text-muted-foreground">
                    {d.phone && <p className="flex items-center gap-2 truncate">📞 <span className="truncate">{d.phone}</span></p>}
                    {d.vehicle_type && <p className="flex items-center gap-2 truncate">🏍 <span className="truncate">{d.vehicle_type}</span></p>}
                    {d.vehicle_plate && <p className="flex items-center gap-2 truncate">🪪 <span className="truncate">{d.vehicle_plate}</span></p>}
                  </div>
                  {canManageMembers && (
                    <div className="flex items-center justify-between mt-3 pt-3 border-t border-border" onClick={e => e.stopPropagation()}>
                      <span className="text-xs text-muted-foreground">Ativo</span>
                      <Switch checked={d.status === 'ativo'} onCheckedChange={() => handleToggleDriver(d)} />
                      <Button variant="ghost" size="icon" onClick={() => { setEditDriver(d); setDriverDialog(true); }}>
                        <Pencil className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <DriverFormDialog
        open={driverDialog}
        onOpenChange={setDriverDialog}
        driver={editDriver}
        companyId={sbCompany?.id}
        onSaved={loadData}
      />
    </div>
  );
}
