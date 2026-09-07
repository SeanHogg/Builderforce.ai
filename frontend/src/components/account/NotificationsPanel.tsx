'use client';

/**
 * The alert feed, as a panel.
 *
 * It used to be a dropdown hanging off a bell in the top bar. The bell is gone —
 * chat, alerts, cart, theme and sign-out consolidated into one avatar menu — so
 * the feed needed a home that is not a second popover opening out of the first.
 * A slide-out is the app's convention for everything a centered modal is not
 * reserved for, and it is what the message hub beside it already uses.
 *
 * Self-gating: renders nothing outside the feed provider.
 */

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import type { Notification } from '@/lib/freelance/billing';
import { useNotificationFeed } from './NotificationFeedContext';

/** Where an alert leads, or null when it is a notice with nothing behind it. */
function notificationHref(notification: Notification): string | null {
  if (!notification.ref) return null;
  // Chat invites / mentions carry the chat id — deep-link into the conversation.
  if (notification.kind === 'chat_invite' || notification.kind === 'chat_mention') {
    return `/brainstorm?chat=${encodeURIComponent(notification.ref)}`;
  }
  // Alerts that carry a ready-made in-app path (e.g. audit_complete → the
  // project's diagnostics report) navigate straight there.
  return notification.ref.startsWith('/') ? notification.ref : null;
}

export function NotificationsPanel() {
  const t = useTranslations('notifications');
  const router = useRouter();
  const feed = useNotificationFeed();

  if (!feed) return null;

  const openItem = async (notification: Notification) => {
    if (!notification.read) await feed.markRead(notification.id);
    const href = notificationHref(notification);
    if (!href) return;
    feed.closeFeed();
    router.push(href);
  };

  return (
    <SlideOutPanel
      open={feed.open}
      onClose={feed.closeFeed}
      title={t('title')}
      width="sheet"
      widthStorageKey="notification-feed"
      headerActions={feed.unread > 0 ? (
        <button
          type="button"
          onClick={() => void feed.markAllRead()}
          style={{
            fontSize: 'var(--font-size-small)', fontWeight: 600, color: 'var(--text-muted)',
            background: 'none', border: 'none', cursor: 'pointer', padding: 4,
          }}
        >
          {t('markAllRead')}
        </button>
      ) : undefined}
    >
      {feed.items.length === 0 ? (
        <div style={{ padding: 24, fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', textAlign: 'center' }}>
          {t('empty')}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 16 }}>
          {feed.items.map((notification) => (
            <button
              key={notification.id}
              type="button"
              onClick={() => void openItem(notification)}
              style={{
                display: 'flex', gap: 10, alignItems: 'flex-start', textAlign: 'left',
                padding: '10px 12px', borderRadius: 'var(--radius-md)',
                background: notification.read ? 'transparent' : 'var(--bg-elevated)',
                border: '1px solid var(--border)', cursor: 'pointer', width: '100%',
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 7, height: 7, borderRadius: '50%', flexShrink: 0, marginTop: 6,
                  background: notification.read ? 'var(--border)' : 'var(--indigo-bright)',
                }}
              />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 'var(--font-size-small)', fontWeight: 600, color: 'var(--text-primary)' }}>
                  {notification.title}
                </span>
                {notification.body && (
                  <span style={{ display: 'block', fontSize: 'var(--font-size-field-label)', color: 'var(--text-muted)', marginTop: 2 }}>
                    {notification.body}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </SlideOutPanel>
  );
}
