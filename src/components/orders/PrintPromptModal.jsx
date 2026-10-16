import React, { useState, useEffect } from 'react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';

const fmtCurrency = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);

// Confirmação de impressão ao atingir etapa configurada (modo "confirm").
// Mostra o resumo do pedido e oferece "não mostrar mais" (opt-out por
// empresa, via callbacks). Imprimir abre a rota dedicada em nova aba
// (gesto do usuário); silenciosa não garantida sem agente local.
export default function PrintPromptModal({
  open, onOpenChange, orderNumber, stageName, order = null, onPrint, onSkip,
}) {
  const [dontShow, setDontShow] = useState(false);

  useEffect(() => {
    if (open) setDontShow(false);
  }, [open, orderNumber ]);

  const itemsCount = order?.items?.length || 0;
  const total = order?.total ?? null;

  const handlePrint = () => {
    onPrint(dontShow);
  };
  const handleSkip = () => {
    onSkip(dontShow);
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Deseja imprimir este pedido?</AlertDialogTitle>
          <AlertDialogDescription>
            Pedido #{orderNumber || '—'} chegou em {stageName || 'nova etapa'}.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {(itemsCount > 0 || total !== null) && (
          <p className="text-sm text-muted-foreground">
            {itemsCount} {itemsCount === 1 ? 'item' : 'itens'}
            {total !== null && <> • Total {fmtCurrency(total)}</>}
          </p>
        )}
        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <Checkbox
            checked={dontShow}
            onCheckedChange={(v) => setDontShow(!!v)}
            aria-label="Não mostrar mais este aviso"
          />
          Não mostrar mais este aviso
        </label>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleSkip}>Agora não</AlertDialogCancel>
          <AlertDialogAction onClick={handlePrint}>Imprimir</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
