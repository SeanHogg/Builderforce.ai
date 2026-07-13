'use client';

import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { listNotifications, markNotificationsRead, type Notification } from '@/lib/freelancerApi';

/**
 * Shared in-app notification feed for BOTH sides of the marketplace (worker gigs +
 * employer hires). Self-loads, shows the unread count, and marks read. Returns null
 * when there are no notifications so it never renders an empty box. DRY: one panel,
 * both surfaces.
 */
const card: React.CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 16,
};

export default function NotificationsPanel() {
  const t = useTranslations('notifications');
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await listNotifications();
      setItems(res.items);
      setUnread(res.unread);
    } catch { /* best-effort */ }
    finally { setLoaded(true); }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => { void load(); }, 30_000);
    return () => clearInterval(timer);
  }, [load]);

  const markAll = async () => {
    try { await markNotificationsRead(); setItems((p) => p.map((n) => ({ ...n, read: true }))); setUnread(0); } catch { /* noop */ }
  };

  if (!loaded || items.length === 0) return null;

  return (
    <div style={{ ...card, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
          {t('title')}{unread > 0 && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: 'var(--surface-coral-soft)', color: 'var(--coral-bright)' }}>{unread}</span>}
        </div>
        {unread > 0 && <button type="button" onClick={markAll} style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>{t('markAllRead')}</button>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 240, overflowY: 'auto' }}>
        {items.slice(0, 20).map((n) => (
          <div key={n.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '8px 10px', borderRadius: 8, background: n.read ? 'transparent' : 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
            <span aria-hidden style={{ fontSize: 14, flexShrink: 0 }}>{!n.read ? '🔵' : '⚪'}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{n.title}</div>
              {n.body && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{n.body}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
