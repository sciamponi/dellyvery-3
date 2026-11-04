import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/api/supabaseClient';
import { useSupabaseAuth } from '@/lib/SupabaseAuthContext';
import { isPlatformAdmin } from '@/api/plans';
import {
  RESELLER_PRODUCT, RESELLER_MODALITY,
  resellerStatusLabel, allowedResellerTransitions,
  buildResellerInviteLink, buildResellerInviteUrl,
  buildResellerAccessUrl, validateResellerEmail, normalizeResellerEmail,
  listResellerInvites, listResellers, createResellerInvite, updateResellerInvite,
  sweepExpiredInvites,
} from '@/api/resellers';
import { approveResellerAccess } from '@/api/resellerAccess';
import { getResellerCreditBalance, grantResellerCredits } from '@/api/resellerCredits';
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
  X, Pause, RotateCcw, Pencil, Copy, ExternalLink, AlertTriangle,
  Send, Link2, Wallet,
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

const ACCESS_TONE = {
  ativo: 'bg-green-100 text-green-800',
  suspenso: 'bg-orange-100 text-orange-800',
  inativo: 'bg-muted text-muted-foreground',
};

function accessStatusLabel(status) {
  if (status === 'ativo') return 'Acesso ativo';
  if (status === 'suspenso') return 'Acesso suspenso';
  if (status === 'inativo') return 'Acesso inativo';
  return 'Sem acesso vinculado';
}

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
  const [resellers, setResellers] = useState([]);
  const [tab, setTab] = useState('visao');
  const [expanded, setExpanded] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);

  // Aprovacao com e-mail editavel. A escrita do e-mail ocorre antes da Edge
  // Function; o link magico so existe em memoria e nunca e persistido.
  const [approval, setApproval] = useState(null);
  const [approvalEmail, setApprovalEmail] = useState('');
  const [approvalError, setApprovalError] = useState('');
  const [approvalSaving, setApprovalSaving] = useState(false);
  const [access, setAccess] = useState(null); // { invite, link, whatsappUrl, email }
  const [resendingId, setResendingId] = useState(null);

  // Modal de convite (criar ou editar pré-inscrição).
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [inviteName, setInviteName] = useState('');
  const [invitePhone, setInvitePhone] = useState('');
  const [created, setCreated] = useState(null); // { token, link, invite }

  // Confirmação de transição (aprovar/recusar/suspender/...).
  const [confirm, setConfirm] = useState(null); // { invite, to }

  const [creditDialog, setCreditDialog] = useState(null); // { invite, binding }
  const [creditBalance, setCreditBalance] = useState(null);
  const [creditAmount, setCreditAmount] = useState('');
  const [creditReason, setCreditReason] = useState('');
  const [creditError, setCreditError] = useState('');
  const [creditSaving, setCreditSaving] = useState(false);

  const load = async () => {
    setLoadError('');
    try {
      // Marca expirados em transação própria antes de listar.
      await sweepExpiredInvites(supabase).catch(() => null);
      const [inviteRows, resellerRows] = await Promise.all([
        listResellerInvites(supabase, {}),
        // A tabela de vínculos pode não existir antes da migration local;
        // nesse caso os convites continuam visíveis e a aprovação falha
        // com mensagem do backend.
        listResellers(supabase).catch(() => []),
      ]);
      setInvites(inviteRows);
      setResellers(resellerRows);
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

  const resellerByInvite = useMemo(
    () => new Map(resellers.map((r) => [r.invite_id, r])),
    [resellers],
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

  const openApproval = (invite) => {
    setApproval(invite);
    setApprovalEmail(normalizeResellerEmail(invite?.registration?.email));
    setApprovalError('');
  };

  const openCredit = async (invite) => {
    const binding = resellerByInvite.get(invite.id);
    if (!binding) return;
    setCreditDialog({ invite, binding });
    setCreditBalance(null);
    setCreditAmount('');
    setCreditReason('');
    setCreditError('');
    try {
      setCreditBalance(await getResellerCreditBalance(supabase, binding.id));
    } catch (err) {
      setCreditError(err?.message || 'Não foi possível consultar o saldo.');
    }
  };

  const handleGrantCredits = async () => {
    if (!creditDialog?.binding) return;
    const amount = Number(creditAmount);
    if (!Number.isInteger(amount) || amount <= 0) {
      setCreditError('Informe uma quantidade inteira de créditos maior que zero.');
      return;
    }
    setCreditSaving(true);
    setCreditError('');
    try {
      const out = await grantResellerCredits(
        supabase,
        creditDialog.binding.id,
        amount,
        creditReason,
      );
      setCreditBalance(out?.balance ?? creditBalance);
      setCreditAmount('');
      setCreditReason('');
      notify({
        title: 'Créditos concedidos',
        description: `${creditDialog.invite?.name || 'Revendedor'} • saldo ${out?.balance ?? '-'}`,
      });
    } catch (err) {
      setCreditError(err?.message || 'Não foi possível conceder os créditos.');
    } finally {
      setCreditSaving(false);
    }
  };

  const presentAccess = (invite, out) => {
    const email = normalizeResellerEmail(out?.email || invite?.registration?.email || '');
    const enriched = {
      ...invite,
      registration: { ...(invite?.registration || {}), email },
    };
    let whatsappUrl = null;
    try {
      whatsappUrl = buildResellerAccessUrl({
        phone: enriched.phone,
        name: enriched.name,
        link: out.accessLink,
      });
    } catch {
      // Sem WhatsApp válido, o link ainda pode ser copiado manualmente.
    }
    setAccess({ invite: enriched, link: out.accessLink, whatsappUrl, email });
  };

  const handleApprove = async () => {
    if (!approval) return;
    const emailError = validateResellerEmail(approvalEmail);
    if (emailError) {
      setApprovalError(emailError);
      return;
    }
    const current = invites.find((i) => i.id === approval.id) || approval;
    const reg = { ...(current.registration || {}) };
    const nextEmail = normalizeResellerEmail(approvalEmail);
    setApprovalSaving(true);
    setApprovalError('');
    try {
      // A Edge Function lê o e-mail da inscrição; por isso a edição é salva
      // antes. O convite permanece aguardando aprovação até o vínculo.
      if (normalizeResellerEmail(reg.email) !== nextEmail) {
        await updateResellerInvite(
          supabase,
          current.id,
          { registration: { ...reg, email: nextEmail } },
          { action: 'email_acesso_editado', detail: { email: nextEmail } },
          sbUser?.id,
        );
        reg.email = nextEmail;
        setInvites((prev) => prev.map((i) => (
          i.id === current.id ? { ...i, registration: { ...reg } } : i
        )));
      }
      const out = await approveResellerAccess(supabase, current.id);
      presentAccess({ ...current, registration: reg }, out);
      setApproval(null);
      notify({
        title: current.status === 'aguardando_aprovacao' ? 'Acesso aprovado' : 'Link gerado',
        description: 'Envie pelo WhatsApp ao revendedor.',
      });
      await load();
    } catch (err) {
      setApprovalError(err?.message || 'Não foi possível aprovar o acesso.');
    } finally {
      setApprovalSaving(false);
    }
  };

  const handleResendAccess = async (invite) => {
    setResendingId(invite.id);
    try {
      const out = await approveResellerAccess(supabase, invite.id);
      presentAccess(invite, out);
      notify({ title: 'Novo link gerado', description: 'Envie pelo WhatsApp ao revendedor.' });
      await load();
    } catch (err) {
      notify({ title: 'Erro ao gerar link', description: err?.message, variant: 'destructive' });
    } finally {
      setResendingId(null);
    }
  };

  const handleCopyAccessLink = async () => {
    if (!access?.link) return;
    try {
      await navigator.clipboard.writeText(access.link);
      notify({ title: 'Link copiado!' });
    } catch {
      notify({ title: 'Não foi possível copiar', description: access.link, variant: 'destructive' });
    }
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
    // Aprovação de convite pendente exige e-mail + Edge Function; nunca é
    // feita por update direto (o trigger do banco também bloqueia).
    if (to === 'aprovado' && invite.status === 'aguardando_aprovacao') {
      setConfirm(null);
      openApproval(invite);
      return;
    }
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
    const binding = resellerByInvite.get(invite.id);
    return (
      <div className="mt-3 flex flex-wrap gap-1.5">
        {invite.status === 'aguardando_aprovacao' && (
          <>
            <Button size="sm" className="h-8 text-xs" onClick={() => openApproval(invite)}>
              <Send className="h-3.5 w-3.5" /> Aprovar e gerar link
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => askTransition(invite, 'recusado')}>
              <X className="h-3.5 w-3.5" /> Recusar
            </Button>
          </>
        )}
        {invite.status === 'aprovado' && (
          <>
            {binding?.status === 'ativo' && (
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                disabled={resendingId === invite.id}
                onClick={() => handleResendAccess(invite)}
              >
                <Link2 className="h-3.5 w-3.5" /> {resendingId === invite.id ? 'Gerando...' : 'Novo link'}
              </Button>
            )}
            {binding?.status === 'ativo' && (
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={() => openCredit(invite)}
              >
                <Wallet className="h-3.5 w-3.5" /> Créditos
              </Button>
            )}
            {!binding && (
              <Button size="sm" className="h-8 text-xs" onClick={() => openApproval(invite)}>
                <Send className="h-3.5 w-3.5" /> Finalizar acesso
              </Button>
            )}
            {binding?.status === 'ativo' && (
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => askTransition(invite, 'suspenso')}>
                <Pause className="h-3.5 w-3.5" /> Suspender
              </Button>
            )}
            {allowed.includes('revogado') && (
              <Button size="sm" variant="ghost" className="h-8 text-xs text-destructive" onClick={() => askTransition(invite, 'revogado')}>
                <X className="h-3.5 w-3.5" /> Revogar acesso
              </Button>
            )}
          </>
        )}
        {invite.status === 'suspenso' && (
          <>
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => askTransition(invite, 'aprovado')}>
              <RotateCcw className="h-3.5 w-3.5" /> Reativar
            </Button>
            {allowed.includes('revogado') && (
              <Button size="sm" variant="ghost" className="h-8 text-xs text-destructive" onClick={() => askTransition(invite, 'revogado')}>
                <X className="h-3.5 w-3.5" /> Revogar acesso
              </Button>
            )}
          </>
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
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          onClick={() => setExpanded(expanded === invite.id ? null : invite.id)}
          aria-expanded={expanded === invite.id}
          aria-controls={`revenda-detalhes-${invite.id}`}
          aria-label={expanded === invite.id ? 'Ocultar detalhes' : 'Ver detalhes'}
        >
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded === invite.id ? 'rotate-180' : ''}`} />
        </Button>
      </div>
    );
  };

  const renderCard = (invite) => {
    const isOpen = expanded === invite.id;
    const reg = invite.registration || {};
    const binding = resellerByInvite.get(invite.id);
    const toggleExpanded = () => setExpanded(isOpen ? null : invite.id);
    return (
      <div
        key={invite.id}
        role="button"
        tabIndex={0}
        aria-expanded={isOpen}
        aria-controls={`revenda-detalhes-${invite.id}`}
        onClick={toggleExpanded}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleExpanded();
          }
        }}
        className="rounded-2xl border border-border bg-card p-4 min-w-0 cursor-pointer transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-heading font-bold text-foreground truncate">{invite.name || 'Sem nome'}</p>
            <p className="text-xs text-muted-foreground truncate">{fmtPhone(invite.phone)}</p>
          </div>
          <div className="shrink-0 flex flex-col items-end gap-1">
            <Badge className={STATUS_TONE[invite.status] || ''}>{resellerStatusLabel(invite.status)}</Badge>
            {invite.status === 'aprovado' && (
              <Badge className={ACCESS_TONE[binding?.status] || ACCESS_TONE.inativo}>
                {accessStatusLabel(binding?.status)}
              </Badge>
            )}
          </div>
        </div>
        <div className="mt-2 space-y-1 text-xs text-muted-foreground">
          <p>{RESELLER_PRODUCT.label} • {RESELLER_MODALITY.label}</p>
          <p>Convite em {fmtDate(invite.created_at)}{invite.claimed_at ? ` • Inscrição em ${fmtDate(invite.claimed_at)}` : ''}</p>
        </div>
        {isOpen && (
          <dl id={`revenda-detalhes-${invite.id}`} className="mt-2 rounded-xl bg-muted/50 p-3 space-y-1 text-xs">
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">E-mail de acesso</dt><dd className="font-medium text-right break-all">{reg.email || 'não informado'}</dd></div>
            {binding && (
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Vínculo</dt>
                <dd className="font-medium text-right">{accessStatusLabel(binding.status)}{binding.approved_at ? ` • ${fmtDate(binding.approved_at)}` : ''}</dd>
              </div>
            )}
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
        <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          {renderActions(invite)}
        </div>
      </div>
    );
  };

  return (
    <div>
      <PageHeader title="Gestão de revendedores" description="Gerenciamento de parceiros e convites">
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

      {/* Aprovação com e-mail de acesso editável (Edge Function) */}
      <Dialog
        open={!!approval}
        onOpenChange={(v) => { if (!v && !approvalSaving) setApproval(null); }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {approval?.status === 'aguardando_aprovacao'
                ? 'Aprovar acesso do revendedor'
                : 'E-mail de acesso do revendedor'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {approval?.status === 'aguardando_aprovacao'
                ? 'O acesso é vinculado exclusivamente ao e-mail abaixo. Se a conta não existir, ela será criada já confirmada; depois o link de acesso será gerado.'
                : 'Atualize o e-mail e gere um novo link de acesso. O convite já está aprovado.'}
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="approval-email">E-mail de acesso</Label>
              <Input
                id="approval-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="revendedor@exemplo.com"
                value={approvalEmail}
                onChange={(e) => setApprovalEmail(e.target.value)}
                disabled={approvalSaving}
              />
            </div>
            {approvalError && (
              <div className="rounded-lg bg-destructive/10 p-2.5 text-xs text-destructive">
                {approvalError}
              </div>
            )}
            <Button className="w-full h-9 text-sm" onClick={handleApprove} disabled={approvalSaving}>
              <Send className="h-4 w-4" />
              {approvalSaving
                ? 'Gerando acesso...'
                : approval?.status === 'aguardando_aprovacao'
                  ? 'Aprovar e gerar link'
                  : 'Salvar e gerar novo link'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Link mágico: exibido apenas em memória, nunca persistido/logado */}
      <Dialog open={!!access} onOpenChange={(v) => { if (!v) setAccess(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Link de acesso do revendedor</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Envie este link pessoal pelo WhatsApp. Ele abre a criação de senha e, depois, a Área do Revendedor.
            </p>
            <div className="flex justify-between gap-2 text-xs">
              <span className="text-muted-foreground">E-mail</span>
              <span className="font-medium text-right break-all">{access?.email || '—'}</span>
            </div>
            <div className="rounded-xl bg-muted/50 p-3 text-xs break-all">{access?.link}</div>
            {!access?.whatsappUrl && (
              <p className="text-[11px] text-amber-700">
                WhatsApp não disponível para este convite. Copie o link e envie manualmente.
              </p>
            )}
            <div className="flex gap-2">
              {access?.whatsappUrl && (
                <Button
                  className="flex-1 h-9 text-sm"
                  onClick={() => window.open(access.whatsappUrl, '_blank', 'noopener')}
                >
                  <MessageCircle className="h-4 w-4" /> Abrir WhatsApp
                </Button>
              )}
              <Button variant="outline" className="h-9" onClick={handleCopyAccessLink} aria-label="Copiar link de acesso">
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              O link não é armazenado. Ao fechar esta janela, gere outro se precisar.
            </p>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!creditDialog}
        onOpenChange={(v) => { if (!v && !creditSaving) setCreditDialog(null); }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Créditos do revendedor</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-xl bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">
                {creditDialog?.invite?.name || 'Revendedor'}
              </p>
              <p className="font-heading text-2xl font-bold text-foreground mt-1">
                {creditBalance === null ? '—' : creditBalance}
                <span className="ml-1 text-xs font-normal text-muted-foreground">créditos</span>
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="credit-amount">Quantidade a conceder</Label>
              <Input
                id="credit-amount"
                type="number"
                min="1"
                step="1"
                inputMode="numeric"
                placeholder="Ex.: 10"
                value={creditAmount}
                onChange={(e) => setCreditAmount(e.target.value)}
                disabled={creditSaving}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="credit-reason">Motivo (opcional)</Label>
              <Input
                id="credit-reason"
                placeholder="Ex.: pacote de créditos"
                value={creditReason}
                onChange={(e) => setCreditReason(e.target.value)}
                disabled={creditSaving}
                maxLength={200}
              />
            </div>
            {creditError && (
              <div className="rounded-lg bg-destructive/10 p-2.5 text-xs text-destructive">
                {creditError}
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">
              A concessão gera um lançamento no extrato do revendedor e fica registrada na auditoria.
            </p>
            <Button
              className="w-full h-9 text-sm"
              onClick={handleGrantCredits}
              disabled={creditSaving}
            >
              <Wallet className="h-4 w-4" />
              {creditSaving ? 'Concedendo...' : 'Conceder créditos'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirmação de transição */}
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(v) => { if (!v) setConfirm(null); }}
        title={`${resellerStatusLabel(confirm?.to)} — ${confirm?.invite?.name || ''}`}
        description={
          confirm?.to === 'aprovado'
            ? 'Reativar este revendedor? O vínculo de acesso voltará a ficar ativo.'
            : confirm?.to === 'recusado'
              ? 'Recusar esta inscrição? O histórico do convite será preservado.'
              : confirm?.to === 'revogado'
                ? 'Revogar o acesso deste revendedor? Esta ação é terminal nesta etapa e o vínculo ficará inativo.'
                : `Alterar o status para "${resellerStatusLabel(confirm?.to)}"?`
        }
        confirmLabel={resellerStatusLabel(confirm?.to)}
        onConfirm={handleConfirmTransition}
      />
    </div>
  );
}
