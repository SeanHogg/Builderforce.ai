/**
 * Renders an agent's skills/tags, truncated to `max`. Single source of truth for
 * the slice-and-overflow rule that was previously written three different ways
 * (slice(0,4).join, slice(0,5).map(pill), etc.).
 *
 * - variant="pills" (default): rounded chips, for card views. Renders nothing
 *   when there are no skills.
 * - variant="inline": comma-joined text with an ellipsis on overflow, for table
 *   cells. Renders the `empty` placeholder (default "—") when there are none.
 */
export function SkillTags({
  skills,
  max = 5,
  variant = 'pills',
  empty = '—',
}: {
  skills?: string[] | null;
  max?: number;
  variant?: 'pills' | 'inline';
  empty?: string;
}) {
  const list = skills ?? [];

  if (variant === 'inline') {
    if (list.length === 0) return <>{empty}</>;
    return <>{list.slice(0, max).join(', ') + (list.length > max ? '…' : '')}</>;
  }

  if (list.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {list.slice(0, max).map((s) => (
        <span
          key={s}
          style={{
            fontSize: 10,
            padding: '2px 6px',
            borderRadius: 99,
            background: 'var(--surface-2)',
            color: 'var(--text)',
            border: '1px solid var(--border)',
          }}
        >
          {s}
        </span>
      ))}
    </div>
  );
}
