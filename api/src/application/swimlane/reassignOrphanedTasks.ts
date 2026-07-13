/**
 * Board referential integrity — keep `tasks.status` pointing at a real lane.
 *
 * Fully-configurable boards couple a task to its lane by STRING convention
 * (`task.status === swimlane.key`) with no FK (see schema note on `swimlanes`).
 * Deleting a lane therefore ORPHANS every task that was sitting in it: the task
 * keeps the now-dead status string and only surfaces in the board's
 * auto-appended fallback column. This helper closes that gap on the delete path
 * by REASSIGNING those tasks onto a surviving lane BEFORE the lane row is
 * removed, so no task is ever left holding a status no lane defines.
 *
 * The fallback-lane choice is a pure function (`pickFallbackLane`) so the
 * selection policy is unit-tested without a DB; the DB-touching reassignment
 * (`reassignTasksFromLane`) is a thin wrapper around it.
 */
import { and, eq } from 'drizzle-orm';
import { boards, swimlanes, tasks } from '../../infrastructure/database/schema';
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
export function pickFallbackLane(survivors: SurvivingLane[]): string | null {
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
  },
): Promise<ReassignResult> {
  const target = pickFallbackLane(args.survivors);
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
    .where(and(eq(tasks.projectId, board.projectId), eq(tasks.status, args.deletedLaneKey)))
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
  args: { tenantId: number; boardId: string; deletedLaneId: string; deletedLaneKey: string },
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
  });
}
