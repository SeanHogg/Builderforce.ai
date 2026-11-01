import { and, eq, type SQL } from 'drizzle-orm';
import { projectManagerConfigs, pullRequests } from '../../infrastructure/database/schema';

/**
 * The join condition that says a pull request's project has opted into the manager's merge queue.
 *
 * Merging is manager AUTHORITY, so a PR belongs to the `pr-merge` queue only when its project has an
 * ENABLED `project_manager_configs` row of its own. The sweep that selects the projects to work and
 * the CI-verdict signal that wakes that sweep must agree on this, or one wakes the cron gate for PRs
 * the other will never touch. It is a join condition, correlated on the tenant as well as the project:
 * `project_manager_configs` is tenant-owned, and a join on `project_id` alone is the shape that leaks
 * rows across tenants the moment ids collide.
 */
export function mergeQueueOptInOn(): SQL {
  return and(
    eq(projectManagerConfigs.projectId, pullRequests.projectId),
    eq(projectManagerConfigs.tenantId, pullRequests.tenantId),
    eq(projectManagerConfigs.enabled, true),
  ) as SQL;
}
