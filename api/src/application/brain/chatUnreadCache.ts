/**
 * The caller's unread-chat counts, cached for the polled attention snapshot.
 *
 * Unread is per-user live state, so it cannot share the tenant's cache entry (which is why
 * the combined snapshot used to miss on almost every poll). It is keyed on two tokens:
 *
 *   • the USER token — bumped when that user marks a chat read (`markChatRead`);
 *   • the TENANT token — bumped when any message lands in one of the tenant's chats
 *     (`appendRaw`, system posts), since that can raise anyone's count.
 *
 * Either bump orphans the entry; the KV TTL is only the backstop for a writer that does
 * neither (e.g. a meeting caption posted outside a request).
 */

import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { readThroughFresh } from '../runtime/freshReadThrough';
import { versionToken } from '../../infrastructure/cache/versionToken';
import { unreadTenantKey, unreadUserKey } from './chatCacheVersions';
import { unreadCountsForUser } from './chatReadState';

const UNREAD_CACHE = { kvTtlSeconds: 300, l1TtlMs: 15_000 };

export interface UnreadSnapshot {
  chatUnread: Record<number, number>;
  total: number;
}

async function loadUnreadStrict(db: Db, tenantId: number, userId: string): Promise<UnreadSnapshot> {
  const chatUnread = await unreadCountsForUser(db, tenantId, userId);
  return { chatUnread, total: Object.values(chatUnread).reduce((a, b) => a + b, 0) };
}

/** The uncached read (no-env path): a Neon error degrades to "nothing unread" � nothing is cached. */
export async function loadUnread(db: Db, tenantId: number, userId: string): Promise<UnreadSnapshot> {
  return loadUnreadStrict(db, tenantId, userId).catch(() => ({ chatUnread: {}, total: 0 }));
}

export async function readUnreadCached(
  env: Env, db: Db, tenantId: number, userId: string, fresh?: boolean,
): Promise<UnreadSnapshot> {
  const [tenantToken, userToken] = await Promise.all([versionToken(env, unreadTenantKey(tenantId)), versionToken(env, unreadUserKey(tenantId, userId))]);
  const key = `attention:unread:${tenantId}:${userId}:t${tenantToken}:u${userToken}`;
  // Strict: an error must propagate so a failure is never cached for the TTL.
  return readThroughFresh(env, key, () => loadUnreadStrict(db, tenantId, userId), UNREAD_CACHE, fresh);
}
