import React, { useState } from 'react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { base44 } from '@/api/base44Client';
import { useToast } from '@/components/ui/use-toast';

export default function CancelOrderDialog({ order, isOpen, onClose, onCancelled }) {
  const { toast } = useToast();
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const handleCancel = async () => {
    if (!reason.trim()) {
      toast({ title: 'Motivo é obrigatório', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const res = await base44.functions.invoke('manageOrder', {
        action: 'cancel',
        order_id: order.id,
        cancel_reason: reason
      });
      onCancelled(res.data.order);
      setReason('');
      onClose();
      toast({ title: 'Pedido cancelado' });
    } catch (err) {
      toast({ title: 'Erro ao cancelar pedido', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <AlertDialog open={isOpen} onOpenChange={onClose}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancelar pedido #{order?.order_number}?</AlertDialogTitle>
          <AlertDialogDescription>
            O pedido será marcado como cancelado. Esta ação não pode ser desfeita.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor="cancel-reason">Motivo do cancelamento *</Label>
          <Textarea
            id="cancel-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ex: cliente desistiu, erro no pedido, item indisponível..."
            rows={3}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={saving}>Voltar</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleCancel}
            disabled={saving || !reason.trim()}
            className="bg-red-600 hover:bg-red-700"
          >
            {saving ? 'Cancelando...' : 'Confirmar cancelamento'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}