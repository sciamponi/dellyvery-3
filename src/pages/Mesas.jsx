import React, { useState, useEffect } from 'react';
import { supabase } from '@/api/supabaseClient';
import { useSupabaseAuth } from '@/lib/SupabaseAuthContext';
import { listTables, createTable, updateTable, setTableActive, deleteTable, getTableBlockers } from '@/api/tables';
import { listOrdersWithItems } from '@/api/orders';
import { getPaymentReceiptsForOrders } from '@/api/payments';
import { orderStatusView } from '@/lib/orderStatusView';
import { filterOpenTableOrders } from '@/lib/tableView';
import { groupComplements, isFreeComplement } from '@/lib/orderItemView';
import { paymentBadgeState, paymentMethodIcon } from '@/lib/paymentBadge';
import OrderModal from '@/components/orders/OrderModal';
import { buildTableQrUrl, resolvePublicBaseUrl } from '@/lib/tableQr';
import { FLYER_PRINT_CSS } from '@/lib/printCss';
import { buildFlyerModel, renderFlyerPng, DEFAULT_TABLE_TITLE, DEFAULT_INSTRUCTION } from '@/lib/flyer';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/use-toast';
import { Plus, Pencil, Search, Trash2, QrCode, Download, Printer } from 'lucide-react';

const MANAGER_ROLES = ['OWNER', 'ADMIN', 'MANAGER'];
const DELETE_ROLES = ['OWNER', 'ADMIN'];

function Spinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-4 border-border border-t-primary rounded-full animate-spin" />
    </div>
  );
}

const emptyForm = { name: '', code: '', notes: '', sort_order: 0, active: true };

// FASE A — Cadastro de mesas (nomes personalizáveis, ex.: "Mesa da Janela").
// Sem delete físico: desativar preserva o histórico de pedidos.
// Escrita no banco exige OWNER/ADMIN/MANAGER (RLS); demais só leem.
export default function Mesas() {
  const { toast } = useToast();
  const { currentCompany, currentRole } = useSupabaseAuth();
  const companyId = currentCompany?.id || null;
  const canManage = MANAGER_ROLES.includes(currentRole);
  const canDelete = DELETE_ROLES.includes(currentRole);
  const [loading, setLoading] = useState(true);
  const [tables, setTables] = useState([]);
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  // Exclusão com bloqueios + QR Code por mesa.
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [blockers, setBlockers] = useState([]);
  const [blockersLoading, setBlockersLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [qrTarget, setQrTarget] = useState(null);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [printPng, setPrintPng] = useState('');
  const [printing, setPrinting] = useState(false);
  // Paridade com Configurações: título/instrução + gate de capa.
  const [qrTitle, setQrTitle] = useState('');
  const [qrInstruction, setQrInstruction] = useState('');
  const [qrCoverStatus, setQrCoverStatus] = useState('idle');
  const qrCoverUrl = currentCompany?.cover_url || '';
  // Pedidos em aberto da mesa (vínculo real por table_id; sem cancelados
  // nem finalizados) + detalhe via OrderModal.
  const [ordersTable, setOrdersTable] = useState(null);
  const [tableOrders, setTableOrders] = useState([]);
  const [tableOrdersLoading, setTableOrdersLoading] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [tableReceipts, setTableReceipts] = useState({});

  const openTableOrders = async (t) => {
    setSelectedOrder(null);
    setOrdersTable(t);
    setTableOrders([]);
    if (!t?.id || !companyId) return;
    setTableOrdersLoading(true);
    try {
      const all = await listOrdersWithItems(supabase, companyId, 100);
      const open = filterOpenTableOrders(all, t.id);
      setTableOrders(open);
      try {
        setTableReceipts(await getPaymentReceiptsForOrders(supabase, companyId, open.map((o) => o.id)));
      } catch {
        setTableReceipts({});
      }
    } catch (err) {
      toast({ title: 'Erro ao carregar pedidos', description: err?.message, variant: 'destructive' });
    } finally {
      setTableOrdersLoading(false);
    }
  };

  useEffect(() => {
    if (!qrTarget) return;
    if (!qrCoverUrl) { setQrCoverStatus('idle'); return; }
    let alive = true;
    setQrCoverStatus('checking');
    const Ctor = typeof window !== 'undefined' ? window.Image : null;
    if (!Ctor) { setQrCoverStatus('error'); return undefined; }
    const img = new Ctor();
    img.onload = () => { if (alive) setQrCoverStatus('ok'); };
    img.onerror = () => { if (alive) setQrCoverStatus('error'); };
    img.src = qrCoverUrl;
    return () => { alive = false; };
  }, [qrTarget, qrCoverUrl]);

  const load = async () => {
    if (!companyId) { setLoading(false); return; }
    try {
      setTables(await listTables(supabase, companyId));
    } catch (err) {
      toast({ title: 'Erro ao carregar mesas', description: err?.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [companyId]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (t) => {
    setEditing(t);
    setForm({
      name: t.name || '', code: t.code || '', notes: t.notes || '',
      sort_order: t.sort_order || 0, active: t.active !== false,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast({ title: 'Nome obrigatório', description: 'Dê um nome à mesa (ex.: Mesa da Janela).', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      if (editing) await updateTable(supabase, companyId, editing.id, form);
      else await createTable(supabase, companyId, form);
      toast({ title: editing ? 'Mesa atualizada!' : 'Mesa cadastrada!' });
      setDialogOpen(false);
      await load();
    } catch (err) {
      toast({ title: 'Erro ao salvar', description: err?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (t) => {
    try {
      await setTableActive(supabase, companyId, t.id, !(t.active !== false));
      await load();
    } catch (err) {
      toast({ title: 'Erro ao alterar', description: err?.message, variant: 'destructive' });
    }
  };

  const openDelete = async (t) => {
    setDeleteTarget(t);
    setBlockers([]);
    setBlockersLoading(true);
    try {
      setBlockers(await getTableBlockers(supabase, companyId, t.id));
    } catch (err) {
      toast({ title: 'Erro ao verificar uso', description: err?.message, variant: 'destructive' });
    } finally {
      setBlockersLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteTable(supabase, companyId, deleteTarget.id);
      toast({ title: 'Mesa excluída!' });
      setDeleteTarget(null);
      await load();
    } catch (err) {
      toast({ title: 'Exclusão bloqueada', description: err?.message, variant: 'destructive' });
    } finally {
      setDeleting(false);
    }
  };

  // URL exibida: base configurada (mobile) ou origem atual; token estável.
  const qrDisplayUrl = (t) => {
    if (typeof window === 'undefined' || !t?.public_token) return '';
    try {
      return buildTableQrUrl(resolvePublicBaseUrl(window.location.origin), currentCompany?.slug, t.public_token);
    } catch {
      return '';
    }
  };

  const openQr = async (t) => {
    setQrTarget(t);
    setQrDataUrl('');
    setPrintPng('');
    setQrTitle('');
    setQrInstruction('');
    try {
      const url = buildTableQrUrl(
        resolvePublicBaseUrl(window.location.origin), currentCompany?.slug, t.public_token,
      );
      const { default: QRCode } = await import('qrcode');
      setQrDataUrl(await QRCode.toDataURL(url, { width: 420, margin: 2 }));
    } catch {
      setQrDataUrl('');
    }
  };

  // Impressão A4 do material da mesa via PNG (mesmo gerador do download).
  // Paridade com Configurações: título/instrução + gate de capa + aviso CORS.
  const printTableFlyer = async () => {
    if (!qrTarget || !qrDataUrl) return;
    if (qrCoverUrl && qrCoverStatus !== 'ok') {
      toast({ title: 'Capa indisponível', description: 'A imagem da capa não carregou. Verifique em Configurações e tente de novo.', variant: 'destructive' });
      return;
    }
    setPrinting(true);
    try {
      const model = buildFlyerModel({
        company: currentCompany || {},
        products: [],
        table: qrTarget,
        origin: resolvePublicBaseUrl(window.location.origin),
        opts: {
          title: qrTitle.trim() || undefined,
          instruction: qrInstruction.trim() || undefined,
        },
      });
      const png = await renderFlyerPng(model, {
        qrDataUrl,
        onMissing: (m) => {
          if (m?.cover || m?.photos > 0) {
            toast({ title: 'Material gerado sem imagens', description: 'Capa ou fotos não carregaram (rede/CORS) e ficaram em branco no PNG.' });
          }
        },
      });
      setPrintPng(png);
      setTimeout(() => window.print(), 150);
    } catch (err) {
      toast({ title: 'Erro ao preparar impressão', description: err?.message, variant: 'destructive' });
    } finally {
      setPrinting(false);
    }
  };

  if (loading) return <Spinner />;

  const q = search.trim().toLowerCase();
  const visible = tables.filter((t) =>
    !q || (t.name || '').toLowerCase().includes(q) || (t.code || '').toLowerCase().includes(q),
  );

  return (
    <div>
      <PageHeader title="Mesas" description="Cadastre e organize as mesas por nome">
        {canManage && (
          <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4" /> Nova mesa</Button>
        )}
      </PageHeader>

      <div className="relative mb-4 max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nome ou código..." className="pl-9" />
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground py-10 text-center">
          {tables.length === 0 ? 'Nenhuma mesa cadastrada ainda.' : 'Nenhuma mesa encontrada.'}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((t) => {
            const active = t.active !== false;
            return (
              <div key={t.id} className="rounded-2xl border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <button
                      type="button"
                      onClick={() => openTableOrders(t)}
                      title={`Ver pedidos em aberto de ${t.name}`}
                      className="font-heading font-bold text-foreground truncate hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                    >
                      {t.name}
                    </button>
                    <p className="text-xs text-muted-foreground truncate">
                      {[t.code && `Cód. ${t.code}`, t.notes].filter(Boolean).join(' • ') || 'Sem detalhes'}
                    </p>
                  </div>
                  <Badge variant={active ? 'default' : 'secondary'} className="shrink-0">
                    {active ? 'Ativa' : 'Inativa'}
                  </Badge>
                </div>
                {canManage && (
                  <div className="flex items-center gap-2 mt-3">
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => openEdit(t)}>
                      <Pencil className="h-3.5 w-3.5" /> Editar
                    </Button>
                    <Button
                      variant="outline" size="sm" className="shrink-0"
                      onClick={() => openQr(t)} aria-label={`QR Code de ${t.name}`}
                      disabled={!t.public_token}
                      title={t.public_token ? 'Ver QR Code' : 'Mesa sem token'}
                    >
                      <QrCode className="h-3.5 w-3.5" />
                    </Button>
                    {canDelete && (
                      <Button
                        variant="ghost" size="sm" className="shrink-0 text-destructive hover:text-destructive"
                        onClick={() => openDelete(t)} aria-label={`Excluir ${t.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                )}
                {canManage && (
                  <label className="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground cursor-pointer">
                    <Switch checked={active} onCheckedChange={() => handleToggle(t)} aria-label={`Ativar ${t.name}`} />
                    Ativa
                  </label>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar mesa' : 'Nova mesa'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Nome *</Label>
              <Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="Ex.: Mesa da Janela" maxLength={60} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Código (opcional)</Label>
                <Input value={form.code} onChange={(e) => setForm((p) => ({ ...p, code: e.target.value }))} placeholder="Ex.: 12" maxLength={20} />
              </div>
              <div className="space-y-1.5">
                <Label>Ordem</Label>
                <Input type="number" min={0} value={form.sort_order} onChange={(e) => setForm((p) => ({ ...p, sort_order: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Observação (opcional)</Label>
              <Textarea value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} rows={2} placeholder="Ex.: perto da porta" />
            </div>
            <Button className="w-full" onClick={handleSave} disabled={saving}>
              {saving ? 'Salvando...' : editing ? 'Salvar alterações' : 'Cadastrar mesa'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Exclusão com bloqueios: física só sem nenhum pedido referenciando */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Excluir {deleteTarget?.name}?</DialogTitle>
          </DialogHeader>
          {blockersLoading ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Verificando pedidos vinculados...</p>
          ) : blockers.length > 0 ? (
            <div className="space-y-3">
              <p className="text-sm text-foreground">
                Esta mesa não pode ser apagada: há {blockers.length} pedido(s) vinculado(s).
                Nenhum pedido será alterado ou apagado.
              </p>
              <div className="max-h-40 overflow-y-auto rounded-xl border border-border divide-y divide-border">
                {blockers.map((o) => (
                  <p key={o.id} className="px-3 py-2 text-sm">
                    Pedido #{o.order_number} • {o.status}
                  </p>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Conclua os pedidos ou desative a mesa para retirá-la de novos pedidos.
              </p>
              <Button
                variant="outline" className="w-full"
                onClick={async () => {
                  try {
                    await setTableActive(supabase, companyId, deleteTarget.id, false);
                    toast({ title: 'Mesa desativada!' });
                    setDeleteTarget(null);
                    await load();
                  } catch (err) {
                    toast({ title: 'Erro ao desativar', description: err?.message, variant: 'destructive' });
                  }
                }}
              >
                Desativar em vez de excluir
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Nenhum pedido vinculado. A exclusão é permanente e não afeta outros dados.
              </p>
              <Button className="w-full" disabled={deleting} onClick={handleDelete}>
                {deleting ? 'Excluindo...' : 'Confirmar exclusão'}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* QR Code da mesa: ver, imprimir (flyer A4) e baixar */}
      <Dialog open={!!qrTarget} onOpenChange={(o) => { if (!o) { setQrTarget(null); setQrDataUrl(''); setPrintPng(''); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>QR Code — {qrTarget?.name}</DialogTitle>
          </DialogHeader>
          <style>{FLYER_PRINT_CSS}</style>
          {!qrTarget?.public_token ? (
            <p className="text-sm text-muted-foreground">Mesa sem token público.</p>
          ) : !qrDataUrl ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Gerando QR Code...</p>
          ) : (
            <div className="mx-auto" style={{ maxWidth: 260 }}>
              <div className="text-center">
                <p className="font-heading font-bold text-lg text-foreground">{currentCompany?.name}</p>
                <p className="text-sm text-muted-foreground mb-2">Peça pelo QR Code — {qrTarget.name}</p>
                <img src={qrDataUrl} alt={`QR Code de ${qrTarget.name}`} className="w-full rounded-xl border border-border" />
                <p className="text-[11px] text-muted-foreground mt-2 break-all">
                  {qrDisplayUrl(qrTarget)}
                </p>
              </div>
              <div className="space-y-2 mt-3 text-left">
                <div className="space-y-1">
                  <Label>Título do material</Label>
                  <Input
                    value={qrTitle}
                    onChange={(e) => setQrTitle(e.target.value)}
                    placeholder={DEFAULT_TABLE_TITLE}
                    maxLength={60}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Instrução</Label>
                  <Textarea
                    value={qrInstruction}
                    onChange={(e) => setQrInstruction(e.target.value)}
                    rows={2}
                    placeholder={DEFAULT_INSTRUCTION}
                  />
                </div>
                {qrCoverUrl && qrCoverStatus === 'error' && (
                  <p className="text-xs text-destructive">A capa não carregou — a impressão usa o fundo padrão.</p>
                )}
              </div>
            </div>
          )}
          {printPng && (
            <div className="fly-print invisible absolute left-0 top-0" aria-hidden>
              <img className="fly-print-img" src={printPng} alt="" />
            </div>
          )}
          <div className="no-print flex gap-2 mt-4">
            <Button variant="outline" className="flex-1" onClick={printTableFlyer} disabled={!qrDataUrl}>
              <Printer className="h-4 w-4" /> {printing ? 'Preparando...' : 'Imprimir'}
            </Button>
            <Button
              variant="outline" className="flex-1" asChild disabled={!qrDataUrl}
            >
              <a href={qrDataUrl || '#'} download={`qr-${qrTarget?.name || 'mesa'}.png`}>
                <Download className="h-4 w-4" /> Baixar PNG
              </a>
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Pedidos em aberto da mesa (vínculo real table_id). */}
      <Dialog open={!!ordersTable} onOpenChange={(v) => { if (!v) { setOrdersTable(null); setSelectedOrder(null); } }}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="pr-6">
              Pedidos em aberto — {ordersTable?.name || ''}
            </DialogTitle>
          </DialogHeader>
          {tableOrdersLoading ? (
            <p className="text-sm text-muted-foreground text-center py-8">Carregando...</p>
          ) : tableOrders.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Nenhum pedido em aberto nesta mesa.</p>
          ) : (
            <div className="space-y-2">
              {tableOrders.map((o) => {
                const st = orderStatusView(o.status);
                const recs = tableReceipts[o.id] || [];
                const pay = paymentBadgeState({ paymentStatus: o.payment_status, hasReceipt: recs.length > 0 });
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => setSelectedOrder(o)}
                    className="flex w-full items-center justify-between gap-2 rounded-xl border border-border p-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground">
                        Pedido #{o.order_number}{' '}
                        <span className={`ml-1 rounded-full px-2 py-0.5 text-[10px] font-bold whitespace-nowrap ${st.className}`}>
                          {o.status === 'aguardando_retirada' ? '🟣 ' : ''}{st.label}
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {o.created_date ? new Date(o.created_date).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''} • {o.items?.length || 0} {(o.items?.length || 0) === 1 ? 'item' : 'itens'}
                      </p>
                      {(o.items?.length || 0) > 0 && (
                        <div className="mt-1 space-y-0.5">
                          {o.items.slice(0, 4).map((it, ii) => (
                            <p key={ii} className="text-xs text-foreground break-words">
                              <span className="font-medium">{it.quantity || 1}x {it.name}</span>
                              {(it.complements?.length || 0) > 0 && (
                                <span className="text-muted-foreground">
                                  {' '}({groupComplements(it.complements).map((g) => g.items.map((c) => `${Number(c.quantity) > 1 ? `${c.quantity}x ` : ''}${c.option_name || c.name}${isFreeComplement(c) ? ' (Grátis)' : ''}`).join(', ')).join(' • ')})
                                </span>
                              )}
                              {it.notes && <span className="text-muted-foreground italic"> 📝 {it.notes}</span>}
                            </p>
                          ))}
                          {o.items.length > 4 && (
                            <p className="text-xs text-muted-foreground">+ {o.items.length - 4} itens no detalhe</p>
                          )}
                        </div>
                      )}
                      <p className="text-xs mt-0.5 truncate">
                        <span className="font-bold">{pay.icon} {pay.label}</span>
                        {o.payment_method && <span className="text-muted-foreground"> • {paymentMethodIcon(o.payment_method)} {o.payment_method}</span>}
                      </p>
                    </div>
                    <p className="font-bold shrink-0 whitespace-nowrap">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(o.total || 0)}</p>
                  </button>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>
      {selectedOrder && (
        <OrderModal
          order={selectedOrder}
          isOpen={!!selectedOrder}
          onClose={() => setSelectedOrder(null)}
          onOrderUpdated={(updated) => {
            if (updated?.id) {
              // Baixa/cancelamento tira o pedido da lista de abertos.
              setTableOrders((prev) => {
                const merged = prev.map((o) => (o.id === updated.id ? { ...o, ...updated } : o));
                return filterOpenTableOrders(merged, ordersTable?.id);
              });
              setSelectedOrder(updated);
            }
          }}
          company={currentCompany}
        />
      )}
    </div>
  );
}
