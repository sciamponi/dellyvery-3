import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { supabase } from '@/api/supabaseClient';
import {
  RESELLER_CLIENT_STATUSES, resellerClientStatusLabel,
  listResellerClients, createResellerClient, updateResellerClient,
  createResellerClientInvite, listResellerClientInvites, revokeResellerClientInvite,
  resellerInviteStatusLabel,
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
  Building2, Copy, CreditCard, Link2, Mail, MapPin, MessageCircle, Pencil, Phone, Plus, Search, Users,
} from 'lucide-react';

const EMPTY_FORM = {
  name: '', trade_name: '', document: '', phone: '', email: '',
  city: '', state: '', notes: '', status: 'prospecto',
};

const STATUS_TONE = {
  prospecto: 'bg-sky-100 text-sky-800',
  ativo: 'bg-green-100 text-green-800',
  inativo: 'bg-muted text-muted-foreground',
};

function clientAccessState(client, invite) {
  if (client.company_id) {
    const expires = client.access_expires_at ? new Date(client.access_expires_at) : null;
    if (expires && expires.getTime() > Date.now()) {
      return { label: 'Acesso ativo', tone: 'bg-green-100 text-green-800' };
    }
    return { label: 'Acesso vencido', tone: 'bg-amber-100 text-amber-900' };
  }
  if (client.user_id) {
    return { label: 'Aguardando ativação', tone: 'bg-sky-100 text-sky-800' };
  }
  if (invite?.status === 'pending') {
    return { label: 'Convite pendente', tone: 'bg-sky-100 text-sky-800' };
  }
  if (invite?.status === 'expired') {
    return { label: 'Convite expirado', tone: 'bg-amber-100 text-amber-900' };
  }
  return { label: 'Sem convite', tone: 'bg-muted text-muted-foreground' };
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
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [invitingId, setInvitingId] = useState('');
  const [inviteDialog, setInviteDialog] = useState({ open: false, client: null, link: '', inviteId: null, expiresAt: null });

  const loadInvites = async () => {
    try {
      setInvites(await listResellerClientInvites(supabase));
    } catch {
      setInvites([]);
    }
  };

  const load = async () => {
    if (!reseller?.id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [clientRows, inviteRows] = await Promise.all([
        listResellerClients(supabase, reseller.id),
        listResellerClientInvites(supabase).catch(() => []),
      ]);
      setClients(clientRows);
      setInvites(inviteRows);
    } catch (err) {
      notify({ title: 'Erro ao carregar clientes', description: err?.message, variant: 'destructive' });
    } finally {
      setLoading(false);
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
      client.name, client.trade_name, client.phone, client.email, client.city, client.document,
    ].some((value) => String(value || '').toLowerCase().includes(q)));
  }, [clients, search]);

  const invitesByClient = useMemo(() => {
    const map = new Map();
    for (const invite of invites) {
      if (!map.has(invite.client_id)) map.set(invite.client_id, invite);
    }
    return map;
  }, [invites]);

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
      await load();
    } catch (err) {
      notify({ title: 'Erro ao salvar', description: err?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Spinner />;

  return (
    <div>
      <PageHeader
        title="Clientes"
        description="Estabelecimentos indicados e acompanhados por você"
      >
        <Button onClick={openNew}>
          <Plus className="h-4 w-4" /> Novo cliente
        </Button>
      </PageHeader>

      <div className="relative mb-5">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar por nome, telefone, e-mail ou cidade"
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
            const access = clientAccessState(client, invite);
            const hasCompany = Boolean(client.company_id);
            return (
              <div key={client.id} className="rounded-2xl border border-border bg-card p-4">
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
                  {invite?.status === 'accepted' && !client.user_id && (
                    <Badge className="bg-green-100 text-green-800">{resellerInviteStatusLabel(invite.status)}</Badge>
                  )}
                </div>

                <div className="mt-3 space-y-1.5 text-sm text-muted-foreground">
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
                  {client.document && (
                    <p className="flex items-center gap-2 truncate">
                      <Building2 className="h-3.5 w-3.5 shrink-0" /> {client.document}
                    </p>
                  )}
                </div>

                {client.notes && (
                  <p className="mt-3 line-clamp-2 text-xs text-muted-foreground">{client.notes}</p>
                )}

                <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-3">
                  <Button variant="outline" size="sm" onClick={() => openEdit(client)}>
                    <Pencil className="h-4 w-4" /> Editar
                  </Button>
                  {!client.user_id && !hasCompany && (
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
                  {client.user_id && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => navigate(`/revenda/ativacoes?cliente=${client.id}`)}
                      disabled={!client.user_id}
                    >
                      <CreditCard className="h-4 w-4" /> {hasCompany ? 'Renovar' : 'Ativar'}
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
                Válido até {new Date(inviteDialog.expiresAt).toLocaleString('pt-BR')}.
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
    </div>
  );
}
