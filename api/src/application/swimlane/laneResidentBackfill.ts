/**
 * "Run this lane now" — fire the lane trigger for the tickets ALREADY sitting in it.
 *
 * The autonomous trigger is an ENTRY trigger: it fires when a ticket lands in a lane.
 * That leaves a permanent hole on the other side of the same event. Staff an agent onto
 * a lane that already holds forty tickets and nothing happens to any of them — they
 * never "entered", so nothing ever asks whether they should run. The board looks
 * configured and is inert, and the only way to start those tickets was to drag each one
 * out and back in.
 *
 * This closes it from both directions:
 *  • automatically, right after a lane is staffed (the moment the answer changes), and
 *  • explicitly, via `POST /api/boards/:boardId/swimlanes/:laneId/run-lane`.
 *
 * Bounded on purpose. A backfill is the one operation that can dispatch a whole lane at
 * once, so it walks oldest-first up to `limit` and reports what it did; the per-ticket
 * guards (capability gate, approval gate, cloud-run cap, failure breaker, cooldown) all
 * still apply because it routes through exactly the same funnel a drag does.
 */
import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { tasks, projects, boards } from '../../infrastructure/database/schema';
import type { RuntimeService } from '../runtime/RuntimeService';
import { buildRuntimeService } from '../../buildRuntimeService';
import { routeLaneEntry } from './laneEntryTrigger';

/** How many resident tickets one backfill may start. */
export const LANE_BACKFILL_DEFAULT_LIMIT = 25;
/** Hard ceiling, whatever a caller asks for. */
export const LANE_BACKFILL_MAX_LIMIT = 100;

export interface LaneBackfillResult {
  /** Resident tickets considered (after the limit). */
  considered: number;
  /** Tickets the funnel actually started a run (or a stage) for. */
  started: number;
  /** Tickets the funnel declined — not staffed, gated, capped, in backoff, already live. */
  skipped: number;
}

/**
 * Fire the lane trigger for every non-terminal ticket currently resident in `laneKey`
 * on the board's project. Never throws.
 */
export async function backfillLaneResidents(
  env: Env,
  db: Db,
  args: {
    tenantId: number;
    boardId: string;
    laneKey: string;
    submittedBy: string;
    limit?: number;
    runtimeService?: RuntimeService;
  },
): Promise<LaneBackfillResult> {
  const result: LaneBackfillResult = { considered: 0, started: 0, skipped: 0 };

  // The board names the project whose tickets sit in its lanes. Tenant-scoped on the
  // board row, so a cross-tenant board id resolves to nothing rather than to tickets.
  const [board] = await db
    .select({ projectId: boards.projectId })
    .from(boards)
    .where(and(eq(boards.id, args.boardId), eq(boards.tenantId, args.tenantId)))
    .limit(1);
  if (!board?.projectId) return result;

  const limit = Math.min(Math.max(1, args.limit ?? LANE_BACKFILL_DEFAULT_LIMIT), LANE_BACKFILL_MAX_LIMIT);

  const residents = await db
    .select({ id: tasks.id })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(
      eq(tasks.projectId, board.projectId),
      eq(projects.tenantId, args.tenantId),
      eq(tasks.status, args.laneKey),
    ))
    // Oldest first: the tickets that have been stranded longest are the ones a backfill
    // exists to rescue.
    .orderBy(asc(tasks.id))
    .limit(limit);

  if (residents.length === 0) return result;
  result.considered = residents.length;

  const runtimeService = args.runtimeService ?? buildRuntimeService(env, db);
  for (const t of residents) {
    const started = await routeLaneEntry(env, db, runtimeService, {
      tenantId: args.tenantId,
      projectId: board.projectId,
      taskId: t.id,
      status: args.laneKey,
      submittedBy: args.submittedBy,
    }).catch(() => false);
    if (started) result.started++;
    else result.skipped++;
  }
  return result;
}
