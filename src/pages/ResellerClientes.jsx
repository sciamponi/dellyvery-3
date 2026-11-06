import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { supabase } from '@/api/supabaseClient';
import {
  RESELLER_CLIENT_STATUSES, resellerClientStatusLabel,
  listResellerClients, createResellerClient, updateResellerClient,
  createResellerClientInvite, listResellerClientInvites, revokeResellerClientInvite,
  resellerInviteStatusLabel, resellerAccountStateLabel,
  listResellerClientAccounts, getResellerClientAccount,
  updateResellerClientCompany, suspendResellerClient,
} from '@/api/resellerClients';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import {
  Ban, Building2, CalendarDays, Copy, CreditCard, Eye, History, Link2, Mail,
  MapPin, MessageCircle, Pencil, Phone, Plus, RefreshCw, Search, Store, Users,
} from 'lucide-react';

const EMPTY_FORM = {
  name: '', trade_name: '', document: '', phone: '', email: '',
  city: '', state: '', notes: '', status: 'prospecto',
};

const EMPTY_COMPANY_FORM = {
  name: '', description: '', phone: '', whatsapp: '', email: '',
  address: '', city: '', state: '', zip_code: '',
};

const STATUS_TONE = {
  prospecto: 'bg-sky-100 text-sky-800',
  ativo: 'bg-green-100 text-green-800',
  inativo: 'bg-muted text-muted-foreground',
};

const ACCOUNT_STATE_TONE = {
  active: 'bg-green-100 text-green-800',
  suspended: 'bg-red-100 text-red-800',
  expired: 'bg-amber-100 text-amber-900',
  cancelled: 'bg-muted text-muted-foreground',
  awaiting_activation: 'bg-sky-100 text-sky-800',
  unlinked: 'bg-muted text-muted-foreground',
  incomplete: 'bg-amber-100 text-amber-900',
};

const ACCOUNT_STATE_LABEL = {
  active: 'Conta ativa',
  suspended: 'Conta suspensa',
  expired: 'Conta vencida',
  cancelled: 'Conta cancelada',
  awaiting_activation: 'Aguardando ativação',
  unlinked: 'Sem conta vinculada',
  incomplete: 'Vínculo incompleto',
};

const SUBSCRIPTION_LABEL = {
  trial: 'Trial',
  ativo: 'Ativa',
  pendente: 'Pendente',
  cancelado: 'Cancelada',
  suspenso: 'Suspensa',
  expirado: 'Vencida',
};

const EVENT_LABEL = {
  reseller_client_suspended: 'Acesso suspenso',
  reseller_client_company_updated: 'Estabelecimento atualizado',
  reseller_client_link_corrected: 'Vínculo corrigido',
};

function accountState(client, invite) {
  if (client.account_state) return client.account_state;
  if (client.company_id) {
    const expires = client.access_expires_at ? new Date(client.access_expires_at) : null;
    return expires && expires.getTime() > Date.now() ? 'active' : 'expired';
  }
  if (client.has_user || client.user_id) return 'awaiting_activation';
  if (invite?.status === 'pending') return 'awaiting_activation';
  return 'unlinked';
}

function accountBadge(client, invite) {
  const state = accountState(client, invite);
  return {
    state,
    label: ACCOUNT_STATE_LABEL[state] || resellerAccountStateLabel(state),
    tone: ACCOUNT_STATE_TONE[state] || '',
  };
}

function subscriptionLabel(status) {
  return SUBSCRIPTION_LABEL[status] || status || '-';
}

function activationKindLabel(kind) {
  if (kind === 'renewal') return 'Renovação';
  if (kind === 'first_activation') return 'Ativação';
  return 'Ativação';
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('pt-BR');
}

function whatsappNumber(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.length <= 11 ? `55${digits}` : digits;
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-4 border-border border-t-primary rounded-full animate-spin" />
    </div>
  );
}

export default function ResellerClientes() {
  const outletContext = /** @type {{ reseller?: { id?: string } }} */ (useOutletContext());
  const reseller = outletContext?.reseller;
  const { toast } = useToast();
  const notify = (props) => toast({ duration: 4000, ...props });
  const navigate = useNavigate();
  const [clients, setClients] = useState([]);
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [invitingId, setInvitingId] = useState('');
  const [inviteDialog, setInviteDialog] = useState({ open: false, client: null, link: '', inviteId: null, expiresAt: null });
  const [detail, setDetail] = useState({ open: false, client: null, data: null, loading: false, error: '' });
  const [companyDialog, setCompanyDialog] = useState({ open: false, client: null, form: EMPTY_COMPANY_FORM, saving: false });
  const [suspendDialog, setSuspendDialog] = useState({ open: false, client: null, reason: '', saving: false });

  const loadInvites = async () => {
    try {
      setInvites(await listResellerClientInvites(supabase));
    } catch {
      setInvites([]);
    }
  };

  const load = async ({ silent = false } = {}) => {
    if (!reseller?.id) {
      setLoading(false);
      return;
    }
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      let clientRows;
      try {
        clientRows = await listResellerClientAccounts(supabase, reseller.id);
      } catch {
        clientRows = await listResellerClients(supabase, reseller.id);
      }
      const inviteRows = await listResellerClientInvites(supabase).catch(() => []);
      setClients(clientRows);
      setInvites(inviteRows);
    } catch (err) {
      notify({ title: 'Erro ao carregar clientes', description: err?.message, variant: 'destructive' });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reseller?.id]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((client) => [
      client.name, client.trade_name, client.phone, client.email, client.city,
      client.document, client.company_name,
    ].some((value) => String(value || '').toLowerCase().includes(q)));
  }, [clients, search]);

  const invitesByClient = useMemo(() => {
    const map = new Map();
    for (const invite of invites) {
      if (!map.has(invite.client_id)) map.set(invite.client_id, invite);
    }
    return map;
  }, [invites]);

  const openDetails = async (client) => {
    setDetail({ open: true, client, data: null, loading: true, error: '' });
    try {
      const data = await getResellerClientAccount(supabase, client.id);
      setDetail((prev) => (prev.client?.id === client.id ? { ...prev, data, loading: false } : prev));
    } catch (err) {
      setDetail((prev) => (prev.client?.id === client.id
        ? { ...prev, loading: false, error: err?.message || 'Não foi possível carregar a conta' }
        : prev));
    }
  };

  const closeDetails = () => setDetail({ open: false, client: null, data: null, loading: false, error: '' });

  const refreshDetails = async (clientId) => {
    if (!clientId) return;
    try {
      const data = await getResellerClientAccount(supabase, clientId);
      setDetail((prev) => (prev.client?.id === clientId ? { ...prev, data } : prev));
    } catch {
      // mantem os dados atuais
    }
  };

  const handleInvite = async (client) => {
    if (!client.email) {
      notify({
        title: 'E-mail obrigatório',
        description: 'Cadastre o e-mail do cliente antes de gerar o convite.',
        variant: 'destructive',
      });
      openEdit(client);
      return;
    }
    setInvitingId(client.id);
    try {
      const result = await createResellerClientInvite(supabase, client.id);
      const link = `${window.location.origin}/convite-cliente/${result.token}`;
      setInviteDialog({
        open: true,
        client,
        link,
        inviteId: result.invite_id,
        expiresAt: result.expires_at,
      });
      await loadInvites();
    } catch (err) {
      notify({ title: 'Erro ao gerar convite', description: err?.message, variant: 'destructive' });
    } finally {
      setInvitingId('');
    }
  };

  const copyInviteLink = async () => {
    try {
      await navigator.clipboard.writeText(inviteDialog.link);
      notify({ title: 'Link copiado' });
    } catch {
      notify({ title: 'Não foi possível copiar', description: 'Selecione o link e copie manualmente.', variant: 'destructive' });
    }
  };

  const sendInviteWhatsApp = () => {
    const number = whatsappNumber(inviteDialog.client?.phone);
    if (!number) return;
    const text = `Olá, ${inviteDialog.client?.name}! Você foi convidado(a) para criar sua conta na Dellyvery. Use o link: ${inviteDialog.link} (válido por 7 dias). Cadastre-se com o e-mail ${inviteDialog.client?.email}.`;
    window.open(`https://wa.me/${number}?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
  };

  const revokeInvite = async () => {
    if (!inviteDialog.inviteId) return;
    try {
      await revokeResellerClientInvite(supabase, inviteDialog.inviteId);
      notify({ title: 'Convite revogado' });
      setInviteDialog({ open: false, client: null, link: '', inviteId: null, expiresAt: null });
      await loadInvites();
    } catch (err) {
      notify({ title: 'Erro ao revogar convite', description: err?.message, variant: 'destructive' });
    }
  };

  const openNew = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (client) => {
    setEditing(client);
    setForm({
      name: client.name,
      trade_name: client.trade_name,
      document: client.document,
      phone: client.phone,
      email: client.email,
      city: client.city,
      state: client.state,
      notes: client.notes,
      status: client.status,
    });
    setDialogOpen(true);
  };

  const updateField = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const handleSave = async () => {
    setSaving(true);
    try {
      if (editing) {
        await updateResellerClient(supabase, reseller.id, editing.id, form);
        notify({ title: 'Cliente atualizado' });
      } else {
        await createResellerClient(supabase, reseller.id, form);
        notify({ title: 'Cliente criado' });
      }
      setDialogOpen(false);
      await load({ silent: true });
    } catch (err) {
      notify({ title: 'Erro ao salvar', description: err?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const goToActivation = (client) => {
    closeDetails();
    navigate(`/revenda/ativacoes?cliente=${client.id}`);
  };

  const openCompanyDialog = (client, details) => {
    const company = details?.company || {};
    setCompanyDialog({
      open: true,
      client,
      saving: false,
      form: {
        name: company.name || client.name || '',
        description: company.description || '',
        phone: company.phone || client.phone || '',
        whatsapp: company.whatsapp || '',
        email: company.email || client.email || '',
        address: company.address || '',
        city: company.city || client.city || '',
        state: company.state || client.state || '',
        zip_code: company.zip_code || '',
      },
    });
  };

  const updateCompanyField = (field, value) => setCompanyDialog((prev) => ({
    ...prev,
    form: { ...prev.form, [field]: value },
  }));

  const handleCompanySave = async () => {
    const client = companyDialog.client;
    if (!client?.id) return;
    setCompanyDialog((prev) => ({ ...prev, saving: true }));
    try {
      const result = await updateResellerClientCompany(supabase, client.id, companyDialog.form);
      notify({ title: 'Estabelecimento atualizado' });
      setCompanyDialog({ open: false, client: null, form: EMPTY_COMPANY_FORM, saving: false });
      await load({ silent: true });
      if (result?.account) {
        setDetail((prev) => (prev.client?.id === client.id ? { ...prev, data: result.account } : prev));
      } else {
        await refreshDetails(client.id);
      }
    } catch (err) {
      notify({ title: 'Erro ao editar estabelecimento', description: err?.message, variant: 'destructive' });
      setCompanyDialog((prev) => ({ ...prev, saving: false }));
    }
  };

  const openSuspendDialog = (client) => {
    setSuspendDialog({ open: true, client, reason: '', saving: false });
  };

  const handleSuspend = async () => {
    const client = suspendDialog.client;
    if (!client?.id) return;
    setSuspendDialog((prev) => ({ ...prev, saving: true }));
    try {
      const result = await suspendResellerClient(supabase, client.id, suspendDialog.reason);
      notify({
        title: 'Acesso suspenso',
        description: 'Os dados foram mantidos. A reativação é feita por uma nova renovação.',
      });
      setSuspendDialog({ open: false, client: null, reason: '', saving: false });
      await load({ silent: true });
      if (result?.account) {
        setDetail((prev) => (prev.client?.id === client.id ? { ...prev, data: result.account } : prev));
      }
    } catch (err) {
      notify({ title: 'Erro ao suspender acesso', description: err?.message, variant: 'destructive' });
      setSuspendDialog((prev) => ({ ...prev, saving: false }));
    }
  };

  if (loading) return <Spinner />;

  return (
    <div>
      <PageHeader
        title="Clientes"
        description="Estabelecimentos indicados e acompanhados por você"
      >
        <Button variant="outline" onClick={() => load({ silent: true })} disabled={refreshing}>
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> Atualizar
        </Button>
        <Button onClick={openNew}>
          <Plus className="h-4 w-4" /> Novo cliente
        </Button>
      </PageHeader>

      <div className="relative mb-5">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar por nome, telefone, e-mail, cidade ou empresa"
          className="pl-9"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
            <Users className="h-8 w-8 text-muted-foreground" />
          </div>
          <p className="font-medium text-foreground">
            {search ? 'Nenhum cliente encontrado' : 'Nenhum cliente cadastrado'}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            {search ? 'Tente ajustar a busca.' : 'Cadastre o primeiro estabelecimento da sua carteira.'}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((client) => {
            const invite = invitesByClient.get(client.id);
            const access = accountBadge(client, invite);
            const hasCompany = Boolean(client.company_id);
            const hasUser = Boolean(client.has_user || client.user_id);
            return (
              <div
                key={client.id}
                role="button"
                tabIndex={0}
                onClick={() => openDetails(client)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openDetails(client);
                  }
                }}
                className="rounded-2xl border border-border bg-card p-4 cursor-pointer transition-colors hover:border-primary/50"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-heading font-bold text-foreground truncate">{client.name}</p>
                    {client.trade_name && (
                      <p className="text-xs text-muted-foreground truncate">{client.trade_name}</p>
                    )}
                  </div>
                  <Badge className={STATUS_TONE[client.status] || ''}>
                    {resellerClientStatusLabel(client.status)}
                  </Badge>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge className={access.tone}>{access.label}</Badge>
                  {hasCompany && client.company_active === false && (
                    <Badge className="bg-amber-100 text-amber-900">Empresa desativada</Badge>
                  )}
                  {invite?.status === 'accepted' && !hasUser && (
                    <Badge className="bg-green-100 text-green-800">{resellerInviteStatusLabel(invite.status)}</Badge>
                  )}
                </div>

                <div className="mt-3 space-y-1.5 text-sm text-muted-foreground">
                  {hasCompany && client.company_name && (
                    <p className="flex items-center gap-2 truncate">
                      <Store className="h-3.5 w-3.5 shrink-0" /> {client.company_name}
                    </p>
                  )}
                  {!hasCompany && (
                    <p className="flex items-center gap-2 truncate">
                      <Store className="h-3.5 w-3.5 shrink-0" /> Sem conta real vinculada
                    </p>
                  )}
                  {client.phone && (
                    <p className="flex items-center gap-2 truncate">
                      <Phone className="h-3.5 w-3.5 shrink-0" /> {client.phone}
                    </p>
                  )}
                  {client.email && (
                    <p className="flex items-center gap-2 truncate">
                      <Mail className="h-3.5 w-3.5 shrink-0" /> {client.email}
                    </p>
                  )}
                  {(client.city || client.state) && (
                    <p className="flex items-center gap-2 truncate">
                      <MapPin className="h-3.5 w-3.5 shrink-0" />
                      {[client.city, client.state].filter(Boolean).join(' - ')}
                    </p>
                  )}
                  {hasCompany && client.subscription_expires_at && (
                    <p className="flex items-center gap-2 truncate">
                      <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                      Vence em {formatDateTime(client.subscription_expires_at)}
                    </p>
                  )}
                  {client.document && (
                    <p className="flex items-center gap-2 truncate">
                      <Building2 className="h-3.5 w-3.5 shrink-0" /> {client.document}
                    </p>
                  )}
                </div>

                {client.notes && (
                  <p className="mt-3 line-clamp-2 text-xs text-muted-foreground">{client.notes}</p>
                )}

                <div
                  className="mt-4 flex flex-wrap gap-2 border-t border-border pt-3"
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  <Button variant="outline" size="sm" onClick={() => openDetails(client)}>
                    <Eye className="h-4 w-4" /> Detalhes
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => openEdit(client)}>
                    <Pencil className="h-4 w-4" /> Editar
                  </Button>
                  {!hasUser && !hasCompany && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleInvite(client)}
                      disabled={invitingId === client.id}
                    >
                      <Link2 className="h-4 w-4" />
                      {invitingId === client.id ? 'Gerando...' : invite?.status === 'pending' ? 'Novo link' : 'Convidar'}
                    </Button>
                  )}
                  {hasUser && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => goToActivation(client)}
                    >
                      <CreditCard className="h-4 w-4" /> {hasCompany ? 'Renovar' : 'Ativar'}
                    </Button>
                  )}
                  {hasCompany && access.state === 'active' && (
                    <Button variant="outline" size="sm" onClick={() => openSuspendDialog(client)}>
                      <Ban className="h-4 w-4" /> Suspender
                    </Button>
                  )}
                  {hasCompany && ['suspended', 'expired', 'cancelled'].includes(access.state) && (
                    <Button variant="secondary" size="sm" onClick={() => goToActivation(client)}>
                      <RefreshCw className="h-4 w-4" /> Reativar
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog
        open={inviteDialog.open}
        onOpenChange={(open) => {
          if (!open) setInviteDialog({ open: false, client: null, link: '', inviteId: null, expiresAt: null });
        }}
      >
        <DialogContent className="w-[calc(100vw-2rem)] max-w-lg">
          <DialogHeader>
            <DialogTitle>Convite de {inviteDialog.client?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Envie o link para <strong>{inviteDialog.client?.email}</strong>. O cliente cria a própria senha e
              o acesso só é liberado depois da ativação por você.
            </p>
            <div className="space-y-1.5">
              <Label>Link do convite</Label>
              <div className="flex gap-2">
                <Input readOnly value={inviteDialog.link} className="font-mono text-xs" />
                <Button variant="outline" size="icon" onClick={copyInviteLink} aria-label="Copiar link">
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
            {inviteDialog.expiresAt && (
              <p className="text-xs text-muted-foreground">
                Válido até {formatDateTime(inviteDialog.expiresAt)}.
                Por segurança, o link não será exibido novamente.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={copyInviteLink}>
                <Copy className="h-4 w-4" /> Copiar link
              </Button>
              {whatsappNumber(inviteDialog.client?.phone) && (
                <Button onClick={sendInviteWhatsApp}>
                  <MessageCircle className="h-4 w-4" /> Enviar no WhatsApp
                </Button>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={revokeInvite} disabled={!inviteDialog.inviteId}>
              Revogar convite
            </Button>
            <Button
              variant="outline"
              onClick={() => setInviteDialog({ open: false, client: null, link: '', inviteId: null, expiresAt: null })}
            >
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar cliente' : 'Novo cliente'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="client-name">Nome</Label>
              <Input
                id="client-name"
                value={form.name}
                onChange={(event) => updateField('name', event.target.value)}
                placeholder="Ex.: Cantina da Praca"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="client-trade">Nome fantasia</Label>
                <Input
                  id="client-trade"
                  value={form.trade_name}
                  onChange={(event) => updateField('trade_name', event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="client-document">CPF/CNPJ</Label>
                <Input
                  id="client-document"
                  value={form.document}
                  onChange={(event) => updateField('document', event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="client-phone">Telefone</Label>
                <Input
                  id="client-phone"
                  inputMode="tel"
                  value={form.phone}
                  onChange={(event) => updateField('phone', event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="client-email">E-mail</Label>
                <Input
                  id="client-email"
                  type="email"
                  value={form.email}
                  onChange={(event) => updateField('email', event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="client-city">Cidade</Label>
                <Input
                  id="client-city"
                  value={form.city}
                  onChange={(event) => updateField('city', event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="client-state">UF</Label>
                <Input
                  id="client-state"
                  maxLength={2}
                  value={form.state}
                  onChange={(event) => updateField('state', event.target.value.toUpperCase())}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(value) => updateField('status', value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RESELLER_CLIENT_STATUSES.map((status) => (
                    <SelectItem key={status.id} value={status.id}>{status.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="client-notes">Observações</Label>
              <Textarea
                id="client-notes"
                rows={3}
                value={form.notes}
                onChange={(event) => updateField('notes', event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Salvando...' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={detail.open} onOpenChange={(open) => { if (!open) closeDetails(); }}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Conta de {detail.client?.name}</DialogTitle>
          </DialogHeader>

          {detail.loading ? (
            <Spinner />
          ) : detail.error ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
              {detail.error}
            </div>
          ) : detail.data ? (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={ACCOUNT_STATE_TONE[detail.data.account_state] || ''}>
                  {ACCOUNT_STATE_LABEL[detail.data.account_state] || resellerAccountStateLabel(detail.data.account_state)}
                </Badge>
                <Badge className={STATUS_TONE[detail.data.client?.status] || ''}>
                  {resellerClientStatusLabel(detail.data.client?.status)}
                </Badge>
                {detail.data.company?.active === false && (
                  <Badge className="bg-amber-100 text-amber-900">Empresa desativada</Badge>
                )}
              </div>

              <section className="rounded-xl border border-border p-4">
                <h3 className="flex items-center gap-2 font-heading font-bold text-foreground">
                  <Store className="h-4 w-4" /> Conta real vinculada
                </h3>
                {detail.data.company ? (
                  <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                    <p><span className="text-muted-foreground">Empresa:</span> {detail.data.company.name}</p>
                    <p><span className="text-muted-foreground">Identificador:</span> {detail.data.company.slug || '-'}</p>
                    <p><span className="text-muted-foreground">Plano:</span> {detail.data.subscription?.plan_name || '-'}</p>
                    <p><span className="text-muted-foreground">Assinatura:</span> {subscriptionLabel(detail.data.subscription?.status)}</p>
                    <p><span className="text-muted-foreground">Validade:</span> {formatDateTime(detail.data.subscription?.expires_at)}</p>
                    <p><span className="text-muted-foreground">Ativado em:</span> {formatDateTime(detail.data.client?.activated_at)}</p>
                    <p><span className="text-muted-foreground">Usuário:</span> {detail.data.client?.has_user ? 'Vinculado' : 'Não vinculado'}</p>
                    <p><span className="text-muted-foreground">Dias por crédito:</span> {detail.data.subscription?.access_days || '-'}</p>
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Este cliente ainda não possui empresa vinculada. Envie o convite e faça a ativação para criar a conta real.
                  </p>
                )}
              </section>

              <section className="rounded-xl border border-border p-4">
                <h3 className="flex items-center gap-2 font-heading font-bold text-foreground">
                  <Building2 className="h-4 w-4" /> Estabelecimento
                </h3>
                <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                  <p><span className="text-muted-foreground">Telefone:</span> {detail.data.company?.phone || detail.data.client?.phone || '-'}</p>
                  <p><span className="text-muted-foreground">E-mail:</span> {detail.data.company?.email || detail.data.client?.email || '-'}</p>
                  <p><span className="text-muted-foreground">Endereço:</span> {detail.data.company?.address || '-'}</p>
                  <p><span className="text-muted-foreground">Cidade/UF:</span> {[detail.data.company?.city || detail.data.client?.city, detail.data.company?.state || detail.data.client?.state].filter(Boolean).join(' - ') || '-'}</p>
                </div>
              </section>

              <section className="rounded-xl border border-border p-4">
                <h3 className="flex items-center gap-2 font-heading font-bold text-foreground">
                  <History className="h-4 w-4" /> Histórico de ativações
                </h3>
                {(detail.data.activation_history || []).length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">Nenhuma ativação registrada.</p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {detail.data.activation_history.map((item) => (
                      <div key={item.id} className="rounded-lg bg-muted/40 p-3 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-medium text-foreground">
                            {activationKindLabel(item.kind)} · {item.plan_name || 'Plano'}
                          </p>
                          <Badge className={item.status === 'ativa' ? 'bg-green-100 text-green-800' : 'bg-muted text-muted-foreground'}>
                            {item.status === 'ativa' ? 'Ativa' : item.status || '-'}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {item.credits} crédito{item.credits === 1 ? '' : 's'}
                          {item.access_days ? ` · ${item.access_days} dias` : ''}
                          {item.new_expires_at ? ` · até ${formatDateTime(item.new_expires_at)}` : ''}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Registrada em {formatDateTime(item.created_at)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {(detail.data.recent_events || []).length > 0 && (
                <section className="rounded-xl border border-border p-4">
                  <h3 className="flex items-center gap-2 font-heading font-bold text-foreground">
                    <CalendarDays className="h-4 w-4" /> Últimos eventos
                  </h3>
                  <div className="mt-3 space-y-1.5 text-sm">
                    {detail.data.recent_events.map((event, index) => (
                      <p key={`${event.action}-${event.created_at}-${index}`} className="text-muted-foreground">
                        <span className="text-foreground">{EVENT_LABEL[event.action] || event.action}</span>
                        {' · '}{formatDateTime(event.created_at)}
                        {event.metadata?.reason ? ` · ${event.metadata.reason}` : ''}
                      </p>
                    ))}
                  </div>
                </section>
              )}

              <DialogFooter className="flex-wrap gap-2">
                {detail.data.permissions?.can_edit_company && (
                  <Button
                    variant="outline"
                    onClick={() => openCompanyDialog(detail.client, detail.data)}
                  >
                    <Pencil className="h-4 w-4" /> Editar estabelecimento
                  </Button>
                )}
                {detail.data.permissions?.can_activate && (
                  <Button variant="secondary" onClick={() => goToActivation(detail.client)}>
                    <CreditCard className="h-4 w-4" />
                    {detail.data.client?.company_linked ? 'Renovar' : 'Ativar'}
                  </Button>
                )}
                {detail.data.permissions?.can_suspend && detail.data.account_state === 'active' && (
                  <Button variant="outline" onClick={() => openSuspendDialog(detail.client)}>
                    <Ban className="h-4 w-4" /> Suspender acesso
                  </Button>
                )}
                {detail.data.permissions?.can_reactivate && detail.data.account_state !== 'active' && (
                  <Button variant="secondary" onClick={() => goToActivation(detail.client)}>
                    <RefreshCw className="h-4 w-4" /> Reativar
                  </Button>
                )}
                <Button variant="ghost" onClick={closeDetails}>Fechar</Button>
              </DialogFooter>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={companyDialog.open}
        onOpenChange={(open) => {
          if (!open) setCompanyDialog({ open: false, client: null, form: EMPTY_COMPANY_FORM, saving: false });
        }}
      >
        <DialogContent className="w-[calc(100vw-2rem)] max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar estabelecimento</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="company-name">Nome</Label>
              <Input
                id="company-name"
                value={companyDialog.form.name}
                onChange={(event) => updateCompanyField('name', event.target.value)}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="company-phone">Telefone</Label>
                <Input
                  id="company-phone"
                  inputMode="tel"
                  value={companyDialog.form.phone}
                  onChange={(event) => updateCompanyField('phone', event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="company-whatsapp">WhatsApp</Label>
                <Input
                  id="company-whatsapp"
                  inputMode="tel"
                  value={companyDialog.form.whatsapp}
                  onChange={(event) => updateCompanyField('whatsapp', event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="company-email">E-mail</Label>
                <Input
                  id="company-email"
                  type="email"
                  value={companyDialog.form.email}
                  onChange={(event) => updateCompanyField('email', event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="company-zip">CEP</Label>
                <Input
                  id="company-zip"
                  value={companyDialog.form.zip_code}
                  onChange={(event) => updateCompanyField('zip_code', event.target.value)}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="company-address">Endereço</Label>
                <Input
                  id="company-address"
                  value={companyDialog.form.address}
                  onChange={(event) => updateCompanyField('address', event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="company-city">Cidade</Label>
                <Input
                  id="company-city"
                  value={companyDialog.form.city}
                  onChange={(event) => updateCompanyField('city', event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="company-state">UF</Label>
                <Input
                  id="company-state"
                  maxLength={2}
                  value={companyDialog.form.state}
                  onChange={(event) => updateCompanyField('state', event.target.value.toUpperCase())}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="company-description">Descrição</Label>
              <Textarea
                id="company-description"
                rows={3}
                value={companyDialog.form.description}
                onChange={(event) => updateCompanyField('description', event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCompanyDialog({ open: false, client: null, form: EMPTY_COMPANY_FORM, saving: false })}
              disabled={companyDialog.saving}
            >
              Cancelar
            </Button>
            <Button onClick={handleCompanySave} disabled={companyDialog.saving}>
              {companyDialog.saving ? 'Salvando...' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={suspendDialog.open}
        onOpenChange={(open) => {
          if (!open) setSuspendDialog({ open: false, client: null, reason: '', saving: false });
        }}
      >
        <DialogContent className="w-[calc(100vw-2rem)] max-w-lg">
          <DialogHeader>
            <DialogTitle>Suspender acesso de {suspendDialog.client?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              O acesso operacional será bloqueado, mas os dados do estabelecimento, a assinatura e o vínculo
              serão mantidos. A reativação é feita por uma nova renovação com crédito.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="suspend-reason">Motivo (opcional)</Label>
              <Textarea
                id="suspend-reason"
                rows={3}
                maxLength={500}
                value={suspendDialog.reason}
                onChange={(event) => setSuspendDialog((prev) => ({ ...prev, reason: event.target.value }))}
                placeholder="Ex.: inadimplência, solicitação do cliente"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSuspendDialog({ open: false, client: null, reason: '', saving: false })}
              disabled={suspendDialog.saving}
            >
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleSuspend} disabled={suspendDialog.saving}>
              {suspendDialog.saving ? 'Suspendendo...' : 'Suspender acesso'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
