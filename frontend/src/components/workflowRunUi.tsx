'use client';

/**
 * Shared vocabulary for every workflow-run surface — `WorkflowsContent.tsx`
 * (the definition list + its "view runs" flow) and `WorkflowRunHistoryPanel.tsx`
 * (the run list/detail, used standalone from both that flow and the builder's
 * "History" toolbar button). Extracted to its own module rather than one
 * importing from the other so neither surface has a hard dependency on the
 * other's module graph.
 */

export const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: 16,
};

export const subtleBtn: React.CSSProperties = {
  padding: '6px 12px',
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--coral-bright)',
  background: 'var(--bg-base)',
  border: '1px solid var(--coral-bright)',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
};

export const STATUS_COLORS: Record<string, string> = {
  pending: 'var(--text-muted)',
  running: 'var(--cyan-bright, var(--cyan-bright))',
  completed: 'rgba(34,197,94,0.9)',
  failed: 'var(--coral-bright)',
  cancelled: 'var(--text-muted)',
};

/** Status pill — one source of truth for run/task status colouring. */
export function StatusPill({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? 'var(--text-muted)';
  return (
    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', padding: '2px 7px', borderRadius: 'var(--radius-sm)', background: `${color}22`, color, whiteSpace: 'nowrap' }}>
      {status}
    </span>
  );
}
