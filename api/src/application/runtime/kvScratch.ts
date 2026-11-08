/**
 * kvScratch — the ONE best-effort read/write of scheduling scratch in KV.
 *
 * Both the manager's stage-rotation cursor (`manager/passRotation.ts`) and the PR-conduct
 * sweeps' ticket/project rotation cursors (`repos/conductRotation.ts`) are tiny hints, not
 * policy: losing one costs exactly one un-rotated tick. They therefore share the same two
 * guarantees — a read never throws (a miss or failure reads as "no cursor"), and a write is
 * best-effort — instead of each re-deriving `peekCached(...).catch(...)` / `setCached(...)`.
 */
import { peekCached, setCached } from '../../infrastructure/cache/readThroughCache';
import type { Env } from '../../env';

/** Read a scratch value. Never throws; null on a miss or any failure. */
export async function peekScratch<T>(env: Env, key: string): Promise<T | null> {
  return peekCached<T>(env, key).catch(() => null);
}

/** Persist a scratch value for `ttlSeconds`. Best-effort: a lost write is harmless. */
export async function saveScratch<T>(env: Env, key: string, value: T, ttlSeconds: number): Promise<void> {
  await setCached(env, key, value, { kvTtlSeconds: ttlSeconds }).catch(() => undefined);
}
