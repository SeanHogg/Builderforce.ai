'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { listNotifications, markNotificationsRead, type Notification } from '@/lib/freelancerApi';

/**
 * Global in-app notification bell for the TopBar — the single app-wide entry point
 * to the durable per-user feed (freelancer_notifications). Reuses the existing
 * `/api/notifications` client (self-loads, polls, marks read). Chat invites /
 * mentions (kind chat_invite | chat_mention, ref = chatId) deep-link into the chat.
 *
 * Theme-token driven (light + dark) and mobile-friendly: the dropdown is width-
 * capped and scrolls internally, anchored to the bell.
 */
export default function NotificationBell() {
  const t = useTranslations('notifications');
  const router = useRouter();
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await listNotifications();
      setItems(res.items);
      setUnread(res.unread);
    } catch { /* best-effort */ }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => { void load(); }, 30_000);
    return () => clearInterval(timer);
  }, [load]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const markAll = async () => {
    try {
      await markNotificationsRead();
      setItems((p) => p.map((n) => ({ ...n, read: true })));
      setUnread(0);
    } catch { /* noop */ }
  };

  const openItem = async (n: Notification) => {
    if (!n.read) {
      try { await markNotificationsRead([n.id]); } catch { /* noop */ }
      setItems((p) => p.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      setUnread((u) => Math.max(0, u - 1));
    }
    if (!n.ref) return;
    setOpen(false);
    // Chat invites / mentions carry the chat id — deep-link into it.
    if (n.kind === 'chat_invite' || n.kind === 'chat_mention') {
      router.push(`/ide/dashboard?chat=${encodeURIComponent(n.ref)}`);
    } else if (n.ref.startsWith('/')) {
      // Notifications that carry a ready-made in-app path (e.g. audit_complete →
      // the project's diagnostics report) navigate straight there.
      router.push(n.ref);
    }
  };

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={t('title')}
        aria-label={unread > 0 ? t('bellUnread', { count: unread }) : t('title')}
        aria-haspopup="true"
        aria-expanded={open}
        style={{ position: 'relative', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 && (
          <span style={{ position: 'absolute', top: 0, right: 0, minWidth: 16, height: 16, borderRadius: 8, background: '#6366f1', color: '#fff', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px', lineHeight: 1 }}>
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, width: 'min(340px, calc(100vw - 24px))', maxHeight: 420, overflowY: 'auto', background: 'var(--surface, var(--bg-elevated))', border: '1px solid var(--border)', borderRadius: 12, boxShadow: '0 8px 28px rgba(0,0,0,0.24)', zIndex: 1000, padding: 8 }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 8px 8px' }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{t('title')}</span>
            {unread > 0 && (
              <button type="button" onClick={markAll} style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>{t('markAllRead')}</button>
            )}
          </div>
          {items.length === 0 ? (
            <div style={{ padding: '16px 8px', fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>{t('empty')}</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {items.slice(0, 30).map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => void openItem(n)}
                  style={{ display: 'flex', gap: 8, alignItems: 'flex-start', textAlign: 'left', padding: '8px 10px', borderRadius: 8, background: n.read ? 'transparent' : 'var(--bg-elevated, rgba(99,102,241,0.08))', border: '1px solid var(--border)', cursor: 'pointer', width: '100%' }}
                >
                  <span aria-hidden style={{ fontSize: 8, flexShrink: 0, marginTop: 5, color: n.read ? 'var(--text-muted)' : '#6366f1' }}>●</span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{n.title}</span>
                    {n.body && <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{n.body}</span>}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
