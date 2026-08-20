import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { boards, projects } from '../../infrastructure/database/schema';

export type CanonicalBoard = typeof boards.$inferSelect;

/**
 * Resolve the authoritative board for a project.
 *
 * `projects.primary_board_id` (migration 1081) is the STORED answer and wins outright.
 * Before it existed, the answer was re-derived on every read from a four-key sort, which
 * was correct but invisible: project 11 held 7 boards, 6 of them dead config, and nothing
 * in the data said which one the platform used — so whether the Coordinator state
 * machine or the simple single-hop path ran depended on a sort nobody could see.
 *
 * The derivation below is kept as the FALLBACK, unchanged, for a project whose pointer
 * has not been set (created before the backfill, or created and not yet stamped). 1081
 * also merged the duplicates and installed `UNIQUE(project_id)`, so on a migrated
 * database the fallback resolves at most one row anyway.
 */
export async function findCanonicalBoard(db: Db, projectId: number, tenantId?: number): Promise<CanonicalBoard | null> {
  const [pinned] = await db
    .select({ board: boards })
    .from(projects)
    .innerJoin(boards, eq(boards.id, projects.primaryBoardId))
    .where(tenantId == null ? eq(projects.id, projectId) : and(eq(projects.id, projectId), eq(projects.tenantId, tenantId)))
    .limit(1);
  if (pinned?.board) return pinned.board;

  const where = tenantId == null
    ? eq(boards.projectId, projectId)
    : and(eq(boards.projectId, projectId), eq(boards.tenantId, tenantId));
  const [board] = await db.select().from(boards).where(where)
    .orderBy(desc(boards.lifecycleManaged), desc(boards.updatedAt), desc(boards.createdAt), desc(boards.id))
    .limit(1);
  return board ?? null;
}
