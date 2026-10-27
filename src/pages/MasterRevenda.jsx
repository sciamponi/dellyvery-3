import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/api/supabaseClient';
import { useSupabaseAuth } from '@/lib/SupabaseAuthContext';
import { isPlatformAdmin } from '@/api/plans';
import {
  RESELLER_PRODUCT, RESELLER_MODALITY,
  resellerStatusLabel, allowedResellerTransitions,
  buildResellerInviteLink, buildResellerInviteUrl,
  listResellerInvites, createResellerInvite, updateResellerInvite,
  sweepExpiredInvites,
} from '@/api/resellers';
import PageHeader from '@/components/PageHeader';
import ConfirmDialog from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import {
  ShieldAlert, RefreshCw, UserPlus, MessageCircle, ChevronDown,
  Check, X, Pause, RotateCcw, Pencil, Copy, ExternalLink, AlertTriangle,
} from 'lucide-react';

function Spinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-4 border-border border-t-primary rounded-full animate-spin" />
    </div>
  );
}

const TABS = [
  { id: 'visao', label: 'Visão geral' },
  { id: 'revendedores', label: 'Revendedores' },
  { id: 'pendentes', label: 'Aguardando aprovação' },
];

const STATUS_TONE = {
  criado: 'bg-sky-100 text-sky-800',
  enviado: 'bg-sky-100 text-sky-800',
  aguardando_aprovacao: 'bg-amber-100 text-amber-900',
  aprovado: 'bg-green-100 text-green-800',
  recusado: 'bg-red-100 text-red-800',
  suspenso: 'bg-orange-100 text-orange-800',
  expirado: 'bg-muted text-muted-foreground',
  revogado: 'bg-muted text-muted-foreground',
};

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR');
}

function fmtPhone(digits) {
  const d = String(digits || '').replace(/\D/g, '');
  return d ? `+${d}` : '—';
}

export default function MasterRevenda() {
  const { toast } = useToast();
  const notify = (props) => toast({ duration: 4000, ...props });
  const { user: sbUser } = useSupabaseAuth();
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [invites, setInvites] = useState([]);
  const [tab, setTab] = useState('visao');
  const [expanded, setExpanded] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);

  // Modal de convite (criar ou editar pré-inscrição).
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [inviteName, setInviteName] = useState('');
  const [invitePhone, setInvitePhone] = useState('');
  const [created, setCreated] = useState(null); // { token, link, invite }

  // Confirmação de transição (aprovar/recusar/suspender/...).
  const [confirm, setConfirm] = useState(null); // { invite, to }

  const load = async () => {
    setLoadError('');
    try {
      // Marca expirados em transação própria antes de listar.
      await sweepExpiredInvites(supabase).catch(() => null);
      setInvites(await listResellerInvites(supabase, {}));
    } catch (err) {
      setLoadError(err?.message || 'Não foi possível carregar os convites.');
    }
  };

  useEffect(() => {
    const init = async () => {
      try {
        const admin = await isPlatformAdmin(supabase, sbUser?.id);
        setIsAdmin(admin);
        if (admin) await load();
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    };
    init();
  }, [sbUser?.id]);

  const stats = useMemo(() => {
    const count = (ids) => invites.filter((i) => ids.includes(i.status)).length;
    return {
      pendentes: count(['aguardando_aprovacao']),
      aprovados: count(['aprovado']),
      convites: count(['criado', 'enviado']),
      total: invites.length,
    };
  }, [invites]);

  const pending = useMemo(
    () => invites.filter((i) => i.status === 'aguardando_aprovacao'),
    [invites],
  );

  if (loading) return <Spinner />;

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <ShieldAlert className="h-12 w-12 text-destructive mb-4" />
        <h2 className="font-heading text-xl font-bold text-foreground">Acesso restrito</h2>
        <p className="text-muted-foreground mt-1">Esta área é exclusiva do administrador master.</p>
      </div>
    );
  }

  const openNewInvite = () => {
    setEditing(null);
    setInviteName('');
    setInvitePhone('');
    setCreated(null);
    setInviteOpen(true);
  };

  const openEditInvite = (invite) => {
    setEditing(invite);
    setInviteName(invite.name || '');
    setInvitePhone(invite.phone || '');
    setCreated(null);
    setInviteOpen(true);
  };

  const handleCreateInvite = async () => {
    setSaving(true);
    try {
      const out = await createResellerInvite(supabase, { name: inviteName, phone: invitePhone });
      const link = buildResellerInviteLink(window.location.origin, out.token);
      setCreated({ inviteId: out.invite_id, token: out.token, link, reused: out.reused });
      if (out.reused) {
        notify({ title: 'Convite ativo reutilizado (sem duplicar)' });
      } else {
        notify({ title: 'Convite criado!' });
      }
      await load();
    } catch (err) {
      notify({ title: 'Erro ao criar convite', description: err?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await updateResellerInvite(supabase, editing.id,
        { name: inviteName, phone: invitePhone },
        { action: 'convite_editado' }, sbUser?.id);
      notify({ title: 'Convite atualizado!' });
      setInviteOpen(false);
      await load();
    } catch (err) {
      notify({ title: 'Erro ao salvar', description: err?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleOpenWhatsApp = async (invite) => {
    try {
      // Token vem da linha (listagem admin RLS) ou do convite recém-criado.
      const full = invites.find((i) => i.id === invite.id) || invite;
      const token = full.token || (created?.inviteId === full.id ? created.token : null);
      if (!token) throw new Error('Convite sem token disponível. Crie um novo convite.');
      const link = buildResellerInviteLink(window.location.origin, token);
      const url = buildResellerInviteUrl({ phone: full.phone, name: full.name, link });
      window.open(url, '_blank', 'noopener');
      // "Enviado" = WhatsApp aberto com mensagem pronta (entrega manual,
      // não confirmada pelo sistema).
      if (full.status === 'criado') {
        await updateResellerInvite(supabase, full.id,
          { status: 'enviado', sent_at: new Date().toISOString() },
          { action: 'whatsapp_aberto' }, sbUser?.id);
        await load();
      }
    } catch (err) {
      notify({ title: 'WhatsApp', description: err?.message, variant: 'destructive' });
    }
  };

  const handleCopyLink = async () => {
    if (!created?.link) return;
    try {
      await navigator.clipboard.writeText(created.link);
      notify({ title: 'Link copiado!' });
    } catch {
      notify({ title: 'Não foi possível copiar', description: created.link, variant: 'destructive' });
    }
  };

  const askTransition = (invite, to) => setConfirm({ invite, to });

  const handleConfirmTransition = async () => {
    if (!confirm) return;
    const { invite, to } = confirm;
    setSaving(true);
    try {
      const patch = { status: to };
      if (['aprovado', 'recusado'].includes(to)) patch.decided_at = new Date().toISOString();
      await updateResellerInvite(supabase, invite.id, patch,
        { action: to, detail: { de: invite.status } }, sbUser?.id);
      notify({ title: `${resellerStatusLabel(to)}!` });
      setConfirm(null);
      await load();
    } catch (err) {
      notify({ title: 'Erro', description: err?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const renderActions = (invite) => {
    const allowed = allowedResellerTransitions(invite.status);
    return (
      <div className="mt-3 flex flex-wrap gap-1.5">
        {invite.status === 'aguardando_aprovacao' && (
          <>
            <Button size="sm" className="h-8 text-xs" onClick={() => askTransition(invite, 'aprovado')}>
              <Check className="h-3.5 w-3.5" /> Aprovar
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => askTransition(invite, 'recusado')}>
              <X className="h-3.5 w-3.5" /> Recusar
            </Button>
          </>
        )}
        {invite.status === 'aprovado' && (
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => askTransition(invite, 'suspenso')}>
            <Pause className="h-3.5 w-3.5" /> Suspender
          </Button>
        )}
        {invite.status === 'suspenso' && (
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => askTransition(invite, 'aprovado')}>
            <RotateCcw className="h-3.5 w-3.5" /> Reativar
          </Button>
        )}
        {['criado', 'enviado'].includes(invite.status) && (
          <>
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => handleOpenWhatsApp(invite)}>
              <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
            </Button>
            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => openEditInvite(invite)}>
              <Pencil className="h-3.5 w-3.5" /> Editar
            </Button>
            {allowed.includes('revogado') && (
              <Button size="sm" variant="ghost" className="h-8 text-xs text-destructive" onClick={() => askTransition(invite, 'revogado')}>
                <X className="h-3.5 w-3.5" /> Revogar
              </Button>
            )}
          </>
        )}
        <Button variant="outline" size="sm" className="h-8" onClick={() => setExpanded(expanded === invite.id ? null : invite.id)}>
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded === invite.id ? 'rotate-180' : ''}`} />
        </Button>
      </div>
    );
  };

  const renderCard = (invite) => {
    const isOpen = expanded === invite.id;
    const reg = invite.registration || {};
    return (
      <div key={invite.id} className="rounded-2xl border border-border bg-card p-4 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-heading font-bold text-foreground truncate">{invite.name || 'Sem nome'}</p>
            <p className="text-xs text-muted-foreground truncate">{fmtPhone(invite.phone)}</p>
          </div>
          <Badge className={`shrink-0 ${STATUS_TONE[invite.status] || ''}`}>{resellerStatusLabel(invite.status)}</Badge>
        </div>
        <div className="mt-2 space-y-1 text-xs text-muted-foreground">
          <p>{RESELLER_PRODUCT.label} • {RESELLER_MODALITY.label}</p>
          <p>Convite em {fmtDate(invite.created_at)}{invite.claimed_at ? ` • Inscrição em ${fmtDate(invite.claimed_at)}` : ''}</p>
        </div>
        {isOpen && (
          <dl className="mt-2 rounded-xl bg-muted/50 p-3 space-y-1 text-xs">
            {reg.email && <div className="flex justify-between gap-2"><dt className="text-muted-foreground">E-mail</dt><dd className="font-medium text-right break-all">{reg.email}</dd></div>}
            {reg.document && <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Documento</dt><dd className="font-medium text-right">{reg.document}</dd></div>}
            {(reg.city || reg.state) && <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Cidade/UF</dt><dd className="font-medium text-right">{[reg.city, reg.state].filter(Boolean).join(' • ')}</dd></div>}
            {reg.notes && <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Observações</dt><dd className="font-medium text-right">{reg.notes}</dd></div>}
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Produto</dt><dd className="font-medium text-right">{RESELLER_PRODUCT.label}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Modalidade</dt><dd className="font-medium text-right">{RESELLER_MODALITY.label}</dd></div>
            {invite.decided_at && <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Decisão em</dt><dd className="font-medium text-right">{fmtDate(invite.decided_at)}</dd></div>}
            {invite.events?.length > 0 && (
              <div className="pt-1 space-y-0.5">
                <dt className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider">Histórico</dt>
                {invite.events.slice().reverse().map((ev, i) => (
                  <p key={i} className="text-muted-foreground">
                    {ev.at ? new Date(ev.at).toLocaleString('pt-BR') : ''} — {resellerStatusLabel(ev.action) !== ev.action ? resellerStatusLabel(ev.action) : ev.action}
                  </p>
                ))}
              </div>
            )}
          </dl>
        )}
        {renderActions(invite)}
      </div>
    );
  };

  return (
    <div>
      <PageHeader title="Revenda" description="Gerenciamento de parceiros e convites">
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => load()}>
            <RefreshCw className="h-3.5 w-3.5" /> Atualizar
          </Button>
          <Button size="sm" className="h-8 text-xs" onClick={openNewInvite}>
            <UserPlus className="h-3.5 w-3.5" /> Convidar
          </Button>
        </div>
      </PageHeader>

      <div className="flex flex-wrap gap-1.5 mb-4">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-full px-3 h-8 text-xs font-medium transition-colors ${
              tab === t.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
            }`}
          >
            {t.label}{t.id === 'pendentes' && pending.length > 0 ? ` (${pending.length})` : ''}
          </button>
        ))}
      </div>

      {loadError && (
        <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 mb-4 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{loadError}</span>
          <Button variant="outline" size="sm" className="ml-auto" onClick={() => load()}>Tentar de novo</Button>
        </div>
      )}

      {tab === 'visao' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { label: 'Aguard. aprovação', value: stats.pendentes },
              { label: 'Aprovados', value: stats.aprovados },
              { label: 'Convites ativos', value: stats.convites },
              { label: 'Total', value: stats.total },
            ].map((s) => (
              <div key={s.label} className="rounded-2xl border border-border bg-card p-3 text-center">
                <p className="font-heading text-xl font-bold text-foreground">{s.value}</p>
                <p className="text-[11px] text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>
          <div>
            <h3 className="font-heading text-sm font-semibold text-foreground mb-2">Pendentes de análise</h3>
            {pending.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma inscrição aguardando aprovação.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {pending.map(renderCard)}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'revendedores' && (
        invites.length === 0 ? (
          <p className="text-sm text-muted-foreground py-10 text-center">Nenhum parceiro ou convite registrado.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {invites.map(renderCard)}
          </div>
        )
      )}

      {tab === 'pendentes' && (
        pending.length === 0 ? (
          <p className="text-sm text-muted-foreground py-10 text-center">Nenhuma inscrição aguardando aprovação.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {pending.map(renderCard)}
          </div>
        )
      )}

      {/* Modal de convite */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar convite' : 'Convidar revendedor'}</DialogTitle>
          </DialogHeader>
          {!created ? (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">Envie um convite para um novo parceiro.</p>
              <div className="space-y-1.5">
                <Label>Nome do interessado</Label>
                <Input value={inviteName} onChange={(e) => setInviteName(e.target.value)} placeholder="Ex.: João Silva" />
              </div>
              <div className="space-y-1.5">
                <Label>WhatsApp</Label>
                <Input value={invitePhone} onChange={(e) => setInvitePhone(e.target.value)} placeholder="Ex.: +55 (11) 99999-9999" inputMode="tel" />
              </div>
              <Button className="w-full h-9 text-sm" onClick={editing ? handleSaveEdit : handleCreateInvite} disabled={saving}>
                <MessageCircle className="h-4 w-4" /> {saving ? 'Aguarde...' : (editing ? 'Salvar alterações' : 'Gerar convite')}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Convite pelo WhatsApp — o interessado receberá uma mensagem com o link exclusivo para o pré-cadastro.
                {created.reused && ' (Convite ativo existente reutilizado.)'}
              </p>
              <div className="rounded-xl bg-muted/50 p-3 text-xs break-all">{created.link}</div>
              <div className="flex gap-2">
                <Button
                  className="flex-1 h-9 text-sm"
                  onClick={() => {
                    const ref = invites.find((i) => i.id === created.inviteId)
                      || { id: created.inviteId, name: inviteName, phone: invitePhone, status: 'criado' };
                    handleOpenWhatsApp(ref);
                  }}
                >
                  <ExternalLink className="h-4 w-4" /> Abrir WhatsApp
                </Button>
                <Button variant="outline" className="h-9" onClick={handleCopyLink} aria-label="Copiar link">
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">O envio é manual: confira a mensagem no WhatsApp antes de enviar.</p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Confirmação de transição */}
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(v) => { if (!v) setConfirm(null); }}
        title={`${resellerStatusLabel(confirm?.to)} — ${confirm?.invite?.name || ''}`}
        description={
          confirm?.to === 'aprovado'
            ? 'Aprovar este parceiro? Ele passará a constar como revendedor aprovado (sem permissões automáticas nesta fase).'
            : confirm?.to === 'recusado'
              ? 'Recusar esta inscrição? O histórico do convite será preservado.'
              : `Alterar o status para "${resellerStatusLabel(confirm?.to)}"?`
        }
        confirmLabel={resellerStatusLabel(confirm?.to)}
        onConfirm={handleConfirmTransition}
      />
    </div>
  );
}
