import { bumpCacheVersion, bumpTicketSearchVersion } from '../../infrastructure/cache/readThroughCache';
import type { Env } from '../../env';

/**
 * Cache invalidation for the tenant's project list.
 *
 * Lives in the application layer because application use cases (project
 * provisioning, MCP project tools, work-item conversion) must bust it, and an
 * application module importing a PRESENTATION module to do so inverts the layer
 * order. The HTTP routes import it from here like everyone else.
 */

/** Version-token key for a tenant's cached `/api/projects` list. */
export function projectsListVersionKey(tenantId: number): string {
  return `projects-list:tenant:${tenantId}`;
}

/**
 * Bust the cached `/api/projects` list for a tenant. Call from any write that
 * changes the list rows OR the aggregates it folds in (project CRUD, task
 * count/status/date/archival changes). Bumping a per-tenant version token is one
 * cheap KV write; every list key embedding the old token ages out on its TTL.
 * The KV TTL is the backstop for the rarer aggregates we don't bump explicitly
 * (workflow count, architecture PRD, agent-host assignment, initiative-level
 * goal links) — mirrors the completed-by-assignee convention in reportRoutes.
 */
export async function invalidateProjectsList(env: Env, tenantId: number): Promise<void> {
  // Task/objective/project writes that reshape the list also change what the
  // chat↔ticket link picker can find, so orphan its typeahead cache in the same
  // beat (the picker is a ticket surface, exactly like the projects list).
  await Promise.all([
    bumpCacheVersion(env, projectsListVersionKey(tenantId)),
    bumpTicketSearchVersion(env, tenantId),
  ]);
}
