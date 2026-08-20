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
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { swimlanes } from '../../infrastructure/database/schema';
import { forLane, laneAgentAssignments } from './laneAgentAssignments';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { findCanonicalBoard } from './canonicalBoard';
import { makeSwimlaneCoordinator } from './makeCoordinator';
import { reportCaughtError } from '../observability/caughtErrorReporter';

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

/**
 * Hand a lane entry to the coordinator when the lane needs it. Never throws.
 */
export async function tryCoordinatorLaneEntry(
  env: Env,
  db: Db,
  args: { tenantId: number; projectId: number; taskId: number; status: string },
): Promise<CoordinatorEntryOutcome> {
  const board = await findCanonicalBoard(db, args.projectId, args.tenantId).catch(() => null);
  if (!board) return 'not_applicable';

  const [lane] = await db
    .select({
      id: swimlanes.id,
      gate: swimlanes.gate,
      isTerminal: swimlanes.isTerminal,
      successPolicy: swimlanes.successPolicy,
      successThreshold: swimlanes.successThreshold,
      actionType: swimlanes.actionType,
      executionMode: swimlanes.executionMode,
    })
    .from(swimlanes)
    .where(and(eq(swimlanes.boardId, board.id), eq(swimlanes.key, args.status)))
    .limit(1);

  // A human-gated or terminal lane never auto-starts anything, by EITHER engine — so the
  // coordinator is never handed a stage the gate forbids.
  if (!lane || lane.isTerminal || lane.gate === 'human') return 'not_applicable';

  const assignments = await db
    .select({ runtime: laneAgentAssignments.runtime })
    .from(laneAgentAssignments)
    // Tenant-scoped as well as lane-scoped: the lane id already came from a
    // tenant-scoped board read, but the isolation predicate belongs on the query that
    // reads a tenant-owned table, not on the one two steps upstream.
    .where(scopedToTenant(laneAgentAssignments, args.tenantId, forLane(lane.id)));

  if (!laneNeedsCoordinator(lane, assignments)) return 'not_applicable';

  const run = await makeSwimlaneCoordinator(db, env)
    .enterLaneForTask(board.id, args.taskId, args.tenantId, args.status)
    .catch((error) => {
      reportCaughtError(error, {
        source: 'application/swimlane/laneCoordinatorEntry.ts',
        operation: 'tryCoordinatorLaneEntry',
      });
      return null;
    });
  return run != null ? 'started' : 'refused';
}
