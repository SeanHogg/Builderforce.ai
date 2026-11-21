/**
 * Is this caller the PLATFORM OPERATOR — the workspace that runs Builderforce itself?
 *
 * Some built-in tools describe the platform, not the tenant (`deploy.status`: which
 * commit the platform's own Workers serve). They mean nothing to a customer workspace
 * and are hidden from it (see `builtinToolEntitlements`).
 *
 * The operator is decided by the ONE platform predicate, the superadmin flag
 * (`resolveIsSuperadmin`, DB truth), applied two ways:
 *   • the CALLER is a platform superadmin (any workspace they are in), or
 *   • the WORKSPACE is owned by a platform superadmin — an active `owner` membership
 *     held by a superadmin user. This is the tenant-level half, so the per-tenant
 *     catalog filter (which has no user) and an agent run (a machine subject, never
 *     superadmin itself) still resolve the operator's own workspace. A superadmin
 *     invited into a customer workspace as a non-owner does not make it the operator.
 *
 * Cached read-through at the superadmin flag's own window, so a demotion bites within
 * a minute.
 */
import { and, eq } from 'drizzle-orm';
import type { Env } from '../../env';
import { buildDatabase } from '../../infrastructure/database/connection';
import { tenantMembers, users } from '../../infrastructure/database/schema';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { resolveIsSuperadmin, SUPERADMIN_FLAG_TTL_SECONDS } from '../../infrastructure/auth/superadminFlag';

/** The ONE spelling of the tenant-level cache key. */
export const platformOperatorTenantCacheKey = (tenantId: number): string => `platform-operator-tenant:${tenantId}`;

/** Is this workspace owned by a platform superadmin? */
export async function isPlatformOperatorTenant(env: Env, tenantId: number): Promise<boolean> {
  return getOrSetCached(
    env,
    platformOperatorTenantCacheKey(tenantId),
    async () => {
      const db = buildDatabase(env);
      const [row] = await db
        .select({ id: tenantMembers.id })
        .from(tenantMembers)
        .innerJoin(users, eq(users.id, tenantMembers.userId))
        .where(and(
          eq(tenantMembers.tenantId, tenantId),
          eq(tenantMembers.role, 'owner'),
          eq(tenantMembers.isActive, true),
          eq(users.isSuperadmin, true),
        ))
        .limit(1);
      return row != null;
    },
    { kvTtlSeconds: SUPERADMIN_FLAG_TTL_SECONDS, l1TtlMs: 15_000 },
  );
}

/** Caller-level OR workspace-level operator — see the module note. */
export async function isPlatformOperator(env: Env, tenantId: number, userId: string | null | undefined): Promise<boolean> {
  if (await resolveIsSuperadmin(env, userId)) return true;
  return isPlatformOperatorTenant(env, tenantId);
}
