import type { Env } from '../../env';
import { getOrSetCached, peekCached, setCached } from '../../infrastructure/cache/readThroughCache';

/**
 * A read-through that lets a caller ask for a REFRESH (`?fresh=1`) without letting a
 * burst of them become a stampede on Neon.
 *
 * Surfaces send `fresh` when they know state just changed (a realtime push, a platform
 * write, regaining focus) — and a busy tenant has many windows doing that at once. Each
 * cached value carries the time it was loaded; a `fresh` read that finds one younger than
 * `minIntervalMs` is served from it, so at most one reload per interval per key reaches the
 * database PER ISOLATE: the stamp rides the cached value, but that value reaches other isolates
 * only after KV propagation (about 60 s), so the throttle is not global.
 */
interface Stamped<T> { value: T; loadedAt: number }

export const FRESH_MIN_INTERVAL_MS = 5_000;

export async function readThroughFresh<T>(
  env: Env,
  key: string,
  load: () => Promise<T>,
  opts: { kvTtlSeconds?: number; l1TtlMs?: number },
  fresh: boolean | undefined,
  minIntervalMs: number = FRESH_MIN_INTERVAL_MS,
): Promise<T> {
  if (!fresh) {
    return (await getOrSetCached<Stamped<T>>(env, key, async () => ({ value: await load(), loadedAt: Date.now() }), opts)).value;
  }
  const current = await peekCached<Stamped<T>>(env, key);
  if (current && Date.now() - current.loadedAt < minIntervalMs) return current.value;
  const next: Stamped<T> = { value: await load(), loadedAt: Date.now() };
  await setCached(env, key, next, opts);
  return next.value;
}
