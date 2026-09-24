import React, { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Bell } from 'lucide-react';

/**
 * Sino de notificações do painel. Estado derivado das notificações reais
 * (entidade Notification, não lidas). Sem duplicação por render.
 */
export default function NotificationBell({ companyId, onSelectOrder }) {
  const [notifications, setNotifications] = useState([]);
  const [open, setOpen] = useState(false);
  const companyIdRef = useRef(null);

  useEffect(() => {
    if (!companyId) return;
    companyIdRef.current = companyId;
    let alive = true;
    const load = async () => {
      try {
        const list = await base44.entities.Notification.filter(
          { company_id: companyId },
          '-created_date',
          30
        );
        if (alive) setNotifications(list);
      } catch (err) { /* ignore */ }
    };
    load();

    const unsub = base44.entities.Notification.subscribe?.((event) => {
      if (!companyIdRef.current) return;
      if (event.data?.company_id && event.data.company_id !== companyIdRef.current) return;
      if (event.type === 'create') {
        setNotifications(prev => [event.data, ...prev.filter(n => n.id !== event.data.id)].slice(0, 30));
      } else if (event.type === 'update') {
        setNotifications(prev => prev.map(n => n.id === event.data.id ? event.data : n));
      } else if (event.type === 'delete') {
        setNotifications(prev => prev.filter(n => n.id !== event.id));
      }
    });
    return () => { alive = false; unsub?.(); };
  }, [companyId]);

  if (!companyId) return null;

  const unread = notifications.filter(n => !n.read);
  const unreadCount = unread.length;

  const markRead = async (notif) => {
    if (notif.read) return;
    try {
      await base44.entities.Notification.update(notif.id, { read: true });
      setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, read: true } : n));
    } catch (err) { /* ignore */ }
  };

  const handleSelect = async (notif) => {
    await markRead(notif);
    setOpen(false);
    onSelectOrder?.(notif);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label={unreadCount > 0 ? `${unreadCount} notificações não lidas` : 'Notificações'}
        className="relative flex h-10 w-10 items-center justify-center rounded-xl hover:bg-muted transition-colors"
      >
        <Bell className="h-5 w-5 text-foreground" />
        {unreadCount > 0 && (
          <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="Fechar notificações"
            className="fixed inset-0 z-40 cursor-default bg-transparent"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-2xl border border-border bg-card shadow-lg overflow-hidden">
            <div className="border-b border-border px-4 py-3">
              <p className="font-heading font-semibold text-sm text-foreground">Notificações</p>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {notifications.length === 0 && (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nenhuma notificação.</p>
              )}
              {notifications.map(n => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => handleSelect(n)}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors border-b border-border last:border-0"
                >
                  {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-red-600" />}
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-foreground truncate">{n.title || 'Notificação'}</span>
                    <span className="block text-xs text-muted-foreground break-words">{n.message}</span>
                    {n.created_date && (
                      <span className="block text-[11px] text-muted-foreground mt-0.5">
                        {new Date(n.created_date).toLocaleString('pt-BR')}
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
