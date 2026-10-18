/**
 * Short-lived-L1 version tokens for the caches whose writers live deep in modules that
 * hold a `Db` and no `Env` (chat transcripts, unread maps, board ticket state).
 *
 * `getCacheVersion` mints the same `ver:` token (default 30 s L1): a bump only
 * clears the isolate that made it, so a poller on another isolate would keep serving a
 * stale entry for up to that long. These reads pass `{ l1TtlMs: 2_000 }` instead (the KV
 * read behind it is cheap; the Neon statement it saves is not). The real cross-isolate
 * staleness bound is KV propagation of the delete (about 60 s across PoPs), not the 2 s L1.
 *
 * Writers bump through {@link bumpVersion}, which defaults `env` to the ambient request
 * scope (`application/shared/requestScope.ts`) so no signature between the entry point and
 * the write has to carry it. A writer running outside any scope (a test, a bare script) is
 * a no-op — the readers' KV TTL is the backstop.
 */

import type { Env } from '../../env';
import { currentRequestScope, deferPastResponse } from '../../application/shared/requestScope';
import { bumpCacheVersionSafe, getCacheVersion } from './readThroughCache';

const VERSION_L1_MS = 2_000;

export function versionToken(env: Env, key: string): Promise<string> {
  return getCacheVersion(env, key, { l1TtlMs: VERSION_L1_MS });
}

export const ambientEnv = (): Env | undefined => currentRequestScope()?.env as Env | undefined;

/** KV allows one write per second per key; a repeat bump inside this window adds nothing. */
const BUMP_DEDUPE_MS = 1_000;

/**
 * Bump a token best-effort (never throws); `env` defaults to the ambient request scope.
 * A key already bumped in this scope within the last second is skipped (a burst of
 * writes would otherwise 429 on KV's per-key write limit; the first bump already
 * orphaned everything a reader could have cached before it). The KV delete runs past the
 * response when the scope has a `waitUntil`, otherwise it is awaited.
 */
export async function bumpVersion(key: string, operation: string, env: Env | undefined = ambientEnv()): Promise<void> {
  if (!env) return;
  const scope = currentRequestScope();
  if (scope) {
    const seen = (scope.bumpedAt ??= new Map<string, number>());
    const now = Date.now();
    const last = seen.get(key);
    if (last !== undefined && now - last < BUMP_DEDUPE_MS) return;
    seen.set(key, now);
  }
  const task = bumpCacheVersionSafe(env, key, operation);
  if (!deferPastResponse(task)) await task;
}
