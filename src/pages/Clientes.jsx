import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { supabase, isSupabaseConfigured } from '@/api/supabaseClient';
import { useSupabaseAuth } from '@/lib/SupabaseAuthContext';
import {
  listCustomers, createCustomer as sbCreateCustomer, updateCustomer as sbUpdateCustomer,
  deleteCustomer as sbDeleteCustomer,
} from '@/api/customers';
import { useCompany } from '@/hooks/useCompany';
import PageHeader from '@/components/PageHeader';
import ConfirmDialog from '@/components/ConfirmDialog';
import CustomerImportDialog from '@/components/customers/CustomerImportDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { Plus, Search, Pencil, Trash2, Users, Star, Ban, Download, Upload, Phone, Mail, MapPin, MessageCircle, Lock, LockOpen } from 'lucide-react';

const fmtCurrency = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);

function Spinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-4 border-border border-t-primary rounded-full animate-spin" />
    </div>
  );
}

const FILTERS = [
  { id: 'all', label: 'Todos' },
  { id: 'favorites', label: 'Favoritos' },
  { id: 'blocked', label: 'Bloqueados' },
  { id: 'recurrent', label: 'Recorrentes' },
];

export default function Clientes() {
  const { loading, company: base44Company } = useCompany();
  const { toast } = useToast();
  // FASE 5.3: com sessão Supabase + empresa atual, clientes via Supabase (RLS).
  const { user: sbUser, currentCompany: sbCompany, loading: sbLoading } = useSupabaseAuth();
  const sbActive = isSupabaseConfigured() && !!sbUser && !!sbCompany;
  const company = sbActive ? { id: sbCompany.id, ...sbCompany } : base44Company;
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [dialog, setDialog] = useState(false);
  const [editCustomer, setEditCustomer] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const loadData = async () => {
    if (!company) return;
    try {
      const list = sbActive
        ? await listCustomers(supabase, company.id)
        : await base44.entities.Customer.filter({ company_id: company.id }, '-created_date');
      setCustomers(list);
    } catch (err) {
      toast({ title: 'Erro ao carregar clientes', description: err?.message, variant: 'destructive' });
    }
  };

  useEffect(() => {
    if (company) loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company?.id, sbActive]);

  if (loading || sbLoading) return <Spinner />;
  if (!company) return null;

  const filtered = customers.filter(c => {
    const ms = !search || c.name?.toLowerCase().includes(search.toLowerCase()) || c.whatsapp?.includes(search) || c.phone?.includes(search);
    let mf = true;
    if (filter === 'favorites') mf = c.is_favorite;
    else if (filter === 'blocked') mf = c.is_blocked;
    else if (filter === 'recurrent') mf = (c.orders_count || 0) > 1;
    return ms && mf;
  });

  const openNew = () => {
    setEditCustomer(null);
    setForm({ name: '', whatsapp: '', phone: '', email: '', address: '', city: '', neighborhood: '', zip_code: '', tags: [], notes: '', is_favorite: false, is_blocked: false });
    setDialog(true);
  };

  const openEdit = (c) => {
    setEditCustomer(c);
    setForm({ ...c, tags: c.tags || [] });
    setDialog(true);
  };

  const handleSave = async () => {
    if (!form.name?.trim()) { toast({ title: 'Nome é obrigatório', variant: 'destructive' }); return; }
    setSaving(true);
    try {
      const data = { ...form, company_id: company.id, tags: form.tags || [] };
      delete data.id; delete data.created_date; delete data.updated_date; delete data.created_by_id;
      if (editCustomer) {
        if (sbActive) {
          await sbUpdateCustomer(supabase, editCustomer.id, data, {
            street: editCustomer.address, number: editCustomer.number,
            complement: editCustomer.complement, neighborhood: editCustomer.neighborhood,
            city: editCustomer.city, zip_code: editCustomer.zip_code,
          });
        } else {
          await base44.entities.Customer.update(editCustomer.id, data);
        }
        toast({ title: 'Cliente atualizado!' });
      } else {
        if (sbActive) await sbCreateCustomer(supabase, company.id, data);
        else await base44.entities.Customer.create(data);
        toast({ title: 'Cliente criado!' });
      }
      setDialog(false);
      loadData();
    } catch (err) {
      toast({ title: 'Erro', description: err?.message, variant: 'destructive' });
    } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      if (sbActive) await sbDeleteCustomer(supabase, deleteTarget.id);
      else await base44.entities.Customer.delete(deleteTarget.id);
      setCustomers(prev => prev.filter(c => c.id !== deleteTarget.id));
      toast({ title: 'Cliente excluído' });
    } catch (err) { toast({ title: 'Erro', variant: 'destructive' }); }
    finally { setDeleteTarget(null); }
  };

  const toggleFavorite = async (c) => {
    try {
      if (sbActive) await sbUpdateCustomer(supabase, c.id, { is_favorite: !c.is_favorite });
      else await base44.entities.Customer.update(c.id, { is_favorite: !c.is_favorite });
      setCustomers(prev => prev.map(x => x.id === c.id ? { ...x, is_favorite: !x.is_favorite } : x));
      toast({ title: c.is_favorite ? 'Removido dos favoritos' : 'Adicionado aos favoritos' });
    } catch (err) { toast({ title: 'Erro', description: err?.message, variant: 'destructive' }); }
  };

  const toggleBlocked = async (c) => {
    try {
      if (sbActive) await sbUpdateCustomer(supabase, c.id, { is_blocked: !c.is_blocked });
      else await base44.entities.Customer.update(c.id, { is_blocked: !c.is_blocked });
      setCustomers(prev => prev.map(x => x.id === c.id ? { ...x, is_blocked: !x.is_blocked } : x));
      toast({ title: c.is_blocked ? 'Cliente desbloqueado' : 'Cliente bloqueado' });
    } catch (err) { toast({ title: 'Erro', description: err?.message, variant: 'destructive' }); }
  };

  const exportCSV = () => {
    const headers = ['Nome', 'WhatsApp', 'Telefone', 'Email', 'Cidade', 'Bairro', 'Pedidos', 'Total gasto'];
    const rows = filtered.map(c => [c.name, c.whatsapp, c.phone, c.email, c.city, c.neighborhood, c.orders_count, c.total_spent]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${v ?? ''}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'clientes.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <PageHeader title="Clientes" description="Gerencie seus clientes e histórico">
        <Button variant="outline" onClick={() => setImportOpen(true)}>
          <Upload className="h-4 w-4" /> Importar CSV
        </Button>
        <Button variant="outline" onClick={exportCSV} disabled={customers.length === 0}>
          <Download className="h-4 w-4" /> Exportar CSV
        </Button>
        <Button onClick={openNew} className="bg-primary hover:bg-primary/90">
          <Plus className="h-4 w-4" /> Novo cliente
        </Button>
      </PageHeader>

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nome, telefone..." className="pl-9" />
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {FILTERS.map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)} className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors ${filter === f.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
            <Users className="h-8 w-8 text-muted-foreground" />
          </div>
          <p className="font-medium text-foreground">{search ? 'Nenhum cliente encontrado' : 'Nenhum cliente cadastrado'}</p>
          <p className="text-sm text-muted-foreground mt-1">{search ? 'Tente ajustar a busca.' : 'Seus clientes aparecerão aqui.'}</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(c => (
            <div
              key={c.id}
              role="button"
              tabIndex={0}
              aria-label={`Ver detalhes de ${c.name}`}
              onClick={() => openEdit(c)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEdit(c); }
              }}
              className="rounded-2xl border border-border bg-card p-4 cursor-pointer hover:shadow-md hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-shadow"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 font-heading font-bold text-primary">
                    {c.name?.[0]?.toUpperCase() || '?'}
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-heading font-semibold text-foreground truncate">{c.name}</h3>
                    {c.orders_count > 0 && <p className="text-xs text-muted-foreground">{c.orders_count} pedidos • {fmtCurrency(c.total_spent)}</p>}
                  </div>
                </div>
                <button
                  type="button"
                  aria-label={c.is_favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
                  aria-pressed={!!c.is_favorite}
                  onClick={(e) => { e.stopPropagation(); toggleFavorite(c); }}
                  className="shrink-0 rounded-lg p-1.5 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Star className={`h-4 w-4 ${c.is_favorite ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground'}`} />
                </button>
              </div>
              <div className="mt-3 space-y-1.5 text-sm text-muted-foreground">
                {c.whatsapp && <p className="flex items-center gap-2 truncate"><MessageCircle className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{c.whatsapp}</span></p>}
                {c.phone && <p className="flex items-center gap-2 truncate"><Phone className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{c.phone}</span></p>}
                {c.email && <p className="flex items-center gap-2 truncate"><Mail className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{c.email}</span></p>}
                {c.neighborhood && <p className="flex items-center gap-2 truncate"><MapPin className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{c.neighborhood}{c.city ? `, ${c.city}` : ''}</span></p>}
              </div>
              {c.is_blocked && <span className="inline-flex items-center gap-1 mt-2 rounded-md bg-red-100 text-red-700 px-2 py-0.5 text-xs font-medium"><Ban className="h-3 w-3" /> Bloqueado</span>}
              <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-border">
                <Button
                  variant={c.is_blocked ? 'outline' : 'secondary'}
                  size="sm"
                  onClick={(e) => { e.stopPropagation(); toggleBlocked(c); }}
                >
                  {c.is_blocked ? <><LockOpen className="h-4 w-4" /> Desbloquear</> : <><Lock className="h-4 w-4" /> Bloquear</>}
                </Button>
                <Button
                  variant={c.is_favorite ? 'secondary' : 'outline'}
                  size="sm"
                  onClick={(e) => { e.stopPropagation(); toggleFavorite(c); }}
                >
                  <Star className={`h-4 w-4 ${c.is_favorite ? 'fill-yellow-400 text-yellow-400' : ''}`} /> Favorito
                </Button>
                <span className="ml-auto flex items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); openEdit(c); }}><Pencil className="h-4 w-4" /> Editar</Button>
                  <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setDeleteTarget(c); }} aria-label={`Excluir ${c.name}`}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Customer dialog */}
      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-lg max-h-[90vh] overflow-hidden p-0 gap-0 flex flex-col">
          <DialogHeader className="shrink-0 px-4 pt-4 sm:px-6 sm:pt-6"><DialogTitle>{editCustomer ? 'Editar cliente' : 'Novo cliente'}</DialogTitle></DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2"><Label>Nome *</Label><Input value={form.name || ''} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2 min-w-0"><Label>WhatsApp</Label><Input value={form.whatsapp || ''} onChange={e => setForm(p => ({ ...p, whatsapp: e.target.value }))} placeholder="(11) 99999-9999" /></div>
              <div className="space-y-2 min-w-0"><Label>Telefone</Label><Input value={form.phone || ''} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} placeholder="(11) 99999-9999" /></div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label>Email</Label><Input type="email" value={form.email || ''} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} placeholder="cliente@email.com" /></div>
              <div className="space-y-2"><Label>CEP</Label><Input value={form.zip_code || ''} onChange={e => setForm(p => ({ ...p, zip_code: e.target.value }))} placeholder="12900-000" /></div>
              <div className="space-y-2 sm:col-span-2"><Label>Endereço</Label><Input value={form.address || ''} onChange={e => setForm(p => ({ ...p, address: e.target.value }))} /></div>
              <div className="space-y-2"><Label>Bairro</Label><Input value={form.neighborhood || ''} onChange={e => setForm(p => ({ ...p, neighborhood: e.target.value }))} /></div>
              <div className="space-y-2"><Label>Cidade</Label><Input value={form.city || ''} onChange={e => setForm(p => ({ ...p, city: e.target.value }))} /></div>
            </div>
            <div className="space-y-2"><Label>Observações</Label><Textarea value={form.notes || ''} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} rows={2} /></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex items-center justify-between rounded-xl border border-border p-3">
                <Label className="cursor-pointer">Bloqueado</Label>
                <Switch checked={!!form.is_blocked} onCheckedChange={v => setForm(p => ({ ...p, is_blocked: v }))} />
              </div>
              <div className="flex items-center justify-between rounded-xl border border-border p-3">
                <Label className="cursor-pointer">Favorito</Label>
                <Switch checked={!!form.is_favorite} onCheckedChange={v => setForm(p => ({ ...p, is_favorite: v }))} />
              </div>
            </div>
          </div>
          <DialogFooter className="shrink-0 border-t border-border px-4 sm:px-6 py-3 sm:py-4 flex-row justify-end gap-2">
            <Button variant="ghost" onClick={() => setDialog(false)} className="flex-1 sm:flex-none min-h-11">Fechar</Button>
            <Button variant="outline" onClick={() => setDialog(false)} className="flex-1 sm:flex-none min-h-11">Cancelar</Button>
            <Button onClick={handleSave} disabled={saving} className="flex-1 sm:flex-none min-h-11">{saving ? 'Salvando...' : 'Salvar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CustomerImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        companyId={company.id}
        useSupabase={sbActive}
        existingCustomers={customers}
        onImported={loadData}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={v => !v && setDeleteTarget(null)}
        title="Excluir cliente"
        description={deleteTarget ? `Deseja realmente excluir "${deleteTarget.name}"? Esta ação é irreversível.` : ''}
        onConfirm={handleDelete}
      />
    </div>
  );
}