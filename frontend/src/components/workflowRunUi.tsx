/** Shared workflow run presentation and status rules for history and the live graph. */

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

/** Pending + running still have work in flight — poll the snapshot DAG until they leave this set. */
export function isLiveWorkflowStatus(status: string | undefined): boolean {
  return status === 'pending' || status === 'running';
}

/**
 * How often a workflow-run snapshot re-fetches while a run is live. No workflow WS
 * exists yet. Every caller polls through `usePolledResource` (paused while the tab
 * is hidden, backs off on failure) and stops once the run leaves the live set.
 * 4 s, not 2 s: node status still visibly advances, at half the requests.
 */
export const LIVE_WORKFLOW_POLL_MS = 4000;

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
