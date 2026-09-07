/**
 * THE cache key for a tenant's human assignee roster, and the one way to drop it.
 *
 * `GET /api/tasks/assignees` serves the roster read-through (membership changes
 * rarely); every membership add/remove path must invalidate it so a new teammate
 * appears immediately rather than after the KV TTL. The key literal used to be
 * written out in the producer (`taskRoutes`) and again in each invalidator
 * (`tenantRoutes`), which is exactly the kind of split that lets one side be
 * renamed and the other quietly stop invalidating anything.
 */
import type { Env } from '../../env';
import { invalidateCached } from '../../infrastructure/cache/readThroughCache';

export const taskAssigneesCacheKey = (tenantId: number | string) => `task-assignees:tenant:${tenantId}`;

/** Drop the cached human assignee list for a tenant. Safe to call without an
 *  `env` (an MCP tool invoked without threaded bindings has no KV) — the
 *  in-isolate entry then expires on its own TTL. */
export async function invalidateTaskAssignees(env: Env | undefined, tenantId: number): Promise<void> {
  if (!env) return;
  await invalidateCached(env, taskAssigneesCacheKey(tenantId));
}
