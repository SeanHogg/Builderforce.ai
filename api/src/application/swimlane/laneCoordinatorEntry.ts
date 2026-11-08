/**
 * WHEN a lane entry must be driven by the SwimlaneCoordinator instead of the simple
 * one-agent runtime executor.
 *
 * Two engines exist. The **simple runtime executor** (`maybeAutoRunOnLaneEntry`) starts
 * ONE agent on the ticket — it is what every board drag has always used. The
 * **SwimlaneCoordinator** drives a STAGE: several agents in parallel or sequence, a
 * success policy (`all` / `any` / `n_of_m`), a lane action (`move_ticket` /
 * `run_workflow`) once the stage settles, and browser-claimed dispatches.
 *
 * The drag path never reached the second one. A lane staffed with two agents ran one; a
 * quorum policy was never evaluated; a `run_workflow` action never fired — unless the
 * ticket happened to be started through `POST /api/boards/:id/tickets`. The board
 * configuration was real and simply had no effect, which is worse than not offering it.
 *
 * The decision is deliberately CONSERVATIVE: a lane the simple executor expresses
 * exactly (one staffed agent, default policy, no action) keeps the cheap path, so
 * nothing that works today changes shape.
 */
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { tasks } from '../../infrastructure/database/schema';
import { eq } from 'drizzle-orm';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import type { RuntimeService } from '../runtime/RuntimeService';
import { invalidateLaneRouting, readLaneRouting } from './laneRouting';
import { makeSwimlaneCoordinator } from './makeCoordinator';
import { TicketRunNotFoundError } from './SwimlaneCoordinator';
import { admitStageEntry, recordStageRefusal } from './laneCoordinatorAdmission';
import type { TenantTokenVerdict } from './evaluateAutoRun';
import { reportCaughtError, reportedFallback } from '../observability/caughtErrorReporter';

/** The lane facts the routing decision reads. */
export interface LaneShape {
  successPolicy: string | null;
  successThreshold: number | null;
  actionType: string | null;
  executionMode: string | null;
}

/** The per-assignment facts the routing decision reads. */
export interface LaneAssignmentShape {
  runtime: string | null;
}

/**
 * True when the lane declares something the SIMPLE executor cannot express, so the
 * stage must be driven by the coordinator. Pure — testable without a board.
 */
export function laneNeedsCoordinator(
  lane: LaneShape,
  assignments: readonly LaneAssignmentShape[],
): boolean {
  // More than one staffed agent IS a stage: the simple executor would silently run the
  // first and drop the rest.
  if (assignments.length > 1) return true;
  // A browser dispatch is CLAIMED by a pull worker, never pushed — the simple executor
  // has no way to leave it pending, so it would run it in the cloud instead.
  if (assignments.some((a) => a.runtime === 'browser')) return true;
  // A non-default success policy only means something across a SET of dispatches.
  if (lane.successPolicy && lane.successPolicy !== 'all') return true;
  if (lane.successThreshold != null) return true;
  // A lane action fires when the STAGE settles; the simple executor has no stage.
  if (lane.actionType && lane.actionType !== 'advance') return true;
  // Sequential ordering is only observable with more than one dispatch, so on its own it
  // is not a reason to leave the cheap path.
  return false;
}

/** What {@link tryCoordinatorLaneEntry} did. */
export type CoordinatorEntryOutcome =
  /** The lane needs the coordinator and a stage was launched. */
  | 'started'
  /** The lane needs the coordinator and it declined (capacity, illegal transition,
   *  already running this lane). NOT a reason to fall back to the simple executor —
   *  that would run one agent of a stage the coordinator refused to start. */
  | 'refused'
  /** The lane is expressible by the simple executor (or does not auto-run at all). */
  | 'not_applicable';

/** The ticket's lane RIGHT NOW (one tenant-scoped primary-key read); null when the row is gone or the read fails. */
async function readLiveLane(db: Db, tenantId: number, taskId: number): Promise<string | null> {
  try {
    const [row] = await db
      .select({ status: tasks.status })
      .from(tasks)
      .where(scopedToTenant(tasks, tenantId, eq(tasks.id, taskId)))
      .limit(1);
    return row?.status ?? null;
  } catch {
    return null;
  }
}

/** What the coordinator branch needs of its caller: the dispatch options the one-agent engine honours too. */
export interface CoordinatorEntryArgs {
  tenantId: number;
  projectId: number;
  taskId: number;
  /** The caller's expectation of the lane — possibly a stale snapshot (the sweep). The live row wins. */
  status: string;
  submittedBy: string;
  force?: boolean;
  tenantTokens?: TenantTokenVerdict;
  onBlocked?: (verdict: { reason: string; cooldownRemainingMs?: number }) => void;
}

/**
 * Hand a lane entry to the coordinator when the lane needs it. Never throws.
 */
export async function tryCoordinatorLaneEntry(
  env: Env,
  db: Db,
  runtimeService: RuntimeService,
  args: CoordinatorEntryArgs,
): Promise<CoordinatorEntryOutcome> {
  // THE LANE, live. A caller working from a snapshot (the auto-exec sweep scans hundreds of rows, then enters them one at a
  // time) would otherwise move a ticket that has since advanced BACK to the lane it used to be in. The evaluator re-reads
  // for the same reason; the stage must be entered for the lane the ticket is actually in.
  const status = (await readLiveLane(db, args.tenantId, args.taskId)) ?? args.status;

  // The board, its lanes and their staffing come from ONE cached read per project (laneRouting.ts): a sweep routing many
  // tickets of a board reads it once, and the lane / staffing / board writers drop it.
  const routing = await readLaneRouting(env, db, args.tenantId, args.projectId).catch(reportedFallback(null, { source: 'application/swimlane/laneCoordinatorEntry.ts', operation: 'readLaneRouting', context: { tenantId: args.tenantId, projectId: args.projectId } }));
  if (!routing) return 'not_applicable';
  // A lifecycle-managed board has its own state machine (the manager); a second one here would race it.
  if (routing.lifecycleManaged) return 'not_applicable';
  const lane = routing.lanes.find((l) => l.key === status);

  // A human-gated or terminal lane never auto-starts anything, by EITHER engine — so the
  // coordinator is never handed a stage the gate forbids.
  if (!lane || lane.isTerminal || lane.gate === 'human') return 'not_applicable';

  if (!laneNeedsCoordinator(lane, lane.runtimes.map((runtime) => ({ runtime })))) return 'not_applicable';

  // The same admission the one-agent engine applies (execution switch, live run, breaker / cooldown, token budget) plus the
  // ticket run's own lifecycle — the coordinator has none of them itself.
  const admission = await admitStageEntry(env, db, runtimeService, {
    tenantId: args.tenantId, boardId: routing.boardId, taskId: args.taskId,
    ...(args.force ? { force: true } : {}),
    ...(args.tenantTokens ? { tenantTokens: args.tenantTokens } : {}),
  });
  if (!admission.admitted) {
    await recordStageRefusal(env, db, {
      tenantId: args.tenantId, taskId: args.taskId, lane: status, submittedBy: args.submittedBy,
      ...(args.onBlocked ? { onBlocked: args.onBlocked } : {}),
    }, admission);
    return 'refused';
  }

  try {
    const run = await makeSwimlaneCoordinator(db, env).enterLaneForTask(routing.boardId, args.taskId, args.tenantId, status);
    return run != null ? 'started' : 'refused';
  } catch (error) {
    if (error instanceof TicketRunNotFoundError) {
      // The cached board is gone (deleted or re-pinned since): drop the stale facts and let the one-agent engine, which reads
      // the board live, take the entry instead of reporting a refusal for a board that no longer exists.
      await invalidateLaneRouting(env, args.tenantId, args.projectId).catch(reportedFallback(undefined, { source: 'application/swimlane/laneCoordinatorEntry.ts', operation: 'invalidateLaneRouting', context: { tenantId: args.tenantId, projectId: args.projectId } }));
      return 'not_applicable';
    }
    reportCaughtError(error, {
      source: 'application/swimlane/laneCoordinatorEntry.ts',
      operation: 'tryCoordinatorLaneEntry',
    });
    return 'refused';
  }
}
