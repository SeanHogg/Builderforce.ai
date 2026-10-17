import { Icon } from '@/components/ui/Icon';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import { useNotificationFeed } from '@/components/account/NotificationFeedContext';

/**
 * Shared in-app notification feed for BOTH sides of the marketplace (worker gigs +
 * employer hires). Shows the unread count and marks read. Returns null when there
 * are no notifications so it never renders an empty box. DRY: one panel, both
 * surfaces.
 *
 * It reads the shell's ONE alert feed (`NotificationFeedContext`) rather than
 * polling `/api/notifications` itself: a second 30 s poll of the same endpoint
 * doubled the requests on every page it sat on, and two copies of one count can
 * disagree. The shell's feed already gates on the person-level JWT, so a visitor
 * browsing `/marketplace` costs nothing; this panel additionally renders nothing
 * while signed out, and nothing outside the provider (an embed frame).
 */
const card: React.CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: 16,
};

export default function NotificationsPanel() {
  const t = useTranslations('notifications');
  const { isAuthenticated } = useAuth();
  const feed = useNotificationFeed();
  const items = feed?.items ?? [];
  const unread = feed?.unread ?? 0;
  const markAll = () => { void feed?.markAllRead(); };

  if (!isAuthenticated || items.length === 0) return null;

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
