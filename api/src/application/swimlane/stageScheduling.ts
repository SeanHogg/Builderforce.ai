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

/** How many of a stage's agents must succeed for the lane action to fire. */
export type SuccessPolicy = 'all' | 'any' | 'n_of_m';

/**
 * The number of `completed` dispatches a stage needs to count as a success,
 * given its policy. 'all' → every dispatch; 'any' → one; 'n_of_m' → the
 * threshold, clamped to [1, total].
 */
export function stageSuccessNeed(
  policy: SuccessPolicy,
  threshold: number | null | undefined,
  total: number,
): number {
  if (total === 0) return 0;
  if (policy === 'any') return 1;
  if (policy === 'n_of_m') return Math.max(1, Math.min(threshold ?? total, total));
  return total; // 'all'
}

/**
 * Aggregate a stage's dispatch statuses into a single outcome, honouring the
 * lane's success policy. We only emit a TERMINAL outcome once nothing is still
 * active (running/claimed/pending) or `blocked` — so the coordinator fires the
 * advance/needs_attention transition exactly once. The caller is responsible
 * for cancelling dead-blocked dispatches (see {@link computeDeadBlocked}) so a
 * sequential stage that fails early still settles instead of waiting forever.
 *
 * - still active/blocked      → 'running'
 * - settled, done >= need     → 'completed' (quorum met)
 * - settled, done <  need     → 'failed'
 */
export function aggregateStageOutcome(
  statuses: readonly DispatchStatus[],
  policy: SuccessPolicy = 'all',
  threshold?: number | null,
): StageOutcome {
  if (statuses.length === 0) return 'completed'; // empty stage = pass-through
  const active = statuses.some((s) => ACTIVE_NONTERMINAL.has(s) || s === 'blocked');
  if (active) return 'running';
  const done = statuses.filter((s) => s === 'completed').length;
  return done >= stageSuccessNeed(policy, threshold, statuses.length) ? 'completed' : 'failed';
}

/**
 * Blocked dispatches that can NEVER run because a dependency has already
 * `failed`/`cancelled`. The coordinator cancels these so the stage settles
 * (otherwise a sequential stage whose first agent fails would leave the rest
 * blocked forever and the ticket stuck in `stage_running`).
 */
export function computeDeadBlocked(
  dispatches: readonly SchedulableDispatch[],
): SchedulableDispatch[] {
  const byId = new Map(dispatches.map((d) => [d.id, d]));
  return dispatches.filter((d) => {
    if (d.status !== 'blocked') return false;
    return d.dependsOn.some((depId) => {
      const s = byId.get(depId)?.status;
      return s === 'failed' || s === 'cancelled';
    });
  });
}

/** True when every dispatch is in a terminal state (nothing left to run). */
export function isStageSettled(statuses: readonly DispatchStatus[]): boolean {
  return statuses.every((s) => TERMINAL.has(s));
}
