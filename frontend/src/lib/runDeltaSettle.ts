/**
 * When a cloud run's delta is worth looking for (PRD 41 §C14): the cloud computes it AFTER the run reaches a TERMINAL
 * status, so a run view asks only then — named explicitly, never inferred as "not running and not paused" (a status the
 * run list grows later must not start reads by default). And how long to keep asking: a completed or failed run's delta
 * may take a few minutes; a cancelled run usually changed nothing, so it gets a short window. Past its budget the view
 * gives up quietly (no delta shown, no error).
 */

/** Execution statuses after which a run's delta can exist. */
export const TERMINAL_RUN_STATUSES: ReadonlySet<string> = new Set(['completed', 'failed', 'cancelled']);

/** The run's terminal status, or null while it can still change (running, queued, parked on a question, unknown). */
export function settledRunStatus(status: string | null | undefined): string | null {
  return status != null && TERMINAL_RUN_STATUSES.has(status) ? status : null;
}

/** Reads after a run settles before the view stops looking for its delta. */
export function deltaReadBudget(settled: string): number {
  return settled === 'cancelled' ? 4 : 40;
}
