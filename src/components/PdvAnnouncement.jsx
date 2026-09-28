import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { useIsMobile } from '@/hooks/use-mobile';
import { Banknote, Check, X } from 'lucide-react';
import { NEW_FEATURE_PDV_V1 } from '@/data/updates';

const SEEN_KEY = 'dellyvery:novidades:vistas';

function markSeen(userId) {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    const seen = raw ? JSON.parse(raw) : {};
    seen[userId || 'anon'] = [...(seen[userId || 'anon'] || []), NEW_FEATURE_PDV_V1];
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch { /* ignore */ }
}

export function hasSeenPdv(userId) {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    const seen = raw ? JSON.parse(raw) : {};
    return (seen[userId || 'anon'] || []).includes(NEW_FEATURE_PDV_V1);
  } catch {
    return true;
  }
}

const HIGHLIGHTS = [
  'Escolha os produtos do cardápio',
  'Monte o pedido rapidamente',
  'Mesa, retirada ou entrega',
  'Finalize o pedido diretamente pelo sistema',
];

function Body({ onGo, onClose }) {
  return (
    <div className="text-center sm:text-left">
      <div className="mx-auto sm:mx-0 mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
        <Banknote className="h-7 w-7 text-primary" />
      </div>
      <h3 className="font-heading text-xl font-bold text-foreground">🚀 Novo PDV disponível!</h3>
      <p className="text-sm text-muted-foreground mt-1">Agora ficou mais fácil criar pedidos diretamente pelo Dellyvery.</p>
      <ul className="mt-4 space-y-2 text-left">
        {HIGHLIGHTS.map(h => (
          <li key={h} className="flex items-start gap-2 text-sm text-foreground">
            <Check className="h-4 w-4 text-green-600 shrink-0 mt-0.5" /> {h}
          </li>
        ))}
      </ul>
      <div className="mt-5 flex flex-col sm:flex-row gap-2">
        <Button className="flex-1 min-h-11" onClick={onGo}>Conhecer o PDV</Button>
        <Button variant="outline" className="flex-1 min-h-11" onClick={onClose}>Fechar</Button>
      </div>
    </div>
  );
}

export default function PdvAnnouncement({ open, userId, onClose }) {
  const isMobile = useIsMobile();
  const navigate = useNavigate();

  const dismiss = () => {
    markSeen(userId);
    onClose();
  };
  const go = () => {
    markSeen(userId);
    onClose();
    navigate('/pdv');
  };

  if (!open) return null;
  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={(o) => { if (!o) dismiss(); }}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader className="text-left">
            <DrawerTitle className="sr-only">Novo PDV disponível</DrawerTitle>
            <button type="button" aria-label="Fechar" onClick={dismiss} className="absolute right-4 top-4 rounded-full p-2 hover:bg-muted">
              <X className="h-5 w-5" />
            </button>
          </DrawerHeader>
          <div className="overflow-y-auto px-5 pb-8">
            <Body onGo={go} onClose={dismiss} />
          </div>
        </DrawerContent>
      </Drawer>
    );
  }
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) dismiss(); }}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="sr-only">Novo PDV disponível</DialogTitle>
          <button type="button" aria-label="Fechar" onClick={dismiss} className="absolute right-4 top-4 rounded-full p-2 hover:bg-muted">
            <X className="h-5 w-5" />
          </button>
        </DialogHeader>
        <Body onGo={go} onClose={dismiss} />
      </DialogContent>
    </Dialog>
  );
}
