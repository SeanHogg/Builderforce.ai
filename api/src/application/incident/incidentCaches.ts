/**
 * The ONE cache invalidation for a write to `prod_incidents`. That table is the
 * single incident record, read by `/api/incidents` and by the board Quality lens
 * under separate version tokens; every writer (the incident routes, the ops and
 * ITSM connectors, the board import, the insights tracker alias) bumps both here.
 */
import type { Env } from '../../env';
import { bumpCacheVersion } from '../../infrastructure/cache/readThroughCache';
import { prodIncidentVersionKeys } from '../insights/versionKeys';

export async function bumpProdIncidentCaches(env: Env, tenantId: number): Promise<void> {
  await Promise.all(prodIncidentVersionKeys(tenantId).map((key) => bumpCacheVersion(env, key)));
}
