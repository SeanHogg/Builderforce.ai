/**
 * Canonical green/muted pill for binary entity states. Replaces the inline
 * `{ background: var(--bg-elevated), color: var(--muted), … }` style object that
 * was re-typed everywhere a DRAFT/OFFLINE/inactive badge was needed. "On" states
 * (published, online, active) render green; everything else renders muted.
 */
export type StatusVariant = 'published' | 'draft' | 'online' | 'offline' | 'active' | 'inactive';

const ON_STATES: ReadonlySet<StatusVariant> = new Set(['published', 'online', 'active']);

const LABELS: Record<StatusVariant, string> = {
  published: 'PUBLISHED',
  draft: 'DRAFT',
  online: 'ONLINE',
  offline: 'OFFLINE',
  active: 'ACTIVE',
  inactive: 'INACTIVE',
};

export function StatusBadge({ variant, label }: { variant: StatusVariant; label?: string }) {
  return (
    <span className={ON_STATES.has(variant) ? 'badge-green' : 'badge-muted'}>
      {label ?? LABELS[variant]}
    </span>
  );
}
