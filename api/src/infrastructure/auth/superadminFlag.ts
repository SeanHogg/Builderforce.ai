import { eq } from 'drizzle-orm';
import type { Env } from '../../env';
import { buildDatabase } from '../database/connection';
import { users } from '../database/schema';
import { getOrSetCached, invalidateCached } from '../cache/readThroughCache';
import { isMachineSubject } from './machineSubject';

/**
 * Resolve whether a caller is a platform superadmin — the single source of truth
 * for the superadmin dimension of every entitlement gate.
 *
 * Reads the DB flag (`users.isSuperadmin`), NOT a JWT claim: the tenant-scoped
 * workspace JWT the web app carries doesn't propagate `sa`, and DB truth also can't
 * be a stale token. Cached read-through (L1 + KV) because the flag changes ~never;
 * a demotion propagates within {@link SUPERADMIN_FLAG_TTL_SECONDS} (60 s — this
 * also gates every `/api/admin/*` request via `superAdminMiddleware`, so the
 * window is kept at the KV floor), or immediately through
 * {@link invalidateSuperadminFlag}. Machine/service subs (`agentHost:*`,
 * `embed:*` — see {@link isMachineSubject}) have no `users` row and are never
 * superadmin, so they skip the lookup entirely.
 */
/** KV TTL of the cached flag — the KV minimum, so a demotion bites within a minute. */
export const SUPERADMIN_FLAG_TTL_SECONDS = 60;
/** L1 shorter than KV so an isolate copy never outlives the KV window. */
const SUPERADMIN_FLAG_L1_TTL_MS = 15_000;

/** The ONE spelling of the cache key — read and invalidated through this. */
export const superadminFlagCacheKey = (userId: string): string => `superadmin:${userId}`;

export async function resolveIsSuperadmin(env: Env, userId: string | undefined | null): Promise<boolean> {
  if (!userId || isMachineSubject(userId)) return false;
  return getOrSetCached(
    env,
    superadminFlagCacheKey(userId),
    async () => {
      const db = buildDatabase(env);
      const [row] = await db
        .select({ isSuperadmin: users.isSuperadmin })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      return row?.isSuperadmin === true;
    },
    { kvTtlSeconds: SUPERADMIN_FLAG_TTL_SECONDS, l1TtlMs: SUPERADMIN_FLAG_L1_TTL_MS },
  );
}

/**
 * Drop a user's cached superadmin flag. Call from ANY write to `users.is_superadmin`
 * (grant or revoke) so the change bites on the next request instead of after the TTL.
 * Today the flag is only ever set by migration/SQL (see migrations/0002), so there
 * is no in-app writer yet — this is the hook such a writer must call.
 */
export async function invalidateSuperadminFlag(env: Env, userId: string): Promise<void> {
  await invalidateCached(env, superadminFlagCacheKey(userId));
}
