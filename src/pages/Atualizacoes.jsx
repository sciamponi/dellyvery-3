import React, { useState } from 'react';
import PageHeader from '@/components/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import UpdateDetail from '@/components/UpdateDetail';
import { UPDATE_TABS, STATUS_META, UPDATES, updatesByTab } from '@/data/updates';

export default function Atualizacoes() {
  const [tab, setTab] = useState('destaques');
  const [selectedId, setSelectedId] = useState(null);
  const selected = UPDATES.find((u) => u.id === selectedId) || null;

  return (
    <div>
      <PageHeader title="📢 Atualizações" description="Novidades entregues e o que vem por aí" />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-6 flex-wrap h-auto">
          {UPDATE_TABS.map(t => (
            <TabsTrigger key={t.id} value={t.id}>{t.label}</TabsTrigger>
          ))}
        </TabsList>

        {UPDATE_TABS.map(t => {
          const items = updatesByTab(t.id);
          return (
            <TabsContent key={t.id} value={t.id}>
              {items.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">Nada por aqui ainda.</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map(item => {
                    const st = STATUS_META[item.status] || STATUS_META.disponivel;
                    const future = item.status === 'embreve';
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setSelectedId(item.id)}
                        aria-label={`Ver detalhes: ${item.title}`}
                        className={`rounded-2xl border bg-card p-4 text-left cursor-pointer transition-all hover:shadow-md hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${future ? 'border-dashed opacity-90' : 'border-border'}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-2xl" aria-hidden="true">{item.icon}</span>
                          <span className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-medium ${st.cls}`}>
                            {st.dot} {st.label}
                          </span>
                        </div>
                        <h3 className="font-heading font-semibold text-foreground mt-2">{item.title}</h3>
                        <p className="text-sm text-muted-foreground mt-1 leading-snug">{item.desc}</p>
                      </button>
                    );
                  })}
                </div>
              )}
            </TabsContent>
          );
        })}
      </Tabs>

      <UpdateDetail item={selected} onClose={() => setSelectedId(null)} />
    </div>
  );
}
