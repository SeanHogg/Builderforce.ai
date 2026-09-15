import { eq, inArray } from 'drizzle-orm';
import { siblingDatabaseOf, type Db } from './connection';
import { projectSites } from './schema';

/**
 * THE CASCADES THE APPS DATABASE CANNOT RECEIVE FROM CORE.
 *
 * On a single database, deleting a project or a tenant took its published site and
 * everything under it with it: `project_sites.project_id` / `tenant_id` cascade, and
 * every other site table hangs off `project_sites`. With the apps runtime on its own
 * endpoint those FKs cannot exist — Postgres does not enforce a key across databases —
 * so the delete path does the one step the constraint used to: remove the
 * `project_sites` rows. Everything below them (collections → records, users →
 * sessions and subscriptions, releases, traffic) still cascades INSIDE the apps
 * database, whose migration keeps those FKs.
 *
 * Called AFTER the core delete has committed, so a core delete that fails or rolls
 * back never strands a project without its site. When the apps runtime is not split
 * out, the core FK has already cascaded and these are no-ops.
 */
export async function deleteAppsForProjects(core: Db, projectIds: readonly number[]): Promise<void> {
  if (projectIds.length === 0) return;
  await siblingDatabaseOf(core, 'apps').delete(projectSites).where(inArray(projectSites.projectId, [...projectIds]));
}

/** {@link deleteAppsForProjects} for a whole workspace. */
export async function deleteAppsForTenant(core: Db, tenantId: number): Promise<void> {
  await siblingDatabaseOf(core, 'apps').delete(projectSites).where(eq(projectSites.tenantId, tenantId));
}
