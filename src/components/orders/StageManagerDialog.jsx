import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/api/supabaseClient';
import {
  LEGACY_STATUSES,
  TERMINAL_MAPS_TO,
  isLegacyStageKey,
  createStage,
  updateStage,
  setStageActive,
  deleteStage,
  reorderStages,
  listStages,
} from '@/api/orderStages';
import { STATUS_LABELS } from '@/lib/orderStatusFlow';
import { ArrowUp, ArrowDown, Pencil, Trash2, Plus, X, Check } from 'lucide-react';

// FASE 1 — Administração das etapas do Kanban (por empresa).
// Criar/editar/excluir/reordenar/ativar + flags inicial/final.
// Stages com chave legada têm mapeamento travado no banco; só as
// customizadas escolhem maps_to. Erros nunca fecham o diálogo.
const MAP_OPTIONS = LEGACY_STATUSES.filter((s) => s !== 'cancelado');

export default function StageManagerDialog({ open, onClose, companyId, stages, onChanged }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('#6366f1');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#6366f1');
  const [newMapsTo, setNewMapsTo] = useState('em_preparo');

  const sorted = [...(stages || [])].sort((a, b) => a.position - b.position);

  const refresh = async () => {
    const fresh = await listStages(supabase, companyId);
    onChanged?.(fresh);
  };

  const run = async (key, fn, okMsg) => {
    setBusy(key);
    setError('');
    try {
      await fn();
      await refresh();
      if (okMsg) toast({ title: okMsg });
    } catch (err) {
      setError(err?.message || 'Erro ao salvar etapa');
    } finally {
      setBusy(null);
    }
  };

  const startEdit = (stage) => {
    setEditingId(stage.id);
    setEditName(stage.name);
    setEditColor(stage.color);
    setError('');
  };

  const saveEdit = (stage) =>
    run(`edit-${stage.id}`, () => updateStage(supabase, companyId, stage.id, {
      name: editName,
      color: editColor,
    }).then(() => setEditingId(null)), 'Etapa atualizada');

  const move = (index, delta) => {
    const ids = sorted.map((s) => s.id);
    const j = index + delta;
    if (j < 0 || j >= ids.length) return;
    const [id] = ids.splice(index, 1);
    ids.splice(j, 0, id);
    run(`move-${id}`, () => reorderStages(supabase, companyId, ids), 'Ordem atualizada');
  };

  const handleCreate = () =>
    run('create', () => createStage(supabase, companyId, {
      name: newName,
      color: newColor,
      mapsTo: newMapsTo,
    }).then(() => {
      setCreating(false);
      setNewName('');
    }), 'Etapa criada');

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-lg max-h-[90vh] overflow-hidden p-0 gap-0 flex flex-col">
        <DialogHeader className="shrink-0 px-4 pt-4 sm:px-6 sm:pt-6">
          <DialogTitle>
            <span className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">Kanban</span>
            <span className="font-heading text-2xl font-bold">Etapas do pedido</span>
          </DialogTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Nome, cor e ordem das colunas. Pedidos antigos continuam funcionando: cada etapa
            reflete um status do sistema.
          </p>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-4 space-y-2">
          {error && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {sorted.map((stage, index) => {
            const legacy = isLegacyStageKey(stage.key);
            const isEditing = editingId === stage.id;
            const isTerminal = TERMINAL_MAPS_TO.includes(stage.mapsTo);
            const hasVisibleSibling = sorted.some(
              (s) => s.id !== stage.id && s.mapsTo === stage.mapsTo && s.active !== false,
            );
            return (
              <div key={stage.id} className="rounded-xl border border-border p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span
                    className="h-4 w-4 rounded-full shrink-0 border border-black/10"
                    style={{ backgroundColor: stage.color }}
                    aria-hidden
                  />
                  {isEditing ? (
                    <div className="flex flex-1 items-center gap-2 min-w-0">
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="h-9"
                        maxLength={40}
                        aria-label="Nome da etapa"
                      />
                      <Input
                        type="color"
                        value={editColor}
                        onChange={(e) => setEditColor(e.target.value)}
                        className="h-9 w-12 p-1 shrink-0"
                        aria-label="Cor da etapa"
                      />
                      <Button size="sm" onClick={() => saveEdit(stage)} disabled={busy !== null} aria-label="Salvar">
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingId(null)} aria-label="Cancelar edição">
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <>
                      <p className="flex-1 min-w-0 font-semibold text-foreground truncate">{stage.name}</p>
                      {stage.isInitial && (
                        <span className="shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-bold text-blue-700">INICIAL</span>
                      )}
                      {stage.isFinal && (
                        <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-bold text-green-700">FINAL</span>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => startEdit(stage)} aria-label={`Editar ${stage.name}`}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
                  <span>
                    Reflete: <span className="font-semibold text-foreground">{STATUS_LABELS[stage.mapsTo] || stage.mapsTo}</span>
                    {legacy && <span className="ml-1">(fixo do sistema)</span>}
                  </span>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <Switch
                      checked={stage.active !== false}
                      onCheckedChange={(v) => run(`toggle-${stage.id}`, () => setStageActive(supabase, companyId, stage.id, v), v ? 'Etapa ativada' : 'Etapa desativada')}
                      disabled={busy !== null}
                      aria-label={`Ativar ${stage.name}`}
                    />
                    Ativa
                  </label>
                </div>
                {stage.active !== false && isTerminal && (
                  <p className="text-[11px] text-amber-600">
                    Desativar oculta a coluna, mas os pedidos finalizados/cancelados continuam na própria coluna.
                  </p>
                )}
                {stage.active !== false && !hasVisibleSibling && !isTerminal && (
                  <p className="text-[11px] text-amber-600">
                    Última coluna visível deste status: ao desativar, os cartões usam o fluxo padrão do sistema.
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-1.5">
                  <Button size="sm" variant="outline" onClick={() => move(index, -1)} disabled={index === 0 || busy !== null} aria-label="Mover para a esquerda">
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => move(index, 1)} disabled={index === sorted.length - 1 || busy !== null} aria-label="Mover para a direita">
                    <ArrowDown className="h-3.5 w-3.5" />
                  </Button>
                  {!stage.isInitial && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => run(`initial-${stage.id}`, () => updateStage(supabase, companyId, stage.id, { isInitial: true }), 'Etapa inicial definida')}
                      disabled={busy !== null}
                    >
                      Tornar inicial
                    </Button>
                  )}
                  {!stage.isFinal && stage.mapsTo !== 'cancelado' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => run(`final-${stage.id}`, () => updateStage(supabase, companyId, stage.id, { isFinal: true }), 'Etapa final definida')}
                      disabled={busy !== null}
                    >
                      Tornar final
                    </Button>
                  )}
                  <span className="flex-1" />
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => run(`del-${stage.id}`, () => deleteStage(supabase, companyId, stage.id), 'Etapa excluída')}
                    disabled={busy !== null}
                    aria-label={`Excluir ${stage.name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })}

          {creating ? (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-2">
              <div className="space-y-1.5">
                <Label>Nome da etapa</Label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Ex.: Produção" maxLength={40} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label>Reflete o status</Label>
                  <Select value={newMapsTo} onValueChange={setNewMapsTo}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MAP_OPTIONS.map((s) => (
                        <SelectItem key={s} value={s}>{STATUS_LABELS[s] || s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Cor</Label>
                  <Input type="color" value={newColor} onChange={(e) => setNewColor(e.target.value)} className="h-10 p-1" />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setCreating(false)}>Fechar</Button>
                <Button size="sm" onClick={handleCreate} disabled={busy !== null || !newName.trim()}>
                  <Plus className="h-4 w-4" /> Criar etapa
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" className="w-full" onClick={() => { setCreating(true); setError(''); }}>
              <Plus className="h-4 w-4" /> Nova etapa
            </Button>
          )}
        </div>

        <div className="shrink-0 border-t border-border px-4 sm:px-6 py-3">
          <Button variant="ghost" className="w-full" onClick={onClose}>Voltar ao Kanban</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
