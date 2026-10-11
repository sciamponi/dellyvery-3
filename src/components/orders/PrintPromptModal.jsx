import React from 'react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

// Confirmação de impressão ao atingir etapa configurada (modo "confirm").
// Imprimir abre a rota dedicada em nova aba (gesto do usuário — o navegador
// sempre pede confirmação na janela de impressão; silenciosa não garantida).
export default function PrintPromptModal({ open, onOpenChange, orderNumber, stageName, onPrint, onSkip }) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Deseja imprimir este pedido?</AlertDialogTitle>
          <AlertDialogDescription>
            Pedido #{orderNumber || '—'} chegou em {stageName || 'nova etapa'}.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onSkip}>Agora não</AlertDialogCancel>
          <AlertDialogAction onClick={onPrint}>Imprimir</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
