import React, { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useIsMobile } from '@/hooks/use-mobile';
import { Search, Plus, Eye } from 'lucide-react';
import { comandasTotal } from '@/lib/tableComandas';
import { buildTableCards } from '@/lib/pdvWorkspace';

const fmtCurrency = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);

const STATUS_DOT = { ocupada: '🔴', multipla: '🟡' };
const STATUS_LABEL = { ocupada: 'Ocupada', multipla: 'Com múltiplas comandas' };

// Seletor visual de mesa (Dialog no desktop, Drawer no mobile).
// Mesas derivadas dos pedidos ativos — sem entidade Mesa no banco.
// Props: open, onClose, mesaOrders, onPickTable(table),
// onPickCard(card), onPickComanda(orderId), onNewComanda(table, tableId),
// onMergeTable(table, tableId), onViewComanda(orderId), initialTable.
export default function TableSelectModal({
  open, onClose, mesaOrders, tableCards, onPickTable, onPickCard, onPickComanda,
  onNewComanda, onMergeTable, onViewComanda, initialTable,
}) {
  const isMobile = useIsMobile();
  const [search, setSearch] = useState('');
  const [manual, setManual] = useState(initialTable || '');

  const tables = useMemo(() => {
    const cards = tableCards?.length ? tableCards : buildTableCards({ orders: mesaOrders });
    return cards.filter((card) => card.name && card.name !== 'Sem mesa' && card.comandas.length > 0);
  }, [tableCards, mesaOrders]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tables;
    return tables.filter(t =>
      (t.name || '').toLowerCase().includes(q)
      || t.comandas.some(c => (c.customerName || '').toLowerCase().includes(q)));
  }, [tables, search]);

  const body = (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔎 Buscar mesa ou cliente..." className="pl-9" />
      </div>

      <div className="flex items-center gap-2">
        <Input value={manual} onChange={e => setManual(e.target.value)} placeholder="Número da mesa" inputMode="numeric" className="h-10" />
        <Button variant="outline" className="h-10 shrink-0" disabled={!manual.trim()} onClick={() => { onPickTable(manual.trim()); }}>
          Usar mesa
        </Button>
      </div>

      {filtered.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-4">
          Nenhuma mesa com comanda ativa. Digite o número acima para começar.
        </p>
      )}

      <div className="space-y-2">
        {filtered.map(t => (
          <div key={t.key} data-table={t.name} className="rounded-2xl border border-border p-3 space-y-2">
            <button
              type="button"
              onClick={() => (onPickCard ? onPickCard(t) : onPickTable(t.name))}
              className="flex w-full items-center gap-2 text-left rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="text-lg leading-none">{STATUS_DOT[t.status]}</span>
              <span className="font-heading font-bold text-foreground">🍽️ Mesa {t.name}</span>
              <span className="text-xs text-muted-foreground">{STATUS_LABEL[t.status]}</span>
              <span className="ml-auto text-sm font-bold">{fmtCurrency(comandasTotal(t.comandas))}</span>
            </button>

            <div className="space-y-1.5">
              {t.comandas.map(c => (
                <div key={c.id} className="flex items-center gap-2 rounded-xl bg-muted/50 px-3 py-2 min-w-0">
                  <button
                    type="button"
                    onClick={() => onPickComanda(c.id)}
                    className="flex-1 min-w-0 text-left rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <p className="text-sm font-medium text-foreground truncate">👤 {c.customerName || 'Sem cliente'}</p>
                    <p className="text-xs text-muted-foreground">🧾 #{c.order_number} • {c.itemCount} {c.itemCount === 1 ? 'item' : 'itens'} • {fmtCurrency(c.total)}</p>
                  </button>
                  <button
                    type="button"
                    aria-label={`Ver comanda #${c.order_number}`}
                    onClick={() => onViewComanda(c.id)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border hover:bg-muted"
                  >
                    <Eye className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="flex-1 min-h-9" onClick={() => onNewComanda(t.name, t.tableId)}>
                <Plus className="h-4 w-4" /> Nova comanda
              </Button>
              {t.comandas.length > 1 && (
                <Button variant="outline" size="sm" className="flex-1 min-h-9" onClick={() => onMergeTable(t.name, t.tableId)}>
                  Juntar comandas
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader className="text-left">
            <DrawerTitle>🍽️ Selecionar mesa</DrawerTitle>
          </DrawerHeader>
          <div className="overflow-y-auto px-5 pb-8">
            {body}
          </div>
        </DrawerContent>
      </Drawer>
    );
  }
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-md max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>🍽️ Selecionar mesa</DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-auto pr-1">
          {body}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Modal de confirmação de junção (dupla confirmação: seleção + este modal).
export function MergeConfirmModal({ open, onClose, table, comandas, onConfirm, busy }) {
  const isMobile = useIsMobile();
  const total = comandasTotal(comandas);
  const content = (
    <div className="space-y-3">
      <p className="text-sm text-foreground">
        Juntar estas comandas da <span className="font-bold">🍽️ Mesa {table}</span>?
      </p>
      <div className="rounded-xl border border-border divide-y divide-border">
        {comandas.map(c => (
          <div key={c.id} className="flex items-center justify-between gap-2 px-3 py-2">
            <span className="text-sm font-medium truncate">👤 {c.customerName || 'Sem cliente'} <span className="text-muted-foreground">#{c.order_number}</span></span>
            <span className="text-sm font-bold shrink-0">{fmtCurrency(c.total)}</span>
          </div>
        ))}
      </div>
      <p className="text-sm">Total combinado: <span className="font-heading font-bold text-lg">{fmtCurrency(total)}</span></p>
      <p className="text-xs text-muted-foreground">Os itens serão somados na primeira comanda e as demais serão canceladas (com motivo registrado). Esta ação não pode ser desfeita.</p>
      <div className="flex flex-col sm:flex-row sm:justify-end gap-2">
        <Button variant="ghost" className="w-full sm:w-auto min-h-11" onClick={onClose} disabled={busy}>Cancelar</Button>
        <Button className="w-full sm:w-auto min-h-11" onClick={onConfirm} disabled={busy}>
          {busy ? 'Juntando...' : 'Juntar comandas'}
        </Button>
      </div>
    </div>
  );
  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader className="text-left"><DrawerTitle>Juntar comandas</DrawerTitle></DrawerHeader>
          <div className="overflow-y-auto px-5 pb-8">{content}</div>
        </DrawerContent>
      </Drawer>
    );
  }
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Juntar comandas</DialogTitle></DialogHeader>
        {content}
      </DialogContent>
    </Dialog>
  );
}

export function TableMergePicker({ table, comandas, selected, onToggle, onContinue, onCancel }) {
  return (
    <div className="rounded-2xl border border-primary/40 bg-primary/5 p-3 space-y-2">
      <Label>Selecionar comandas para juntar — 🍽️ Mesa {table}</Label>
      {comandas.map(c => (
        <label key={c.id} className="flex items-center gap-2 rounded-xl bg-card border border-border px-3 py-2 cursor-pointer min-w-0">
          <input type="checkbox" checked={selected.includes(c.id)} onChange={() => onToggle(c.id)} className="h-4 w-4 shrink-0 accent-red-600" />
          <span className="flex-1 min-w-0 text-sm font-medium truncate">👤 {c.customerName || 'Sem cliente'} <span className="text-muted-foreground">#{c.order_number}</span></span>
          <span className="text-sm font-bold shrink-0">{fmtCurrency(c.total)}</span>
        </label>
      ))}
      <div className="flex gap-2">
        <Button variant="ghost" size="sm" className="flex-1 min-h-9" onClick={onCancel}>Cancelar</Button>
        <Button size="sm" className="flex-1 min-h-9" disabled={selected.length < 2} onClick={onContinue}>
          Continuar ({selected.length})
        </Button>
      </div>
    </div>
  );
}
