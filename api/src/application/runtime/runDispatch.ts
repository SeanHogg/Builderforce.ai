/**
 * runDispatch — the board's provenance on a run's payload (PRD 35 §6.9): which trigger dispatched it and, when an approver
 * unlocked it, the approval's id. Read into the contract's `RunTask.dispatch`; written by the approval replay.
 */
/** Where the board's dispatch of a run came from — the contract's `RunTask.dispatch.source` (PRD 35 §3.2). */
export type RunDispatchSource = 'board-sweep' | 'lane-entry' | 'chat' | 'manual' | 'ceremony' | 'subagent';
const RUN_DISPATCH_SOURCES: readonly string[] = ['board-sweep', 'lane-entry', 'chat', 'manual', 'ceremony', 'subagent'];

/**
 * The board's dispatch provenance off a run payload: which trigger started it and, when an approver
 * unlocked it, the approval's id (`RunTask.dispatch`, §6.9). Absent fields stay absent — the adapter
 * derives a source from the run's shape — so a payload written before this field existed reads as `{}`.
 */
export function parseRunDispatch(payload: string | null | undefined): { source?: RunDispatchSource; approvalId?: string } {
  if (!payload) return {};
  try {
    const dispatch = (JSON.parse(payload) as { dispatch?: { source?: unknown; approvalId?: unknown } }).dispatch;
    const source = typeof dispatch?.source === 'string' && RUN_DISPATCH_SOURCES.includes(dispatch.source) ? (dispatch.source as RunDispatchSource) : undefined;
    const approvalId = typeof dispatch?.approvalId === 'string' && dispatch.approvalId ? dispatch.approvalId : undefined;
    return { ...(source ? { source } : {}), ...(approvalId ? { approvalId } : {}) };
  } catch {
    return {};
  }
}

/** The payload with the board's dispatch provenance stamped on it (merged over any already there). */
export function withRunDispatch(payload: string | null | undefined, dispatch: { source?: RunDispatchSource; approvalId?: string }): string {
  let base: Record<string, unknown> = {};
  try { base = payload ? (JSON.parse(payload) as Record<string, unknown>) : {}; } catch { base = {}; }
  const prior = parseRunDispatch(payload);
  return JSON.stringify({ ...base, dispatch: { ...prior, ...dispatch } });
}
