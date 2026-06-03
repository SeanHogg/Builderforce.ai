/**
 * stageScheduling — PURE (no IO) scheduling logic for a swimlane stage.
 *
 * A stage is a small DAG of agent dispatches. Parallel dispatches have no
 * dependencies and all become ready at once; sequential dispatches each depend
 * on the previous one and become ready as predecessors complete. This module
 * answers two questions the SwimlaneCoordinator needs:
 *
 *   1. which blocked dispatches are now READY to dispatch (all deps completed)?
 *   2. has the whole stage reached a terminal status (completed / failed)?
 *
 * INVARIANT (mirrors transitions.ts): a single FAILED dispatch fails the stage —
 * the coordinator then routes the ticket to needs_attention and never advances.
 */

export type DispatchStatus =
  | 'blocked'    // waiting on an unmet dependency
  | 'pending'    // ready; awaiting a browser pull worker to claim it
  | 'claimed'    // a worker took it but hasn't started
  | 'running'    // executing (agentHost or browser)
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface SchedulableDispatch {
  id: string;
  status: DispatchStatus;
  /** ids of sibling dispatches that must be `completed` before this can run. */
  dependsOn: string[];
}

const TERMINAL: ReadonlySet<DispatchStatus> = new Set(['completed', 'failed', 'cancelled']);
const ACTIVE_NONTERMINAL: ReadonlySet<DispatchStatus> = new Set([
  'pending',
  'claimed',
  'running',
]);

export function isTerminalDispatch(status: DispatchStatus): boolean {
  return TERMINAL.has(status);
}

/**
 * The dispatches that are currently BLOCKED but whose dependencies are all
 * `completed` — i.e. they are now ready to be dispatched. A dependency that
 * `failed`/`cancelled` does NOT satisfy readiness (the stage will fail instead).
 */
export function computeReadyDispatches(
  dispatches: readonly SchedulableDispatch[],
): SchedulableDispatch[] {
  const byId = new Map(dispatches.map((d) => [d.id, d]));
  return dispatches.filter((d) => {
    if (d.status !== 'blocked') return false;
    return d.dependsOn.every((depId) => byId.get(depId)?.status === 'completed');
  });
}

export type StageOutcome = 'running' | 'completed' | 'failed';

/**
 * Aggregate a stage's dispatch statuses into a single outcome.
 *
 * - any `failed`/`cancelled` AND no remaining non-terminal work → 'failed'
 *   (we let in-flight siblings finish before declaring failure so we don't
 *    leave orphaned running work, but a failure is sticky — see note below)
 * - all `completed` → 'completed'
 * - otherwise → 'running'
 *
 * NOTE: as soon as one dispatch fails the stage is doomed; callers may choose to
 * stop scheduling new `blocked` work (computeReadyDispatches won't advance past a
 * failed dep anyway). We only emit the terminal 'failed' once nothing is still
 * actively running, so the coordinator's needs_attention transition is final.
 */
export function aggregateStageOutcome(
  statuses: readonly DispatchStatus[],
): StageOutcome {
  if (statuses.length === 0) return 'completed'; // empty stage = pass-through
  const anyFailed = statuses.some((s) => s === 'failed' || s === 'cancelled');
  const anyActive = statuses.some((s) => ACTIVE_NONTERMINAL.has(s) || s === 'blocked');
  if (anyFailed && !anyActive) return 'failed';
  if (anyActive) return 'running';
  // No active work and no failures → everything is completed.
  return 'completed';
}

/** True when every dispatch is in a terminal state (nothing left to run). */
export function isStageSettled(statuses: readonly DispatchStatus[]): boolean {
  return statuses.every((s) => TERMINAL.has(s));
}
