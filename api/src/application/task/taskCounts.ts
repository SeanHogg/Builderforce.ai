/**
 * THE task tally a dashboard tile needs — total / in progress / done plus the
 * recent creation timestamps for its 14-day sparkline — computed in SQL.
 *
 * The dashboard used to call `GET /api/tasks` for this: every non-archived task in
 * the tenant, each enriched with PRD counts, PR build signals and plan verdicts,
 * shipped to the browser so it could read `.length` and two `.filter().length`s.
 * This is one aggregate plus one bounded timestamp read, cached per tenant/project.
 *
 * Parity with `TaskService.listTasks` (what the tile used to count): non-archived
 * tasks in the tenant's projects, excluding IDE-storage projects; `projectId`
 * narrows to one project (a project outside the tenant simply counts zero).
 *
 * Cached behind the tenant's projects-list version token — every write that
 * changes task count/status/archival already bumps it (`invalidateProjectsList`) —
 * with a short TTL as the backstop for writers that do not.
 */
import { and, count, eq, gte, sql, desc } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { projects, tasks } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { getCacheVersion, getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { projectsListVersionKey } from '../project/projectsListCache';

export interface TaskCounts {
  total: number;
  inProgress: number;
  done: number;
  /**
   * `createdAt` of tasks created in the trailing {@link RECENT_WINDOW_DAYS} days
   * (newest first, capped at {@link RECENT_CAP}). The client buckets them into its
   * own local calendar days; everything older is `total - recentCreatedAt.length`.
   */
  recentCreatedAt: string[];
}

/** One day wider than the 14-day sparkline so any client timezone is covered. */
export const RECENT_WINDOW_DAYS = 15;
export const RECENT_CAP = 2000;

export async function computeTaskCounts(db: Db, tenantId: number, projectId?: number): Promise<TaskCounts> {
  const scope = scopedToTenant(
    tasks,
    tenantId,
    eq(tasks.archived, false),
    eq(projects.isIdeStorage, false),
    projectId != null ? eq(tasks.projectId, projectId) : undefined,
  );
  const since = new Date(Date.now() - RECENT_WINDOW_DAYS * 86_400_000);
  const [[agg], recent] = await Promise.all([
    db
      .select({
        total: count(),
        inProgress: sql<number>`count(*) filter (where ${tasks.status} = 'in_progress')`,
        done: sql<number>`count(*) filter (where ${tasks.status} = 'done')`,
      })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(scope),
    db
      .select({ createdAt: tasks.createdAt })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(and(scope, gte(tasks.createdAt, since)))
      .orderBy(desc(tasks.createdAt))
      .limit(RECENT_CAP),
  ]);
  return {
    total: Number(agg?.total ?? 0),
    inProgress: Number(agg?.inProgress ?? 0),
    done: Number(agg?.done ?? 0),
    recentCreatedAt: recent.map((r) => (r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt))),
  };
}

/** {@link computeTaskCounts}, read-through cached per tenant + project + version. */
export async function getTaskCounts(db: Db, env: Env, tenantId: number, projectId?: number): Promise<TaskCounts> {
  const version = await getCacheVersion(env, projectsListVersionKey(tenantId));
  return getOrSetCached(
    env,
    `task-counts:tenant:${tenantId}:project:${projectId ?? 'all'}:v:${version}`,
    () => computeTaskCounts(db, tenantId, projectId),
    { kvTtlSeconds: 120, l1TtlMs: 30_000 },
  );
}
