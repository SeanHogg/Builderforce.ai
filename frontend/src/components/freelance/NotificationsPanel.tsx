'use client';

import { Icon } from '@/components/ui/Icon';
import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import { listNotifications, markNotificationsRead, type Notification } from '@/lib/freelance/billing';

/**
 * Shared in-app notification feed for BOTH sides of the marketplace (worker gigs +
 * employer hires). Self-loads, shows the unread count, and marks read. Returns null
 * when there are no notifications so it never renders an empty box. DRY: one panel,
 * both surfaces.
 *
 * The feed is behind the person-level JWT, and this panel decides for itself whether
 * there is one — the same way it decides its own emptiness. Two of its three mount
 * points sit inside `/marketplace`, which anyone may browse, and the poll below
 * means an ungated read is not one 401 but a 401 every thirty seconds, each raising
 * the global error toast and filing a support ticket about a visitor who is simply
 * looking. Gating here rather than at the three call sites is also why a fourth
 * surface cannot reintroduce it.
 */
const card: React.CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: 16,
};

export default function NotificationsPanel() {
  const t = useTranslations('notifications');
  const { isAuthenticated } = useAuth();
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const res = await listNotifications();
      setItems(res.items);
      setUnread(res.unread);
    } catch { /* best-effort */ }
    finally { setLoaded(true); }
  }, [isAuthenticated]);

  useEffect(() => {
    // No token, no poll — not even the first one, and no timer left running.
    if (!isAuthenticated) return;
    void load();
    const timer = setInterval(() => { void load(); }, 30_000);
    return () => clearInterval(timer);
  }, [isAuthenticated, load]);

  const markAll = async () => {
    try { await markNotificationsRead(); setItems((p) => p.map((n) => ({ ...n, read: true }))); setUnread(0); } catch { /* noop */ }
  };

  if (!loaded || items.length === 0) return null;

  return (
    <div style={{ ...card, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 'var(--font-size-small)', fontWeight: 700, color: 'var(--text-primary)' }}>
          {t('title')}{unread > 0 && <span style={{ marginLeft: 8, fontSize: 'var(--font-size-eyebrow)', fontWeight: 700, padding: '2px 7px', borderRadius: 'var(--radius-full)', background: 'var(--surface-coral-soft)', color: 'var(--coral-bright)' }}>{unread}</span>}
        </div>
        {unread > 0 && <button type="button" onClick={markAll} style={{ fontSize: 'var(--font-size-small)', fontWeight: 600, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>{t('markAllRead')}</button>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 240, overflowY: 'auto' }}>
        {items.slice(0, 20).map((n) => (
          <div key={n.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '8px 10px', borderRadius: 'var(--radius-md)', background: n.read ? 'transparent' : 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
            <span aria-hidden style={{ fontSize: 'var(--font-size-small)', flexShrink: 0 }}>{!n.read ? <Icon source="🔵" size="1em" /> : <Icon source="⚪" size="1em" />}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 'var(--font-size-small)', fontWeight: 600, color: 'var(--text-primary)' }}>{n.title}</div>
              {n.body && <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', marginTop: 2 }}>{n.body}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
