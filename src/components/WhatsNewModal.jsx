import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { useIsMobile } from '@/hooks/use-mobile';
import { Sparkles, X } from 'lucide-react';
import { getWhatsNewHighlights, markWhatsNewSeen } from '@/lib/whatsNew';

function Body({ onConfirm, onSeeAll }) {
  const highlights = getWhatsNewHighlights();
  return (
    <div className="text-center sm:text-left">
      <div className="mx-auto sm:mx-0 mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
        <Sparkles className="h-7 w-7 text-primary" />
      </div>
      <h3 className="font-heading text-xl font-bold text-foreground">Novidades do Dellyvery</h3>
      <p className="text-sm text-muted-foreground mt-1">
        Chegaram melhorias para o salão e a entrega. Veja o resumo:
      </p>
      <ul className="mt-4 space-y-3 text-left">
        {highlights.map((h) => (
          <li key={h.id} className="flex items-start gap-2.5">
            <span className="text-xl leading-none mt-0.5" aria-hidden="true">{h.icon}</span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-foreground">{h.title}</span>
              <span className="block text-xs text-muted-foreground leading-snug">{h.desc}</span>
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-5 flex flex-col sm:flex-row gap-2">
        <Button className="flex-1 min-h-11" onClick={onConfirm}>Entendi</Button>
        <Button variant="outline" className="flex-1 min-h-11" onClick={onSeeAll}>
          Ver todas as atualizações
        </Button>
      </div>
    </div>
  );
}

export default function WhatsNewModal({ open, userId, onClose }) {
  const isMobile = useIsMobile();
  const navigate = useNavigate();

  const dismiss = () => {
    markWhatsNewSeen(userId);
    onClose();
  };
  const seeAll = () => {
    markWhatsNewSeen(userId);
    onClose();
    navigate('/atualizacoes');
  };

  if (!open) return null;
  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={(o) => { if (!o) dismiss(); }}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader className="text-left">
            <DrawerTitle className="sr-only">Novidades do Dellyvery</DrawerTitle>
            <button type="button" aria-label="Fechar" onClick={dismiss} className="absolute right-4 top-4 rounded-full p-2 hover:bg-muted">
              <X className="h-5 w-5" />
            </button>
          </DrawerHeader>
          <div className="overflow-y-auto px-5 pb-8">
            <Body onConfirm={dismiss} onSeeAll={seeAll} />
          </div>
        </DrawerContent>
      </Drawer>
    );
  }
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) dismiss(); }}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="sr-only">Novidades do Dellyvery</DialogTitle>
          <button type="button" aria-label="Fechar" onClick={dismiss} className="absolute right-4 top-4 rounded-full p-2 hover:bg-muted">
            <X className="h-5 w-5" />
          </button>
        </DialogHeader>
        <Body onConfirm={dismiss} onSeeAll={seeAll} />
      </DialogContent>
    </Dialog>
  );
}
