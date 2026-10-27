import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/api/supabaseClient';
import { getProductConfig } from '@/api/configurator';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertCircle, ArrowLeft, ArrowRight, Check, Loader2, Minus, Package, Plus, RotateCcw,
} from 'lucide-react';
import {
  applicableSteps, buildAssemblyLine, canAdvanceStep, canSkipStep, changeOptionQty,
  selectionQty, stepEffectiveMin, stepMax, summarizeSelection, toggleOptionSelection,
} from '@/lib/pdvAssembly.js';
import { getProductImages } from '@/lib/productMedia';

const fmtCurrency = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);

function ReviewThumb({ src, name }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) {
    return (
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-muted" aria-hidden="true">
        <Package className="h-6 w-6 text-muted-foreground/60" />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={name || ''}
      loading="lazy"
      className="h-14 w-14 shrink-0 rounded-lg object-cover"
      onError={() => setFailed(true)}
    />
  );
}

function StepOption({ step, option, quantity, onToggle, onChangeQty }) {
  const selected = quantity > 0;
  const repeat = step.allow_repeat === true && selected;
  return (
    <div className={`flex min-w-0 items-center gap-3 rounded-xl border p-3 transition-colors ${selected ? 'border-primary bg-primary/5' : 'border-border bg-card'}`}>
      <button
        type="button"
        onClick={() => onToggle(option.id)}
        aria-pressed={selected}
        className="flex min-h-11 min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg"
      >
        <span className={`flex h-5 w-5 shrink-0 items-center justify-center border ${step.select_mode === 'single' ? 'rounded-full' : 'rounded'} ${selected ? 'border-primary bg-primary text-primary-foreground' : 'border-input'}`}>
          {selected && <Check className="h-3.5 w-3.5" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">{option.name}</span>
          {Number(option.price) > 0 && (
            <span className="block text-xs text-muted-foreground">+ {fmtCurrency(option.price)}</span>
          )}
        </span>
      </button>
      {repeat && (
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" aria-label={`Diminuir ${option.name}`} onClick={() => onChangeQty(option.id, -1)} className="flex h-9 w-9 items-center justify-center rounded-md border border-border hover:bg-muted">
            <Minus className="h-3.5 w-3.5" />
          </button>
          <span className="w-6 text-center text-sm font-medium">{quantity}</span>
          <button type="button" aria-label={`Aumentar ${option.name}`} onClick={() => onChangeQty(option.id, 1)} className="flex h-9 w-9 items-center justify-center rounded-md border border-border hover:bg-muted">
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

export default function AutoAssemblyPanel({
  companyId, product, tableLabel = '', onAdd, onCancel,
}) {
  const [phase, setPhase] = useState('steps');
  const [config, setConfig] = useState(null);
  const [selection, setSelection] = useState({});
  const [stepIndex, setStepIndex] = useState(0);
  const [notes, setNotes] = useState('');
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [configError, setConfigError] = useState('');
  const [reloadTick, setReloadTick] = useState(0);
  const [added, setAdded] = useState(false);

  useEffect(() => {
    if (!product?.id) return undefined;
    let alive = true;
    setLoadingConfig(true);
    setConfigError('');
    setConfig(null);
    setSelection({});
    setStepIndex(0);
    setNotes('');
    setPhase('steps');
    setAdded(false);
    void (async () => {
      try {
        const raw = await getProductConfig(supabase, companyId, product.id);
        if (!alive) return;
        const normalized = {
          steps: Array.isArray(raw?.steps) ? raw.steps : [],
          options: Array.isArray(raw?.options) ? raw.options : [],
        };
        const steps = applicableSteps(normalized);
        setConfig(normalized);
        if (steps.length === 0) setPhase('review');
      } catch (err) {
        if (!alive) return;
        setConfigError(`Não foi possível carregar a montagem de "${product.name}". ${err?.message || 'Tente novamente.'}`);
      } finally {
        if (alive) setLoadingConfig(false);
      }
    })();
    return () => { alive = false; };
  }, [companyId, product?.id, reloadTick]);

  const configSteps = useMemo(() => applicableSteps(config), [config]);
  const currentStep = configSteps[stepIndex] || null;
  const currentQty = currentStep ? selectionQty(selection, currentStep.id) : 0;
  const min = currentStep ? stepEffectiveMin(currentStep) : 0;
  const max = currentStep ? stepMax(currentStep) : 0;
  const canNext = currentStep ? canAdvanceStep(currentStep, selection) : false;
  const canSkip = currentStep ? canSkipStep(currentStep) : false;
  const isLastStep = stepIndex + 1 >= configSteps.length;
  const summary = useMemo(() => summarizeSelection(configSteps, selection), [configSteps, selection]);

  const previewState = useMemo(() => {
    if (!product || !config) return { line: null, error: '' };
    try {
      return {
        line: buildAssemblyLine({
          product,
          steps: config.steps,
          options: config.options,
          selection,
          notes,
        }),
        error: '',
      };
    } catch (err) {
      return { line: null, error: err?.message || 'Montagem inválida' };
    }
  }, [product, config, selection, notes]);
  const preview = previewState.line;
  const previewError = previewState.error;

  const goNext = (nextSelection = selection) => {
    if (!currentStep) {
      setPhase('review');
      return;
    }
    if (!canAdvanceStep(currentStep, nextSelection)) return;
    if (stepIndex + 1 >= configSteps.length) setPhase('review');
    else setStepIndex((i) => i + 1);
  };

  const goBack = () => {
    if (phase === 'review') {
      if (configSteps.length > 0) {
        setPhase('steps');
        setStepIndex(configSteps.length - 1);
      } else {
        onCancel?.();
      }
      return;
    }
    if (stepIndex > 0) setStepIndex((i) => i - 1);
    else onCancel?.();
  };

  const handleToggle = (optionId) => {
    if (!currentStep) return;
    const result = toggleOptionSelection({ step: currentStep, selection, optionId });
    setSelection(result.selection);
    if (result.autoAdvance && !isLastStep) goNext(result.selection);
  };

  const handleQty = (optionId, delta) => {
    if (!currentStep) return;
    const result = changeOptionQty({ step: currentStep, selection, optionId, delta });
    setSelection(result.selection);
  };

  const handleAdd = () => {
    if (!preview || previewError || loadingConfig || added) return;
    setAdded(true);
    onAdd?.(preview);
  };

  const stepLabel = tableLabel ? `Mesa ${tableLabel} • ` : '';

  if (configError) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => onCancel?.()} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border hover:bg-muted" aria-label="Voltar ao catálogo">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{product?.name}</p>
        </div>
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive" role="alert">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="min-w-0 flex-1">{configError}</p>
          </div>
        </div>
        <Button variant="outline" className="min-h-10" onClick={() => setReloadTick((k) => k + 1)}>
          <RotateCcw className="h-4 w-4" /> Tentar novamente
        </Button>
      </div>
    );
  }

  if (loadingConfig) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 py-12 text-center">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
        <p className="text-sm font-medium text-foreground">Carregando etapas de {product?.name}...</p>
        <p className="text-xs text-muted-foreground">Buscando a configuração atual do produto.</p>
        <Button variant="ghost" size="sm" onClick={() => onCancel?.()}>Voltar ao catálogo</Button>
      </div>
    );
  }

  if (phase === 'steps' && currentStep) {
    const progress = configSteps.length > 0 ? ((stepIndex + 1) / configSteps.length) * 100 : 0;
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="shrink-0 space-y-2">
          <div className="flex items-center gap-2">
            <button type="button" onClick={goBack} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border hover:bg-muted" aria-label="Voltar">
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground">{product?.name}</p>
              <p className="text-xs text-muted-foreground">{stepLabel}Etapa {stepIndex + 1} de {configSteps.length}</p>
            </div>
            <span className="shrink-0 text-xs font-medium text-muted-foreground">{currentQty}/{max}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="space-y-1">
            <h3 className="font-heading text-lg font-bold text-foreground">{currentStep.title}</h3>
            {currentStep.description && <p className="text-xs text-muted-foreground">{currentStep.description}</p>}
            <p className="text-xs text-muted-foreground">
              {currentStep.required ? 'Obrigatório' : 'Opcional'}
              {min > 0 ? ` • mínimo ${min}` : ''}
              {` • máximo ${max}`}
              {currentStep.select_mode === 'single' ? ' • escolha única' : ''}
            </p>
          </div>

          <div className="mt-3 space-y-2">
            {currentStep.options.map((option) => (
              <StepOption
                key={option.id}
                step={currentStep}
                option={option}
                quantity={Number(selection?.[currentStep.id]?.[option.id]) || 0}
                onToggle={handleToggle}
                onChangeQty={handleQty}
              />
            ))}
            {currentStep.options.length === 0 && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive" role="alert">
                Esta etapa não tem opções ativas. Ajuste a configuração do produto antes de vender.
              </div>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-row items-stretch gap-1.5 border-t border-border pt-3 sm:gap-2">
          <Button variant="ghost" className="min-h-11 min-w-0 flex-1 px-2 text-[11px] sm:px-4 sm:text-sm" onClick={goBack}>
            <ArrowLeft className="h-4 w-4 shrink-0" /> Voltar
          </Button>
          {canSkip && (
            <Button variant="outline" className="min-h-11 min-w-0 flex-1 whitespace-nowrap px-2 text-[11px] sm:px-4 sm:text-sm" onClick={() => goNext(selection)}>
              Pular etapa
            </Button>
          )}
          {isLastStep ? (
            <Button
              className="min-h-11 min-w-0 flex-1 whitespace-nowrap px-2 text-[11px] sm:px-4 sm:text-sm"
              disabled={!preview || !!previewError || added}
              onClick={handleAdd}
              aria-label="Adicionar e voltar aos produtos"
            >
              <Plus className="h-4 w-4 shrink-0" /> Adicionar
            </Button>
          ) : (
            <Button className="min-h-11 min-w-0 flex-1 whitespace-nowrap px-2 text-[11px] sm:px-4 sm:text-sm" disabled={!canNext} onClick={() => goNext()}>
              Continuar <ArrowRight className="h-4 w-4 shrink-0" />
            </Button>
          )}
        </div>
        {currentStep.select_mode === 'single' && !isLastStep && (
          <p className="shrink-0 text-center text-[11px] text-muted-foreground">Avança automaticamente ao escolher uma opção.</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="shrink-0 space-y-2">
        <div className="flex items-center gap-2">
          <button type="button" onClick={goBack} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border hover:bg-muted" aria-label="Voltar">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">Revisar item</p>
            <p className="truncate text-xs text-muted-foreground">{stepLabel}{product?.name}</p>
          </div>
          <Button variant="ghost" size="sm" className="shrink-0" onClick={() => onCancel?.()}>Trocar</Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="flex items-center gap-3">
            <ReviewThumb src={getProductImages(product)[0] || ''} name={product?.name} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">{product?.name}</p>
              <p className="text-xs text-muted-foreground">Produto principal</p>
            </div>
            <p className="shrink-0 text-sm font-bold">{fmtCurrency(preview?.base_unit_price ?? product?.promotional_price ?? product?.price)}</p>
          </div>

          {configSteps.length > 0 && (
            <div className="mt-3 border-t border-border pt-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Complementos do produto</p>
              {configSteps.map((step, index) => {
                const chosen = summary.find((s) => s.step_id === step.id);
                return (
                  <button
                    key={step.id}
                    type="button"
                    onClick={() => { setStepIndex(index); setPhase('steps'); }}
                    className="mt-1 w-full rounded-lg border-t border-border/60 py-2 text-left first:mt-1 first:border-t-0 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{step.title}</span>
                      <span className="shrink-0 text-[11px] font-medium text-primary">Alterar</span>
                    </span>
                    {chosen?.options?.length > 0 ? (
                      <span className="mt-1 block text-sm text-foreground">
                        {chosen.options.map((o) => `${o.quantity > 1 ? `${o.quantity}x ` : ''}${o.name}`).join(', ')}
                      </span>
                    ) : (
                      <span className="mt-1 block text-sm text-muted-foreground">Sem escolhas</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="pdv-assembly-notes">Observação do item (opcional)</Label>
          <Textarea
            id="pdv-assembly-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ex.: sem cebola, ponto da carne..."
            className="min-h-16 resize-none"
          />
        </div>

        {previewError && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive" role="alert">
            <div className="flex items-start gap-2"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><p>{previewError}</p></div>
          </div>
        )}
      </div>

      <div className="shrink-0 space-y-2 border-t border-border pt-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Total deste item</span>
          <span className="font-heading text-lg font-bold">{fmtCurrency(preview?.line_total || 0)}</span>
        </div>
        <Button className="min-h-11 w-full" onClick={handleAdd} disabled={!preview || !!previewError || added}>
          <Plus className="h-4 w-4" /> Adicionar ao pedido
        </Button>
        <p className="text-center text-[11px] text-muted-foreground">O pedido só será enviado pelo botão final.</p>
      </div>
    </div>
  );
}
