import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { useIsMobile } from '@/hooks/use-mobile';
import { STATUS_META, detailsOf } from '@/data/updates';

const SECTIONS = [
  ['what', 'O que é?'],
  ['how', 'Como funciona?'],
  ['why', 'Por que é útil?'],
  ['usage', 'Como usar?'],
];

function Body({ item }) {
  const st = STATUS_META[item.status] || STATUS_META.disponivel;
  const d = detailsOf(item);
  return (
    <div>
      <div className="flex items-center gap-3">
        <span className="text-4xl" aria-hidden="true">{item.icon}</span>
        <div className="min-w-0">
          <h3 className="font-heading text-lg font-bold text-foreground leading-tight">{item.title}</h3>
          <span className={`mt-1 inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-medium ${st.cls}`}>
            {st.dot} {st.label}
          </span>
        </div>
      </div>
      <p className="text-sm text-muted-foreground mt-3 leading-relaxed">{item.desc}</p>
      <div className="mt-4 space-y-3">
        {SECTIONS.map(([key, label]) => (
          <div key={key}>
            <p className="text-xs font-semibold uppercase tracking-wide text-foreground">{label}</p>
            <p className="text-sm text-muted-foreground mt-0.5 leading-relaxed">{d[key]}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// Detalhe da atualização: bottom sheet no mobile, modal no desktop.
export default function UpdateDetail({ item, onClose }) {
  const isMobile = useIsMobile();
  if (!item) return null;
  if (isMobile) {
    return (
      <Drawer open={!!item} onOpenChange={(o) => { if (!o) onClose(); }}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader className="text-left">
            <DrawerTitle className="sr-only">{item.title}</DrawerTitle>
          </DrawerHeader>
          <div className="overflow-y-auto px-5 pb-8">
            <Body item={item} />
          </div>
        </DrawerContent>
      </Drawer>
    );
  }
  return (
    <Dialog open={!!item} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="sr-only">{item.title}</DialogTitle>
        </DialogHeader>
        <Body item={item} />
      </DialogContent>
    </Dialog>
  );
}
