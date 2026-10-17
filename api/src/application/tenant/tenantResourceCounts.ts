/**
 * Per-tenant project and agent-host counts for the plan-limit guard.
 *
 * Every create path asks "is this tenant at its cap?", and that used to be an
 * uncached `count()` per call — a Neon round trip that also keeps the compute
 * awake. The counts are now served from the read-through cache under a
 * per-tenant VERSION TOKEN that every insert / delete of the entity bumps
 * ({@link bumpTenantProjectCount}, {@link bumpTenantAgentHostCount}), so a check
 * right after a create in the same isolate re-counts instead of reading the old
 * number. Across isolates the version token itself sits in L1 for up to 30s, so a
 * concurrent create on another isolate inside that window can read one behind —
 * the same window every version-token cache in the API accepts.
 *
 * The count is unfiltered (archived projects still count toward the cap), so a
 * status change is not a count change and does not need to bump.
 */

import { count, eq } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { agentHosts, projects } from '../../infrastructure/database/schema';
import { bumpCacheVersion, getCacheVersion, getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { reportCaughtError } from '../observability/caughtErrorReporter';

const SOURCE = 'application/tenant/tenantResourceCounts.ts';

type CountedResource = 'projects' | 'agentHosts';

const versionKey = (resource: CountedResource, tenantId: number): string =>
  `plan-count-version:${resource}:tenant:${tenantId}`;

/** The token makes the entry exact; the TTL only bounds how long an orphan lingers. */
const COUNT_KV_TTL_SECONDS = 3600;

async function cachedCount(
  env: Env,
  resource: CountedResource,
  tenantId: number,
  load: () => Promise<number>,
): Promise<number> {
  const token = await getCacheVersion(env, versionKey(resource, tenantId));
  return getOrSetCached(env, `plan-count:v1:${resource}:tenant:${tenantId}:v:${token}`, load, {
    kvTtlSeconds: COUNT_KV_TTL_SECONDS,
  });
}

export function countTenantProjects(env: Env, db: Db, tenantId: number): Promise<number> {
  return cachedCount(env, 'projects', tenantId, async () => {
    const [row] = await db.select({ total: count() }).from(projects).where(eq(projects.tenantId, tenantId));
    return Number(row?.total ?? 0);
  });
}

export function countTenantAgentHosts(env: Env, db: Db, tenantId: number): Promise<number> {
  return cachedCount(env, 'agentHosts', tenantId, async () => {
    const [row] = await db.select({ total: count() }).from(agentHosts).where(eq(agentHosts.tenantId, tenantId));
    return Number(row?.total ?? 0);
  });
}

/** Best-effort (never throws) so it can follow a committed write without failing it.
 *  Runs without an env too: that still drops this isolate's L1 copy of the token. */
async function bump(env: Env | undefined, resource: CountedResource, tenantId: number): Promise<void> {
  await bumpCacheVersion(env, versionKey(resource, tenantId)).catch((error) => {
    reportCaughtError(error, { source: SOURCE, operation: `bump:${resource}` });
  });
}

/** Call after EVERY insert or hard delete of a `projects` row for `tenantId`. */
export function bumpTenantProjectCount(env: Env | undefined, tenantId: number): Promise<void> {
  return bump(env, 'projects', tenantId);
}

/** Call after EVERY insert or delete of an `agent_hosts` row for `tenantId`. */
export function bumpTenantAgentHostCount(env: Env | undefined, tenantId: number): Promise<void> {
  return bump(env, 'agentHosts', tenantId);
}
