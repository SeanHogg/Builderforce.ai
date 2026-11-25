/**
 * Backfill the Canvas pull projection (WC-G009) for boards written before the projector existed.
 *
 * One tenant at a time, one page of boards at a time: per page it runs ONE query each for the boards,
 * their objects, their edges and their already-projected records (never a query per board), plans the
 * whole page with the same `planCanvasProjection` the live reconciler uses, and writes it with one
 * records insert and one change insert. Re-runnable: a record already in line with its row plans no
 * write, and the rows are the source of truth, so it never leaves a stale projection behind.
 * `dryRun` plans and counts without writing.
 */

import { and, asc, eq, gt, inArray } from 'drizzle-orm';
import { destinationKey } from '@builderforce/local-first';
import type { Db } from '../../../infrastructure/database/connection';
import { creationSessionConnections, creationSessionObjects, creationSessions } from '../../../infrastructure/database/schema';
import {
  desiredBoardRecords,
  planCanvasProjection,
  projectedRecordsOf,
  writeCanvasProjection,
  type CanvasProjectionScope,
} from './canvasSyncProjection';

export const BACKFILL_PAGE_SIZE = 100;
export const BACKFILL_MAX_PAGE_SIZE = 500;

export interface CanvasBackfillPage {
  boards: number;
  written: number;
  dryRun: boolean;
  /** Pass back as `afterId` for the next page; null when the tenant has no more boards. */
  nextAfterId: string | null;
}

export async function backfillCanvasSyncPage(
  db: Db,
  scope: CanvasProjectionScope,
  options: { afterId?: string; limit?: number; dryRun?: boolean; now?: Date } = {},
): Promise<CanvasBackfillPage> {
  const limit = Math.min(Math.max(options.limit ?? BACKFILL_PAGE_SIZE, 1), BACKFILL_MAX_PAGE_SIZE);
  const dryRun = options.dryRun === true;
  const now = options.now ?? new Date();
  const boards = await db
    .select({ id: creationSessions.id, title: creationSessions.title, mode: creationSessions.mode, status: creationSessions.status, updatedAt: creationSessions.updatedAt })
    .from(creationSessions)
    .where(and(eq(creationSessions.tenantId, scope.tenantId), options.afterId ? gt(creationSessions.id, options.afterId) : undefined))
    .orderBy(asc(creationSessions.id))
    .limit(limit);
  if (boards.length === 0) return { boards: 0, written: 0, dryRun, nextAfterId: null };

  const ids = boards.map((board) => board.id);
  const [objects, edges, existing] = await Promise.all([
    db.select().from(creationSessionObjects).where(inArray(creationSessionObjects.sessionId, ids)),
    db.select().from(creationSessionConnections).where(inArray(creationSessionConnections.sessionId, ids)),
    projectedRecordsOf(db, scope.tenantId, ids),
  ]);
  const desired = boards.flatMap((board) => desiredBoardRecords(
    board,
    objects.filter((row) => row.sessionId === board.id),
    edges.filter((row) => row.sessionId === board.id),
  ));
  const changes = planCanvasProjection(desired, existing, destinationKey(scope.destination), now);
  if (!dryRun) await writeCanvasProjection(db, scope, changes, now);
  return {
    boards: boards.length,
    written: changes.length,
    dryRun,
    nextAfterId: boards.length === limit ? boards[boards.length - 1]!.id : null,
  };
}
