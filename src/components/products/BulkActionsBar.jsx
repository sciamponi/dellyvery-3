import React from 'react';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';

// Barra de ações em massa: aparece quando há seleção. Ativar/inativar
// (quando suportado), excluir com confirmação do chamador e desmarcar.
// Falhas por registro são relatadas pelo chamador (toast), sem tocar
// nos demais itens.
export default function BulkActionsBar({
  count, entityLabel = 'itens', canToggle = true,
  onActivate, onDeactivate, onDelete, onClear, busy,
}) {
  if (!count) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 mb-2">
      <span className="text-sm font-semibold text-foreground">
        {count} {count === 1 ? 'selecionado' : 'selecionados'}
      </span>
      <span className="text-xs text-muted-foreground hidden sm:inline">{entityLabel}</span>
      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        {canToggle && (
          <>
            <Button size="sm" variant="outline" className="h-8 text-xs" disabled={busy} onClick={onActivate}>
              Ativar
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-xs" disabled={busy} onClick={onDeactivate}>
              Inativar
            </Button>
          </>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="h-8 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
          disabled={busy}
          onClick={onDelete}
        >
          Excluir
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0"
          disabled={busy}
          onClick={onClear}
          aria-label="Desmarcar todos"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
