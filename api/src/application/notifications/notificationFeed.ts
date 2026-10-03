import { desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { freelancerNotifications } from '../../infrastructure/database/schema';
import { acrossTenants } from '../../infrastructure/database/tenantScope';
import { getOrSetCached, invalidateCached, type CacheEnv } from '../../infrastructure/cache/readThroughCache';

/**
 * A user's in-app notification feed: the latest 100 and the unread count.
 *
 * Every signed-in page polls it (the header bell, every 30s), so it is cached per
 * user and invalidated by its only two writers — `notify()` adding a row and
 * {@link markNotificationsRead}. The key space is one key per user, so a direct
 * invalidation is enough; no version token is needed. L1 is kept short because an
 * invalidation only clears the L1 of the isolate that made it.
 */
const FEED_CACHE = { kvTtlSeconds: 3_600, l1TtlMs: 10_000 };
const FEED_LIMIT = 100;

const feedKey = (userId: string): string => `notifications:feed:${userId}`;

export interface NotificationFeed {
  unread: number;
  items: Array<{ id: number; kind: string; title: string; body: string | null; ref: string | null; read: boolean; createdAt: string }>;
}

export function readNotificationFeed(env: CacheEnv, db: Db, userId: string): Promise<NotificationFeed> {
  return getOrSetCached(env, feedKey(userId), () => loadFeed(db, userId), FEED_CACHE);
}

/** Orphan `userId`'s cached feed — called by every writer of their notifications. */
export function invalidateNotificationFeed(env: CacheEnv, userId: string): Promise<void> {
  return invalidateCached(env, feedKey(userId));
}

/** Mark the given notifications (or, with no ids, all of them) read. */
export async function markNotificationsRead(env: CacheEnv, db: Db, userId: string, ids: number[] | null): Promise<void> {
  // A user's feed spans every workspace that notified them — the rows are theirs, not a tenant's.
  const scope = acrossTenants(freelancerNotifications, 'subject_own_rows',
    eq(freelancerNotifications.userId, userId),
    isNull(freelancerNotifications.readAt),
    ids && ids.length > 0 ? inArray(freelancerNotifications.id, ids) : undefined);
  await db.update(freelancerNotifications).set({ readAt: sql`NOW()` }).where(scope);
  await invalidateNotificationFeed(env, userId);
}

async function loadFeed(db: Db, userId: string): Promise<NotificationFeed> {
  const [rows, unreadRows] = await Promise.all([
    db
      .select({
        id: freelancerNotifications.id,
        kind: freelancerNotifications.kind,
        title: freelancerNotifications.title,
        body: freelancerNotifications.body,
        ref: freelancerNotifications.ref,
        readAt: freelancerNotifications.readAt,
        createdAt: freelancerNotifications.createdAt,
      })
      .from(freelancerNotifications)
      .where(acrossTenants(freelancerNotifications, 'subject_own_rows', eq(freelancerNotifications.userId, userId)))
      .orderBy(desc(freelancerNotifications.createdAt))
      .limit(FEED_LIMIT),
    db.select({ value: sql<number>`count(*)::int` })
      .from(freelancerNotifications)
      .where(acrossTenants(freelancerNotifications, 'subject_own_rows', eq(freelancerNotifications.userId, userId), isNull(freelancerNotifications.readAt))),
  ]);
  return {
    unread: Number(unreadRows[0]?.value ?? 0),
    items: rows.map((r) => ({
      id: Number(r.id),
      kind: r.kind,
      title: r.title,
      body: r.body ?? null,
      ref: r.ref ?? null,
      read: r.readAt != null,
      createdAt: new Date(r.createdAt).toISOString(),
    })),
  };
}
