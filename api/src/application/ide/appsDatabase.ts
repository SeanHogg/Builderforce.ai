import { getTableName } from 'drizzle-orm';
import { siblingDatabaseOf, type Db } from '../../infrastructure/database/connection';
import {
  projectSites,
  siteCollections,
  siteRecords,
  siteReleases,
  siteSubscriptions,
  siteTrafficDaily,
  siteUserSessions,
  siteUsers,
} from '../../infrastructure/database/schema';

/**
 * The relations the apps database owns — `apps-migrations/0001` creates exactly these.
 * Derived from the Drizzle tables rather than typed as strings, so a renamed table
 * cannot silently fall out of the set and back onto the core database.
 */
export const APPS_TABLES: ReadonlySet<string> = new Set(
  [projectSites, siteCollections, siteRecords, siteReleases, siteSubscriptions, siteTrafficDaily, siteUserSessions, siteUsers]
    .map((table) => getTableName(table)),
);

/**
 * The database that owns the marketplace apps' runtime — `project_sites` and every
 * `site_*` table — for a caller holding the core handle.
 *
 * Production splits it onto its own Neon endpoint (NEON_APPS_DATABASE_URL) so public
 * app traffic wakes THAT endpoint and not the core one, which bills for every minute
 * it is awake. Unbound (local, tests, before the cutover) it is the core database,
 * where the same tables also exist.
 *
 * THE RULE: every statement whose target is a site table runs on this handle, and
 * every statement on a core table keeps the core one. No statement may join the two —
 * they are different databases — so a read that needs both reads one side, then the
 * other, by id. Foreign keys into core are bare ids for the same reason, and the
 * cascades they used to give are done in `infrastructure/database/appsCascade.ts`.
 */
export function appsDatabaseOf(db: Db): Db {
  return siblingDatabaseOf(db, 'apps');
}

/**
 * The database that holds `table` — the apps one for a site table, the core `db`
 * otherwise. For code that is generic over tables (the entity layer, the registry
 * projection), which knows a relation by name rather than by the module that owns it.
 */
export function databaseForTable(db: Db, table: string): Db {
  return APPS_TABLES.has(table) ? appsDatabaseOf(db) : db;
}
