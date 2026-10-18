/**
 * ONE place for the per-chat cache version tokens behind the polled chat reads
 * (`/chats/:id/messages`, `/agents`, `/members`, `/runs`).
 *
 * Two tokens per chat, because two different things change under a poller:
 *
 *   • messages  — the transcript: bumped by every write of `brain_chat_messages`
 *                 (`appendRaw`, system/consolidation inserts, thumbs feedback);
 *   • structure — who may see the chat and what hangs off it: members, visibility,
 *                 archive, invited agents, ticket links. Bumped by their writers.
 *
 * A cached entry embeds the tokens it depends on, so a write orphans it instead of
 * the writer enumerating keys. Entries are per (chat, user) because the access
 * verdict is part of what is cached — a hit costs zero statements, including the
 * access check. The KV TTL is only the backstop for a writer that bypasses these. A bump
 * clears this isolate at once; others see it after KV propagation (about 60 s across PoPs)
 * or their short L1 expiring, whichever is later.
 *
 * Bumps read the ambient request scope's env (see `requestScope.ts`) so the deep
 * write modules that hold only a `Db` do not need an `Env` threaded through them.
 */

import { eq } from 'drizzle-orm';
import type { Env } from '../../env';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { ambientEnv, bumpVersion, versionToken } from '../../infrastructure/cache/versionToken';
import type { Db } from '../../infrastructure/database/connection';
import { chatReadState } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';

/** KV TTL for chat reads: the version token is what keeps them fresh, this bounds orphans. */
export const CHAT_READ_CACHE = { kvTtlSeconds: 120, l1TtlMs: 5_000 };

const messagesKey = (chatId: number): string => `chat-messages-version:${chatId}`;
const structureKey = (chatId: number): string => `chat-structure-version:${chatId}`;

/** A transcript row was written or edited. `env` defaults to the ambient request scope. */
export function bumpChatMessages(chatId: number, env: Env | undefined = ambientEnv()): Promise<void> {
  return bumpVersion(messagesKey(chatId), 'bumpChatMessages', env);
}

/** Membership, visibility, archive, invited agents or ticket links changed. */
export function bumpChatStructure(chatId: number, env: Env | undefined = ambientEnv()): Promise<void> {
  return bumpVersion(structureKey(chatId), 'bumpChatStructure', env);
}

export interface ChatReadScope {
  tenantId: number;
  chatId: number;
  userId: string;
  /** Distinguishes variants of one read (limit, cursor, …). */
  variant?: string;
  /** Fold the transcript token into the key (message reads). */
  messages?: boolean;
  /** Extra already-resolved tokens (e.g. the tenant's execution-state version). */
  tokens?: readonly string[];
}

/** Thrown by a loader to hand back a value WITHOUT caching it (a 404 must not stick). */
class Uncached<T> {
  constructor(readonly value: T) {}
}

/**
 * Serve `load()` from the cache, keyed on the chat's tokens. `isCacheable` lets the
 * loader's own verdict (e.g. an `{ error }` for a chat the caller cannot see) stay out
 * of the cache, so a denial never outlives the grant that follows it.
 */
export async function cachedChatRead<T>(
  env: Env | undefined,
  name: string,
  scope: ChatReadScope,
  load: () => Promise<T>,
  isCacheable: (value: T) => boolean = () => true,
): Promise<T> {
  if (!env) return load();
  const [structure, messages] = await Promise.all([
    versionToken(env, structureKey(scope.chatId)),
    scope.messages ? versionToken(env, messagesKey(scope.chatId)) : Promise.resolve('-'),
  ]);
  const key = `chat-read:${name}:${scope.tenantId}:${scope.chatId}:${scope.userId}:${scope.variant ?? '-'}:s${structure}:m${messages}:${(scope.tokens ?? []).join(':')}`;
  try {
    return await getOrSetCached(env, key, async () => {
      const value = await load();
      if (!isCacheable(value)) throw new Uncached(value);
      return value;
    }, CHAT_READ_CACHE);
  } catch (error) {
    if (error instanceof Uncached) return error.value as T;
    throw error;
  }
}

/** `{ error }` results are the not-found / forbidden shape every chat use case returns. */
export const isNotError = (value: unknown): boolean =>
  !(value && typeof value === 'object' && !Array.isArray(value) && 'error' in (value as object));

// ── team / manager singleton chats ──────────────────────────────────────────────
// `GET /team-chat` is resolve-or-create by SCOPE (project / team / tenant), so its key
// cannot name a chat id up front. It rides one tenant-level token instead, bumped when a
// chat is renamed, locked or archived (the only writes that change what it returns besides
// `updatedAt`, which ages out with the TTL).

const teamChatKey = (tenantId: number): string => `team-chat-version:${tenantId}`;

export function bumpTeamChats(tenantId: number, env: Env | undefined = ambientEnv()): Promise<void> {
  return bumpVersion(teamChatKey(tenantId), 'bumpTeamChats', env);
}

export async function cachedTeamChat<T>(
  env: Env | undefined,
  tenantId: number,
  userId: string,
  scope: { projectId: number | null; teamId: number | null },
  load: () => Promise<T>,
): Promise<T> {
  if (!env) return load();
  const token = await versionToken(env, teamChatKey(tenantId));
  const key = `team-chat:${tenantId}:${userId}:p${scope.projectId ?? '-'}:t${scope.teamId ?? '-'}:v${token}`;
  try {
    return await getOrSetCached(env, key, async () => {
      const value = await load();
      if (!isNotError(value)) throw new Uncached(value);
      return value;
    }, { kvTtlSeconds: 300, l1TtlMs: 5_000 });
  } catch (error) {
    if (error instanceof Uncached) return error.value as T;
    throw error;
  }
}

// ── unread counts (consumed by `chatUnreadCache.ts`) ──────────────────────────────
// Kept here, not there, so the writers that bump them (`markChatRead`, `appendRaw`) do not
// import the module that imports the read they invalidate.

export const unreadTenantKey = (tenantId: number): string => `unread-version:tenant:${tenantId}`;
export const unreadUserKey = (tenantId: number, userId: string): string => `unread-version:user:${tenantId}:${userId}`;

/** Rare/emergency: orphan every user's unread map in the tenant. Hot-path appends
 *  must use {@link bumpUnreadForChatAudience} so a busy tenant's other chats stay warm. */
export function bumpUnreadForTenant(tenantId: number, env: Env | undefined = ambientEnv()): Promise<void> {
  return bumpVersion(unreadTenantKey(tenantId), 'bumpUnreadForTenant', env);
}

/** This user's read pointer moved — or a message landed in a chat they have read. */
export function bumpUnreadForUser(tenantId: number, userId: string, env: Env | undefined = ambientEnv()): Promise<void> {
  return bumpVersion(unreadUserKey(tenantId, userId), 'bumpUnreadForUser', env);
}

/**
 * A message landed in `chatId`. Unread only accrues for users who already have a
 * `chat_read_state` row (see `unreadCountsForUser`), so bump those users — not the
 * whole tenant. Idle polls of unrelated chats stay cached.
 */
export async function bumpUnreadForChatAudience(
  db: Db,
  tenantId: number,
  chatId: number,
  env: Env | undefined = ambientEnv(),
): Promise<void> {
  const audience = await db
    .select({ userId: chatReadState.userId })
    .from(chatReadState)
    .where(scopedToTenant(chatReadState, tenantId, eq(chatReadState.chatId, chatId)));
  await Promise.all(audience.map((row) => bumpUnreadForUser(tenantId, row.userId, env)));
}
