import { getOrSetCached, invalidateCached, type CacheEnv } from '../../infrastructure/cache/readThroughCache';

/**
 * The two conversation inboxes — an employer tenant's, and a freelancer's across
 * every tenant — with their unread counts.
 *
 * The messages button polls one of them every 30s on every signed-in page, and each
 * read is a list plus a correlated unread COUNT per conversation. So each inbox is
 * cached under ONE key (one per tenant, one per freelancer: a bounded keyspace, so
 * a direct invalidation and no version token), and every handler that writes a
 * conversation calls {@link invalidateConversationLists} once its writes are done —
 * after the read watermark too, so a send never caches a pre-watermark count.
 */
const INBOX_CACHE = { kvTtlSeconds: 3_600, l1TtlMs: 10_000 };

const employerInboxKey = (tenantId: number): string => `conversations:employer:${tenantId}`;
const freelancerInboxKey = (userId: string): string => `conversations:freelancer:${userId}`;

export function readEmployerInbox<T>(env: CacheEnv, tenantId: number, load: () => Promise<T>): Promise<T> {
  return getOrSetCached(env, employerInboxKey(tenantId), load, INBOX_CACHE);
}

export function readFreelancerInbox<T>(env: CacheEnv, userId: string, load: () => Promise<T>): Promise<T> {
  return getOrSetCached(env, freelancerInboxKey(userId), load, INBOX_CACHE);
}

/** A conversation changed: both parties' inboxes are stale. */
export async function invalidateConversationLists(
  env: CacheEnv,
  conversation: { tenantId: number | string; freelancerUserId: string },
): Promise<void> {
  await Promise.all([
    invalidateCached(env, employerInboxKey(Number(conversation.tenantId))),
    invalidateCached(env, freelancerInboxKey(conversation.freelancerUserId)),
  ]);
}
