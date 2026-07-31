'use client';

import { useTranslations } from 'next-intl';

/**
 * A small count pill for unread Brain-chat messages — the web's parity with the
 * VSIX attention icons: an execution milestone (or a teammate/agent turn) that
 * landed in a chat you're not viewing shows here until you open it. Companion to
 * {@link AttentionDot} (live run state); this is "new messages you haven't read".
 *
 * Self-hiding: renders nothing for 0/absent, so a caller drops it into any row
 * unconditionally (`<UnreadBadge count={attn.chatUnread[id]} />`). Colour is the
 * brand indigo accent (distinct from the coral/amber run-state dots) via theme
 * tokens so it reads in both light and dark. Caps the label at 99+.
 */
export function UnreadBadge({ count, size = 18 }: { count?: number | null; size?: number }) {
  const t = useTranslations('attention');
  const n = count ?? 0;
  if (n <= 0) return null;
  const label = t('unread', { count: n });
  const text = n > 99 ? '99+' : String(n);
  return (
    <span
      role="status"
      aria-label={label}
      title={label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: size,
        height: size,
        padding: '0 6px',
        borderRadius: size,
        fontSize: 11,
        fontWeight: 700,
        lineHeight: 1,
        color: 'var(--text-on-accent, #ffffff)',
        background: 'var(--badge-unread, #6366f1)',
        flexShrink: 0,
      }}
    >
      {text}
    </span>
  );
}
