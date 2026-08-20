/**
 * Cached reads + invalidation for the migration console.
 *
 * `MigrationService` takes a `MigrationStore` port and imports no infrastructure
 * at all, which is the shape the rest of the application layer is being moved
 * towards — so the read-through cache does NOT go inside it. It goes here, one
 * module out: the key shape and the version token live beside each other, the
 * route calls a function, and the service stays a pure orchestration over its
 * port.
 *
 * Every write path in the console bumps the same token, so a discover, a mapping
 * edit, an import or a rollback all age out both the list and the detail.
 */
import { bumpCacheVersion, getCacheVersion, getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import type { MigrationService, RunDetail } from './MigrationService';
import type { Env } from '../../env';

const versionKey = (tenantId: number) => `migrations:${tenantId}`;

/** Bumped by every migration write so the two reads below recompute. */
export function invalidateMigrations(env: Env, tenantId: number): Promise<void> {
  return bumpCacheVersion(env, versionKey(tenantId)).then(() => undefined);
}

/** Run history for the console list. */
export async function getMigrationRuns(service: MigrationService, env: Env, tenantId: number) {
  const ver = await getCacheVersion(env, versionKey(tenantId));
  return getOrSetCached(env, `migrations:list:${tenantId}:${ver}`, () => service.listRuns(tenantId));
}

/** Staging snapshot for one run. */
export async function getMigrationDetail(
  service: MigrationService,
  env: Env,
  tenantId: number,
  runId: string,
): Promise<RunDetail | null> {
  const ver = await getCacheVersion(env, versionKey(tenantId));
  return getOrSetCached(env, `migrations:run:${tenantId}:${runId}:${ver}`, () => service.getDetail(runId, tenantId));
}
