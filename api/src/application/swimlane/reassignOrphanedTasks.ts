/**
 * Board referential integrity — keep every ticket pointing at a real lane.
 *
 * `tasks.swimlane_id` (migration 1115) is the reference, DERIVED by the database
 * from (the project's board, `tasks.status`); NULL means the ticket is in no lane
 * at all. That is the orphan state, and it has two halves:
 *
 *  • PREVENTING it on the path that causes it. Deleting a lane would leave every
 *    resident holding a now-dead status string, visible only in the board's
 *    auto-appended fallback column, so `reassignTasksFromLane` moves them onto a
 *    surviving lane BEFORE the lane row is removed. The fallback-lane choice is a
 *    pure function (`pickFallbackLane`) so the policy is unit-tested without a DB.
 *
 *  • REPAIRING it wherever it already exists. A board wiped by any other route — a
 *    restored backup, a direct DELETE, a project whose board was rebuilt — still
 *    produces orphans, and before the FK there was no query that could even find
 *    them: the only handle on "the tickets in this lane" was the very key that had
 *    gone missing. `countOrphanedTasks` reports them and `adoptOrphanedTasks`
 *    re-homes them onto a lane the operator names.
 *
 * Re-homing matters because an orphan is INVISIBLE WORK, not just an odd column:
 * no lane gate, no staffed agent and no requirement applies to a ticket whose
 * status no lane defines, so it can never auto-run and never advance.
 */
import { and, eq, sql } from 'drizzle-orm';
import { boards, swimlanes, tasks } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import type { Db } from '../../infrastructure/database/connection';

/** Minimal shape of a surviving lane needed to pick a reassignment target. */
export interface SurvivingLane {
  key: string;
  position: number;
  isTerminal: boolean;
}

/**
 * Pick the lane an orphaned task should move to when its lane is deleted.
 *
 * Policy: the lowest-position NON-terminal surviving lane (so work re-enters the
 * earliest active stage rather than landing in a Done/terminal lane). If every
 * surviving lane is terminal, fall back to the lowest-position lane of any kind.
 * Returns null only when there is no surviving lane at all (the caller then
 * leaves the task's status untouched — there is nowhere valid to send it).
 */
export function pickFallbackLane(survivors: SurvivingLane[], requestedKey?: string | null): string | null {
  // AN OPERATOR'S CHOICE WINS. Deleting a lane is a MERGE — "fold this stage into that
  // one" — and until the caller could name the target, the automatic policy below was
  // the only answer available, so merging `Ready` into `To Do` silently sent its tickets
  // to whichever lane happened to sort first. A requested key that no longer survives is
  // ignored rather than honoured, so a stale choice cannot strand the tickets.
  if (requestedKey && survivors.some((l) => l.key === requestedKey)) return requestedKey;
  if (survivors.length === 0) return null;
  const byPosition = [...survivors].sort((a, b) => a.position - b.position);
  const firstActive = byPosition.find((l) => !l.isTerminal);
  return (firstActive ?? byPosition[0]!).key;
}

export interface ReassignResult {
  /** The lane key tasks were moved to, or null when no reassignment happened. */
  movedTo: string | null;
  /** How many tasks were reassigned off the deleted lane. */
  movedCount: number;
}

/**
 * Reassign every task currently in `deletedLaneKey` (on the board's project) onto
 * a surviving lane. Call this BEFORE deleting the lane row. `survivors` is the
 * lane set with the to-be-deleted lane already excluded.
 *
 * Returns `{ movedTo: null, movedCount: 0 }` when there is nothing to do (no
 * surviving lane to move to, or no task was holding the dead key).
 */
export async function reassignTasksFromLane(
  db: Db,
  args: {
    tenantId: number;
    boardId: string;
    deletedLaneKey: string;
    survivors: SurvivingLane[];
    /** The lane the operator chose to merge INTO. Falls back to the policy when absent
     *  or when the named lane is not among the survivors. */
    reassignTo?: string | null;
  },
): Promise<ReassignResult> {
  const target = pickFallbackLane(args.survivors, args.reassignTo ?? null);
  // Nowhere valid to send the tasks, or the deleted lane is also the chosen
  // fallback (single-lane board edge) — leave statuses untouched.
  if (!target || target === args.deletedLaneKey) return { movedTo: null, movedCount: 0 };

  // The board is project-scoped (boards.project_id UNIQUE); resolve it so we only
  // touch tasks belonging to THIS board's project.
  const [board] = await db
    .select({ projectId: boards.projectId })
    .from(boards)
    .where(and(eq(boards.id, args.boardId), eq(boards.tenantId, args.tenantId)));
  if (!board) return { movedTo: null, movedCount: 0 };

  const orphaned = await db
    .update(tasks)
    .set({ status: target, updatedAt: new Date() })
    .where(scopedToTenant(tasks, args.tenantId, eq(tasks.projectId, board.projectId), eq(tasks.status, args.deletedLaneKey)))
    .returning({ id: tasks.id });

  return { movedTo: target, movedCount: orphaned.length };
}

/**
 * Convenience: load the board's surviving lanes (every lane except the one being
 * deleted) and reassign orphaned tasks off the deleted lane. Used by the lane
 * DELETE route, which already knows the deleted lane's id + key.
 */
export async function reassignOrphanedTasksOnLaneDelete(
  db: Db,
  args: {
    tenantId: number; boardId: string; deletedLaneId: string; deletedLaneKey: string;
    /** The operator's chosen merge target — see {@link pickFallbackLane}. */
    reassignTo?: string | null;
  },
): Promise<ReassignResult> {
  const lanes = await db
    .select({ id: swimlanes.id, key: swimlanes.key, position: swimlanes.position, isTerminal: swimlanes.isTerminal })
    .from(swimlanes)
    .where(and(eq(swimlanes.boardId, args.boardId), eq(swimlanes.tenantId, args.tenantId)));

  const survivors: SurvivingLane[] = lanes
    .filter((l) => l.id !== args.deletedLaneId)
    .map((l) => ({ key: l.key, position: l.position, isTerminal: l.isTerminal }));

  return reassignTasksFromLane(db, {
    tenantId: args.tenantId,
    boardId: args.boardId,
    deletedLaneKey: args.deletedLaneKey,
    survivors,
    reassignTo: args.reassignTo ?? null,
  });
}

/**
 * How many of a project's live tickets are in NO lane — the orphan census.
 *
 * Archived tickets are excluded: they have left the board, so being off it is not
 * a defect. Counts rather than rows because every caller so far asks "is anything
 * wrong here", and the answer belongs beside the board's other health signals.
 */
export async function countOrphanedTasks(
  db: Db,
  args: { tenantId: number; projectId: number },
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(tasks)
    .where(scopedToTenant(
      tasks,
      args.tenantId,
      eq(tasks.projectId, args.projectId),
      eq(tasks.archived, false),
      sql`${tasks.swimlaneId} is null`,
    ));
  return Number(row?.n ?? 0);
}

/**
 * Re-home every orphaned ticket on a board onto `targetKey`.
 *
 * The operator names the lane, for the same reason a lane DELETE takes `?into=`:
 * where the work goes is a decision, not a policy. A key that names no lane on
 * this board is refused rather than approximated — sending stranded tickets
 * somewhere arbitrary is how they got stranded.
 */
export async function adoptOrphanedTasks(
  db: Db,
  args: { tenantId: number; boardId: string; targetKey: string },
): Promise<ReassignResult> {
  const [board] = await db
    .select({ projectId: boards.projectId })
    .from(boards)
    .where(and(eq(boards.id, args.boardId), eq(boards.tenantId, args.tenantId)));
  if (!board) return { movedTo: null, movedCount: 0 };

  const [lane] = await db
    .select({ id: swimlanes.id })
    .from(swimlanes)
    .where(and(
      eq(swimlanes.boardId, args.boardId),
      eq(swimlanes.tenantId, args.tenantId),
      eq(swimlanes.key, args.targetKey),
    ));
  if (!lane) return { movedTo: null, movedCount: 0 };

  const moved = await db
    .update(tasks)
    .set({ status: args.targetKey, updatedAt: new Date() })
    .where(scopedToTenant(
      tasks,
      args.tenantId,
      eq(tasks.projectId, board.projectId),
      eq(tasks.archived, false),
      sql`${tasks.swimlaneId} is null`,
    ))
    .returning({ id: tasks.id });

  return { movedTo: args.targetKey, movedCount: moved.length };
}
