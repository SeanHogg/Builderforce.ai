import { eq } from 'drizzle-orm';
import type { Env } from '../../env';
import { buildDatabase } from '../database/connection';
import { users } from '../database/schema';
import { getOrSetCached } from '../cache/readThroughCache';

/**
 * Resolve whether a caller is a platform superadmin — the single source of truth
 * for the superadmin dimension of every entitlement gate.
 *
 * Reads the DB flag (`users.isSuperadmin`), NOT a JWT claim: the tenant-scoped
 * workspace JWT the web app carries doesn't propagate `sa`, and DB truth also can't
 * be a stale token. Cached read-through (L1 + KV) because the flag changes ~never;
 * a demotion propagates within the cache TTL. `agentHost:`/service subs are never
 * superadmin, so they skip the lookup entirely.
 */
export async function resolveIsSuperadmin(env: Env, userId: string | undefined | null): Promise<boolean> {
  if (!userId || userId.startsWith('agentHost:')) return false;
  return getOrSetCached(
    env,
    `superadmin:${userId}`,
    async () => {
      const db = buildDatabase(env);
      const [row] = await db
        .select({ isSuperadmin: users.isSuperadmin })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      return row?.isSuperadmin === true;
    },
    { kvTtlSeconds: 300 },
  );
}
