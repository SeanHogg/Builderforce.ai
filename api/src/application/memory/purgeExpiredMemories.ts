/**
 * Delete every lapsed fact from BOTH memory stores. Housekeeping only — recall already
 * excludes expired rows in SQL, so this reclaims space and keeps the governance view
 * honest; correctness never depends on it having run. Wired into the retention sweep.
 *
 * A removed project fact takes its knowledge-graph relations with it and bumps its
 * project's knowledge version (PRD 38 §8.3), via {@link retireRelationsOfRemovedFacts}.
 */
import { and, eq, sql } from 'drizzle-orm';
import { agentMemory, projectFacts } from '../../infrastructure/database/schema';
import { bumpCacheVersion } from '../../infrastructure/cache/readThroughCache';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { retireRelationsOfRemovedFacts } from '../knowledge/retireFacts';
import { memoryVersionKey } from './memoryCacheVersion';

export async function purgeExpiredMemories(env: Env, db: Db, tenantId?: number): Promise<{ agentMemory: number; projectFacts: number }> {
  const now = new Date();
  try {
    // The tenant predicate is written INLINE in each statement (rather than hoisted
    // into a variable) so the tenant-scope guard can see it, and so the two modes are
    // visibly distinct: an operator sweep is one tenant, the nightly cron is global.
    const [am, pf] = await Promise.all([
      db
        .delete(agentMemory)
        .where(
          and(
            sql`${agentMemory.expiresAt} IS NOT NULL`,
            sql`${agentMemory.expiresAt} <= ${now}`,
            tenantId != null ? eq(agentMemory.tenantId, tenantId) : undefined,
          ),
        )
        .returning({ id: agentMemory.id })
        .catch(() => [] as Array<{ id: string }>),
      db
        .delete(projectFacts)
        .where(
          and(
            sql`${projectFacts.expiresAt} IS NOT NULL`,
            sql`${projectFacts.expiresAt} <= ${now}`,
            tenantId != null ? eq(projectFacts.tenantId, tenantId) : undefined,
          ),
        )
        .returning({ id: projectFacts.id, tenantId: projectFacts.tenantId, projectId: projectFacts.projectId, key: projectFacts.key })
        .catch(() => [] as Array<{ id: string; tenantId: number; projectId: number; key: string }>),
    ]);
    await retireRelationsOfRemovedFacts(env, db, pf);
    if (tenantId != null && am.length + pf.length > 0) await bumpCacheVersion(env, memoryVersionKey(tenantId));
    return { agentMemory: am.length, projectFacts: pf.length };
  } catch {
    return { agentMemory: 0, projectFacts: 0 };
  }
}
