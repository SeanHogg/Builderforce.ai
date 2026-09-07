'use client';

/**
 * The alert feed's STATE — mounted once in the shell.
 *
 * Two things read it and they must never disagree: the account menu's badge
 * (how many alerts are waiting) and the panel behind that row (which alerts,
 * and marking them read). The count used to live INSIDE the bell button, which
 * was fine while the bell was the only thing that showed it; consolidating the
 * chrome into one avatar made the count a second consumer, and a count fetched
 * twice is a count that disagrees with itself. Same shape, and the same reason,
 * as `MessageHubContext`.
 */

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { usePolledResource } from '@/hooks/usePolledResource';
import { getStoredWebToken } from '@/lib/auth';
import { listNotifications, markNotificationsRead, type Notification } from '@/lib/freelance/billing';

interface NotificationFeedValue {
  items: Notification[];
  unread: number;
  open: boolean;
  openFeed: () => void;
  closeFeed: () => void;
  refresh: () => void;
  markAllRead: () => Promise<void>;
  /** Mark one alert read in place (the panel navigates separately). */
  markRead: (id: Notification['id']) => Promise<void>;
}

const NotificationFeedContext = createContext<NotificationFeedValue | null>(null);

const POLL_INTERVAL_MS = 30_000;

export function NotificationFeedProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    // No token means signed out — the feed renders nothing and must not poll an
    // endpoint that answers 401 on every tick.
    if (!getStoredWebToken()) { setItems([]); setUnread(0); return; }
    const result = await listNotifications();
    setItems(result.items);
    setUnread(result.unread);
  }, []);

  const { refresh } = usePolledResource(load, { intervalMs: POLL_INTERVAL_MS });

  const markAllRead = useCallback(async () => {
    try {
      await markNotificationsRead();
      setItems((previous) => previous.map((item) => ({ ...item, read: true })));
      setUnread(0);
    } catch { /* the badge is additive; a failure must not break the shell */ }
  }, []);

  const markRead = useCallback(async (id: Notification['id']) => {
    try { await markNotificationsRead([id]); } catch { /* best-effort */ }
    setItems((previous) => previous.map((item) => (item.id === id ? { ...item, read: true } : item)));
    setUnread((count) => Math.max(0, count - 1));
  }, []);

  const value = useMemo<NotificationFeedValue>(() => ({
    items,
    unread,
    open,
    openFeed: () => setOpen(true),
    closeFeed: () => setOpen(false),
    refresh,
    markAllRead,
    markRead,
  }), [items, markAllRead, markRead, open, refresh, unread]);

  return <NotificationFeedContext.Provider value={value}>{children}</NotificationFeedContext.Provider>;
}

/**
 * Read the feed. Null OUTSIDE the provider (not a throw): the account menu and
 * its panel render in shells that may not mount this — an embed frame does not —
 * and chrome that silently omits a row is correct there, where a crash is not.
 */
export function useNotificationFeed(): NotificationFeedValue | null {
  return useContext(NotificationFeedContext);
}
