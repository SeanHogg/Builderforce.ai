/**
 * The cached form of a person's DM inbox (`GET /api/messages/threads`, polled by the
 * header badge and the messages page).
 *
 * One entry per person, keyed on a per-person version token. Every event that changes
 * what their inbox shows — a message sent into one of their threads, their own read
 * cursor moving, a thread opened with them — bumps THEIR token (`bumpInboxes`); the KV TTL
 * only backstops a thread writer outside `DirectMessageService` (the résumé review queue
 * shares the kernel thread tables). Unchanged polls cost no Neon statement.
 */

import type { Env } from '../../env';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { bumpVersion, versionToken } from '../../infrastructure/cache/versionToken';

const INBOX_CACHE = { kvTtlSeconds: 120, l1TtlMs: 5_000 };

const inboxVersionKey = (userId: string): string => `dm-inbox-version:${userId}`;

/** Orphan these people's cached inboxes. */
export async function bumpInboxes(env: Env, userIds: Iterable<string>): Promise<void> {
  await Promise.all([...new Set(userIds)].map((id) => bumpVersion(inboxVersionKey(id), 'bumpInboxes', env)));
}

export async function cachedInbox<T>(env: Env, userId: string, load: () => Promise<T>): Promise<T> {
  const token = await versionToken(env, inboxVersionKey(userId));
  return getOrSetCached(env, `dm-inbox:${userId}:v${token}`, load, INBOX_CACHE);
}
