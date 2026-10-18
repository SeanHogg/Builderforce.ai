/**
 * Short-lived-L1 version tokens for the caches whose writers live deep in modules that
 * hold a `Db` and no `Env` (chat transcripts, unread maps, board ticket state).
 *
 * `getCacheVersion` mints the same `ver:` token but with the default 30 s L1: a bump only
 * clears the isolate that made it, so a poller on another isolate would keep serving a
 * stale entry for up to that long. These reads use a 2 s L1 instead (the KV read behind it
 * is cheap; the Neon statement it saves is not).
 *
 * Writers bump through {@link bumpVersion}, which defaults `env` to the ambient request
 * scope (`application/shared/requestScope.ts`) so no signature between the entry point and
 * the write has to carry it. A writer running outside any scope (a test, a bare script) is
 * a no-op — the readers' KV TTL is the backstop.
 */

import type { Env } from '../../env';
import { currentRequestScope } from '../../application/shared/requestScope';
import { reportCaughtError } from '../../application/observability/caughtErrorReporter';
import { bumpCacheVersion, getOrSetCached } from './readThroughCache';

const VERSION_L1_MS = 2_000;

export function versionToken(env: Env, key: string): Promise<string> {
  return getOrSetCached(env, `ver:${key}`, async () => crypto.randomUUID(), { kvTtlSeconds: 86_400, l1TtlMs: VERSION_L1_MS });
}

export const ambientEnv = (): Env | undefined => currentRequestScope()?.env as Env | undefined;

/** Bump a token best-effort (never throws); `env` defaults to the ambient request scope. */
export async function bumpVersion(key: string, operation: string, env: Env | undefined = ambientEnv()): Promise<void> {
  if (!env) return;
  try {
    await bumpCacheVersion(env, key);
  } catch (error) {
    reportCaughtError(error, { source: 'infrastructure/cache/versionToken.ts', operation });
  }
}
