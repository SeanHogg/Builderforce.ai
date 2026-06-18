/**
 * Small count pill shown next to a tab label (e.g. "Projects ⟨4⟩"). Shared by the
 * dashboard tabs and the Projects/Tasks page tabs so the count chrome can't drift.
 * Decides its own visibility: renders nothing when there is no count to show.
 */
export function TabCountBadge({ count }: { count: number | null | undefined }) {
  if (count == null) return null;
  return (
    <span
      style={{
        marginLeft: 8,
        fontSize: 11,
        fontWeight: 600,
        padding: '1px 7px',
        borderRadius: 999,
        background: 'var(--bg-elevated)',
        color: 'var(--text-muted)',
      }}
    >
      {count}
    </span>
  );
}
