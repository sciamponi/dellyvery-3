import React from 'react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle
} from '@/components/ui/alert-dialog';

export default function ConfirmDialog({ open, onOpenChange, title, description, onConfirm, confirmLabel = 'Excluir', cancelLabel = 'Cancelar', confirmVariant = 'destructive' }) {
  const confirmClassName = confirmVariant === 'success'
    ? 'bg-green-600 text-white hover:bg-green-700'
    : 'bg-destructive text-destructive-foreground hover:bg-destructive/90';
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title || 'Confirmar exclusão'}</AlertDialogTitle>
          <AlertDialogDescription>{description || 'Deseja realmente excluir? Esta ação é irreversível.'}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className={confirmClassName}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}