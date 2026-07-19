import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { boards } from '../../infrastructure/database/schema';

export type CanonicalBoard = typeof boards.$inferSelect;

/**
 * Resolve the authoritative board for a project. Historical environments may
 * contain duplicate board rows from before the one-board constraint was enforced;
 * a lifecycle-managed/template-backed board must win over an older legacy row.
 */
export async function findCanonicalBoard(db: Db, projectId: number, tenantId?: number): Promise<CanonicalBoard | null> {
  const where = tenantId == null
    ? eq(boards.projectId, projectId)
    : and(eq(boards.projectId, projectId), eq(boards.tenantId, tenantId));
  const [board] = await db.select().from(boards).where(where)
    .orderBy(desc(boards.lifecycleManaged), desc(boards.updatedAt), desc(boards.createdAt), desc(boards.id))
    .limit(1);
  return board ?? null;
}
