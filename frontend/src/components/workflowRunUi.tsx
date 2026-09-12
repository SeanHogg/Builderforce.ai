// No 'use client': pure style constants + a presentational component,
// imported only by `WorkflowsContent.tsx` and `WorkflowRunHistoryPanel.tsx`,
// both already inside their own client boundaries.
/**
 * Shared vocabulary for every workflow-run surface — `WorkflowsContent.tsx`
 * (the definition list + its "view runs" flow) and `WorkflowRunHistoryPanel.tsx`
 * (the run list/detail, used standalone from both that flow and the builder's
 * "History" toolbar button). Extracted to its own module rather than one
 * importing from the other so neither surface has a hard dependency on the
 * other's module graph.
 */

import { statusPillStyle, type StatusToneMap } from '@/lib/statusTone';

export const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: 16,
};

export const subtleBtn: React.CSSProperties = {
  padding: '6px 12px',
  fontSize: 'var(--font-size-small)',
  fontWeight: 600,
  color: 'var(--coral-bright)',
  background: 'var(--bg-base)',
  border: '1px solid var(--coral-bright)',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
};

export type WorkflowRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * THE workflow run/task status → tone map — the run list, the task rows and the DAG
 * view's nodes all read it, so a status is one colour on every workflow surface.
 */
export const WORKFLOW_STATUS_TONE: StatusToneMap<WorkflowRunStatus> = {
  pending: 'neutral',
  running: 'info',
  completed: 'success',
  failed: 'danger',
  cancelled: 'neutral',
};

/** Status pill — one source of truth for run/task status colouring. */
export function StatusPill({ status }: { status: string }) {
  return (
    <span style={{ fontSize: 'var(--font-size-field-label)', fontWeight: 700, textTransform: 'uppercase', padding: '2px 7px', borderRadius: 'var(--radius-sm)', ...statusPillStyle(WORKFLOW_STATUS_TONE, status), whiteSpace: 'nowrap' }}>
      {status}
    </span>
  );
}
