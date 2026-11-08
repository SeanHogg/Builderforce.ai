/**
 * boardWrites — the ONE seam that updates or deletes a `boards` row.
 *
 * A board row feeds three read-through caches: the lane router's facts (`laneRouting.ts`: board id, lifecycle
 * flag, lanes, staffing), the project's lane-ordinal map and the board's cached lane list. The REST routes and the
 * Brain's board tools each wrote the row directly and dropped none of them, so a deleted or re-flagged board kept
 * routing lane entries for the cache TTL. Every board update / delete goes through here instead, and the
 * invalidation travels with the write.
 */
import { and, eq, type SQL } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { boards } from '../../infrastructure/database/schema';
import { invalidateBoardLaneOrdinals, invalidateSwimlaneOrdinals } from './laneOrdinals';
import { invalidateBoardLanesCache } from './boardReads';

export type BoardRow = typeof boards.$inferSelect;

/** Update a tenant's board and drop the caches derived from it. Returns the updated row, or undefined when none matched. */
export async function updateBoardRow(
  env: Env | undefined,
  db: Db,
  args: { tenantId: number; boardId: string; patch: Partial<typeof boards.$inferInsert>; also?: SQL },
): Promise<BoardRow | undefined> {
  const where = args.also
    ? and(eq(boards.id, args.boardId), eq(boards.tenantId, args.tenantId), args.also)
    : and(eq(boards.id, args.boardId), eq(boards.tenantId, args.tenantId));
  const [row] = await db.update(boards).set(args.patch).where(where).returning();
  if (row) await invalidateBoardLaneOrdinals(env, db, args.boardId);
  return row;
}

/** Delete a tenant's board and drop the caches derived from it. Returns whether a row was deleted. */
export async function deleteBoardRow(
  env: Env | undefined,
  db: Db,
  args: { tenantId: number; boardId: string; also?: SQL },
): Promise<boolean> {
  const where = args.also
    ? and(eq(boards.id, args.boardId), eq(boards.tenantId, args.tenantId), args.also)
    : and(eq(boards.id, args.boardId), eq(boards.tenantId, args.tenantId));
  const [row] = await db.delete(boards).where(where).returning({ projectId: boards.projectId });
  if (!row) return false;
  // The row is gone, so the project comes from the delete's own RETURNING rather than a lookup.
  await Promise.all([
    invalidateBoardLanesCache(env, args.tenantId, args.boardId),
    row.projectId != null ? invalidateSwimlaneOrdinals(env, row.projectId, args.tenantId) : Promise.resolve(),
  ]);
  return true;
}
