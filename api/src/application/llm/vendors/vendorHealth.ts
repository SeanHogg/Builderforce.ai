/**
 * Vendor UPSTREAM-HEALTH tracking — an ORDERING signal for the BYO seed.
 *
 * ⚠️ This is NOT the cooldown store, and the two must not be conflated.
 *
 *   `cooldownStore`  answers "may this vendor be CALLED right now?" — a hard,
 *                    short-lived gate driven mostly by COST/quota conditions
 *                    (`capacity`, `auth`), whose job is to stop us spending on a
 *                    key that is capped or broken. It removes candidates.
 *
 *   `vendorHealth`   answers "should this vendor go FIRST?" — a soft, purely
 *                    positional signal driven by upstream 5xx latency behaviour.
 *                    It removes nothing; it only reorders.
 *
 * Why a second signal is needed at all: `meta` (`https://api.meta.ai/v1`) leads
 * the BYO seed whenever a tenant sets Meta first, and a 502 there is an UPSTREAM
 * fault — genuinely transient, correctly retryable, and correctly NOT a capacity
 * cool. But because it leads, every cascade pays a full vendor timeout (up to 25s,
 * 60s premium) on it before advancing. The cooldown store can't fix this without
 * lying about the failure class: a 5-minute `transient` cool is a hard skip, and
 * the half-open trial re-promotes the vendor to the HEAD of the seed as soon as it
 * opens — straight back into a leading timeout. What's actually wanted is "keep
 * trying Meta, just not first, while it's flaky", which is an ordering change, not
 * a gating one.
 *
 * Mechanism: count CONSECUTIVE 5xx-class failures per vendor. At
 * {@link DEMOTE_STREAK_THRESHOLD} the vendor is demoted behind its healthy peers
 * in the seed order (never dropped — a demoted vendor still runs, and still runs
 * FIRST when it is the tenant's only connected account). Any success resets the
 * streak to zero, so a vendor recovers its position on its next good call rather
 * than waiting out a timer.
 *
 * Storage rides the shared `AUTH_CACHE_KV` binding under a `vhealth:` prefix
 * (no second namespace), with a per-isolate fallback so tests and local dev work
 * unchanged. Reads go through the canonical read-through cache.
 */

import { getOrSetCached, invalidateCached } from '../../../infrastructure/cache/readThroughCache';
import type { Env } from '../../../env';

/** Narrow env slice — mirrors `CooldownEnv`, so `ProxyEnv` is callable directly. */
export interface VendorHealthEnv {
  AUTH_CACHE_KV?: KVNamespace;
}

/**
 * Consecutive 5xx failures before a vendor loses its lead position.
 *
 * Three, not one: a single 502 is noise (upstreams blip), and demoting on it would
 * make seed order flap request-to-request for a fundamentally healthy account —
 * which is worse than the timeout it saves, because it also churns prompt caches.
 * Three in a row is the same threshold `cooldownStore` uses to trip a vendor-level
 * transient cooldown, deliberately: "the vendor, not one model, is unwell".
 */
export const DEMOTE_STREAK_THRESHOLD = 3;

/**
 * How long a demotion survives with no further traffic. A vendor that stops being
 * called (because it was demoted) has no successes to clear its streak, so the
 * record must age out on its own or the demotion would be permanent. 30 minutes is
 * comfortably longer than a typical upstream incident and short enough that a
 * recovered vendor reclaims its lead position within one maintenance window.
 */
const HEALTH_TTL_SECONDS = 30 * 60;

/** Read-through window on the seed-time lookup. The seed is computed on EVERY
 *  completion, so this must be cached; 30s is short enough that a newly-demoted
 *  vendor stops leading almost immediately. */
const HEALTH_READ_TTL_SECONDS = 30;

/** A 5xx-class upstream failure — the only class that feeds this signal.
 *  Deliberately excludes 429 (rate limit — a cost/quota condition the cooldown
 *  store owns) and 408 (our own timeout, which may be a slow prompt rather than an
 *  unwell vendor). 5xx is unambiguously "the upstream is broken right now". */
export function isUpstreamFaultStatus(status: number): boolean {
  return status >= 500 && status < 600;
}

interface HealthRecord {
  /** Consecutive 5xx failures with no intervening success. */
  streak: number;
  /** Epoch-ms of the most recent 5xx. */
  at: number;
}

function healthKey(vendorId: string): string {
  return `vhealth:${vendorId}`;
}

/** Per-isolate fallback when `AUTH_CACHE_KV` is unbound (tests, local dev). */
const memoryHealth = new Map<string, { record: HealthRecord; until: number }>();

/** Test seam — drop in-memory health between cases. */
export function _resetMemoryVendorHealth(): void {
  memoryHealth.clear();
}

async function readRecord(env: VendorHealthEnv, vendorId: string): Promise<HealthRecord | null> {
  const key = healthKey(vendorId);
  if (env.AUTH_CACHE_KV) {
    try {
      const raw = await env.AUTH_CACHE_KV.get(key);
      return raw ? (JSON.parse(raw) as HealthRecord) : null;
    } catch { /* fall through to the in-memory copy */ }
  }
  const local = memoryHealth.get(key);
  if (!local) return null;
  if (Date.now() >= local.until) { memoryHealth.delete(key); return null; }
  return local.record;
}

async function writeRecord(env: VendorHealthEnv, vendorId: string, record: HealthRecord): Promise<void> {
  const key = healthKey(vendorId);
  memoryHealth.set(key, { record, until: record.at + HEALTH_TTL_SECONDS * 1000 });
  await invalidateCached(env as unknown as Env, key).catch(() => { /* advisory */ });
  if (!env.AUTH_CACHE_KV) return;
  try {
    await env.AUTH_CACHE_KV.put(key, JSON.stringify(record), { expirationTtl: HEALTH_TTL_SECONDS });
  } catch { /* advisory — health is a hint, never a correctness requirement */ }
}

/**
 * Extend a vendor's 5xx streak by one. Non-5xx statuses are ignored, so callers can
 * hand this every failed attempt without pre-filtering.
 */
export async function recordVendorUpstreamFault(
  env: VendorHealthEnv,
  vendorId: string,
  status: number,
): Promise<void> {
  if (!isUpstreamFaultStatus(status)) return;
  const prior = await readRecord(env, vendorId);
  await writeRecord(env, vendorId, { streak: (prior?.streak ?? 0) + 1, at: Date.now() });
}

/**
 * Clear a vendor's streak after a successful call. Cheap-exits when there is
 * nothing recorded, which is the overwhelmingly common case — a healthy vendor
 * pays one cached read, not a write.
 */
export async function recordVendorUpstreamSuccess(
  env: VendorHealthEnv,
  vendorId: string,
): Promise<void> {
  const prior = await readRecord(env, vendorId);
  if (!prior || prior.streak === 0) return;
  const key = healthKey(vendorId);
  memoryHealth.delete(key);
  await invalidateCached(env as unknown as Env, key).catch(() => { /* advisory */ });
  if (!env.AUTH_CACHE_KV) return;
  try { await env.AUTH_CACHE_KV.delete(key); } catch { /* advisory */ }
}

/**
 * The subset of `vendors` currently on a 5xx streak long enough to lose its lead
 * position. Read-only and cached — safe to call on every completion.
 *
 * Returns an empty set (and issues no reads) when nothing is connected, so the
 * non-BYO path is untouched.
 */
export async function loadDemotedVendors(
  env: VendorHealthEnv,
  vendors: Iterable<string>,
): Promise<Set<string>> {
  const list = [...vendors];
  if (list.length === 0) return new Set();
  const results = await Promise.all(list.map(async (vendorId) => {
    const record = await getOrSetCached<HealthRecord | null>(
      env as unknown as Env,
      healthKey(vendorId),
      () => readRecord(env, vendorId),
      { kvTtlSeconds: HEALTH_READ_TTL_SECONDS },
    ).catch(() => null);
    return record && record.streak >= DEMOTE_STREAK_THRESHOLD ? vendorId : null;
  }));
  return new Set(results.filter((v): v is string => v !== null));
}
