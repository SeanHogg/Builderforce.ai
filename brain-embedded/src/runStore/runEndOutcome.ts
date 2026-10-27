/**
 * How a run ENDED — succeeded, failed, stopped by the person, or contained by its USD
 * cap — reported once to the host at run end (`BrainRunRequest.recordRunOutcome`) under
 * the run id its calls already carry (`metadata.guestTurnId`, what the device's usage
 * ledger keys a run by). The route report reads it as the second half of its misroute
 * proxy: a quick run that failed.
 *
 * The run id is noted when the loop starts and the containment when the budget hook
 * stops the run; both live here, beside the cell, so the cell's shape is unchanged.
 */

import type { RunCell } from './runCell';
import { nowIso, pushTrace } from './runCells';
import type { BrainRunRequest, RunEndOutcome } from './runTypes';

interface RunEndNotes {
  runId: string;
  contained: boolean;
}

const notes = new WeakMap<RunCell, RunEndNotes>();

/** The loop started: this is the id its calls carry. */
export function noteRunId(c: RunCell, runId: string | undefined): void {
  if (runId) notes.set(c, { runId, contained: false });
}

/** The budget hook stopped the run at its cap. */
export function noteBudgetContained(c: RunCell): void {
  const n = notes.get(c);
  if (n) n.contained = true;
}

/** The outcome a run that ended this way reports. */
export function runEndOutcome(state: { contained: boolean; aborted: boolean; failed: boolean }): RunEndOutcome {
  if (state.contained) return 'budget-contained';
  if (state.aborted) return 'stopped';
  return state.failed ? 'failed' : 'succeeded';
}

/**
 * Report the run's end to the host, once, and forget it. A run that never reached its
 * loop (memory answered, setup threw before the first turn) has no id and reports
 * nothing — it made no calls for the outcome to describe. Best-effort.
 */
export function reportRunEnd(c: RunCell, req: Pick<BrainRunRequest, 'recordRunOutcome'>, state: { aborted: boolean; failed: boolean }): void {
  const n = notes.get(c);
  notes.delete(c);
  if (!n || !req.recordRunOutcome) return;
  try {
    void Promise.resolve(req.recordRunOutcome({ runId: n.runId, outcome: runEndOutcome({ ...state, contained: n.contained }) }))
      .catch((e: unknown) => unrecorded(c, e));
  } catch (e) {
    // Never fail the unwind.
    unrecorded(c, e);
  }
}

/** The run's own trace (persisted with the run) records an outcome the host could not keep. */
function unrecorded(c: RunCell, e: unknown): void {
  pushTrace(c, { ts: nowIso(), category: 'message', label: 'run.outcome_unrecorded', result: e instanceof Error ? e.message : String(e) });
}
