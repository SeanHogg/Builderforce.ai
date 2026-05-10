'use client';

/**
 * Small inline badge that summarizes a key's browser-access posture.
 * Shared between the owner and admin key list rows so both UIs report the
 * same three states the same way.
 */

const badgeBase: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  padding: '2px 6px',
  borderRadius: 4,
  letterSpacing: '0.02em',
  whiteSpace: 'nowrap',
};

export function AllowedOriginsBadge({ allowedOrigins }: { allowedOrigins: string[] | null }) {
  if (!allowedOrigins || allowedOrigins.length === 0) {
    return (
      <span
        title="Server-only key — any browser request is rejected at auth time"
        style={{ ...badgeBase, background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
      >
        SERVER-ONLY
      </span>
    );
  }
  if (allowedOrigins.includes('*')) {
    return (
      <span
        title="Any origin can use this key — high-risk; rotate to a specific allowlist if you can"
        style={{ ...badgeBase, background: 'rgba(244,114,94,0.15)', color: 'var(--coral-bright, #f4726e)' }}
      >
        ANY ORIGIN ★
      </span>
    );
  }
  return (
    <span
      title={allowedOrigins.join(', ')}
      style={{ ...badgeBase, background: 'rgba(34,197,94,0.15)', color: 'rgb(34,197,94)' }}
    >
      {allowedOrigins.length} ORIGIN{allowedOrigins.length === 1 ? '' : 'S'}
    </span>
  );
}
