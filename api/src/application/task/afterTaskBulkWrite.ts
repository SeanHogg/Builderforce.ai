/**
 * The cache invalidation + live push after a write that touched MANY tickets at once
 * (archive / restore in bulk). ONE function, called by the HTTP decomposition-cleanup
 * route and by the `tasks.archive_many` / `tasks.archive_where` tools (those two are
 * therefore exempt from `callBuiltinTool`'s generic `tasks.*` post-write hook).
 *
 * Also home of the task-tree version key and the per-tenant ticket rollup bust, so the
 * single-ticket PATCH path and the bulk path invalidate the SAME keys.
 *
 * Every step is best-effort: a failed bump/broadcast is REPORTED and never fails the
 * write that already happened.
 */
import type { Env } from '../../env';
import { bumpCacheVersion } from '../../infrastructure/cache/readThroughCache';
import { broadcastProjectChanged } from '../../infrastructure/relay/broadcastRoom';
import { invalidateProjectsList } from '../project/projectsListCache';
import { pmoVersionKey } from '../pmo/pmoCacheKeys';
import { invalidateCompletedByAssignee, roiVersionKey } from '../reports/reportCache';
import { reportCaughtError } from '../observability/caughtErrorReporter';

const SOURCE = 'application/task/afterTaskBulkWrite.ts';

/** The epic-tree cache version key the `/:id/tree` read checks. */
export const taskTreeVersionKey = (projectId: number): string => `task-tree-version:project:${projectId}`;

/** Bump one project's epic-tree cache version (no-op for a missing project). Best-effort. */
export function bumpTaskTreeVersion(env: Env, projectId: number | null | undefined, source = SOURCE): Promise<void> {
  if (projectId == null) return Promise.resolve();
  return bumpCacheVersion(env, taskTreeVersionKey(projectId)).catch((error) => {
    reportCaughtError(error, { source, operation: 'bumpTaskTreeVersion' });
  });
}

/**
 * Bust the per-tenant rollups a ticket's status OR archived flag feeds: the
 * completed-by-assignee report window and the ROI time metrics. Best-effort.
 */
export async function invalidateTaskRollups(env: Env, tenantId: number, source = SOURCE): Promise<void> {
  await Promise.all([
    invalidateCompletedByAssignee(env, tenantId).catch((error) => {
      reportCaughtError(error, { source, operation: 'invalidateCompletedByAssignee' });
    }),
    bumpCacheVersion(env, roiVersionKey(tenantId)).catch((error) => {
      reportCaughtError(error, { source, operation: 'bumpRoiVersion' });
    }),
  ]);
}

/**
 * After a bulk ticket write: per affected project bump the epic tree and push a live
 * board refresh; once per tenant bust the projects-list aggregates, the PMO rollup and
 * the ticket rollups (completed-by-assignee, ROI).
 */
export async function afterTaskBulkWrite(env: Env | undefined, tenantId: number, projectIds: Iterable<number>): Promise<void> {
  if (!env) return;
  const unique = [...new Set(projectIds)];
  if (unique.length === 0) return;
  await Promise.all([
    ...unique.map((pid) => bumpTaskTreeVersion(env, pid)),
    ...unique.map((pid) => broadcastProjectChanged(env, tenantId, pid).catch((error) => {
      reportCaughtError(error, { source: SOURCE, operation: 'broadcastProjectChanged' });
    })),
    // Archiving changes task counts and the spine's shape.
    invalidateProjectsList(env, tenantId).catch((error) => {
      reportCaughtError(error, { source: SOURCE, operation: 'invalidateProjectsList' });
    }),
    bumpCacheVersion(env, pmoVersionKey(tenantId)).catch((error) => {
      reportCaughtError(error, { source: SOURCE, operation: 'bumpPmoVersion' });
    }),
    invalidateTaskRollups(env, tenantId),
  ]);
}
