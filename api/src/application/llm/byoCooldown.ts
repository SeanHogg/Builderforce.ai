/**
 * TENANT-SCOPED BYO cooldown — the missing half of the cooldown keyspace.
 *
 * The shared operator store (`infrastructure/auth/cooldownStore.ts`, key
 * `cooldowns:${vendor}`) is GLOBAL and deliberately exempts owner-served models:
 * one tenant's exhausted key must never bench the operator pool for everybody
 * (`LlmProxyService.byoCooldownScope.test.ts`). But that exemption left a BYO
 * 429 recorded NOWHERE that outlives the request, so every turn rebuilt the same
 * chain with the throttled model first (chat #168571: 13 consecutive turns each
 * burned a 429 on direct/moonshot/kimi-k3 before failing over).
 *
 * This store closes that gap WITHOUT touching the shared keyspace:
 *   key   `byo-cooldown:${tenantId}:${vendor}/${model}` — one tenant's account.
 *   TTL   the provider's own `Retry-After` / `x-ratelimit-reset*` when present;
 *         otherwise 60s, doubling per consecutive strike, capped at 15 min.
 *   reset an explicit success clears the record (strikes AND bench).
 *
 * Reads are DEMOTION signals, not gates: a cooled BYO candidate stays in the
 * chain as a last resort (`demoteTenantCooled`), and an explicit user pin is
 * never demoted. ONE reader — {@link isTenantCooled} — serves both the seed
 * composition and the mid-cascade re-check, so the two cannot drift.
 *
 * Storage rides the shared read-through cache (L1 isolate Map + `AUTH_CACHE_KV`),
 * the same pattern as `vendors/vendorHealth.ts` and `providerHeadroom.ts`.
 */

import { reportCaughtError } from '../observability/caughtErrorReporter';
import { getOrSetCached, invalidateCached, setCached } from '../../infrastructure/cache/readThroughCache';
import type { CacheEnv } from '../../infrastructure/cache/readThroughCache';

/** Narrow env slice — mirrors `CooldownEnv` / `VendorHealthEnv`. */
export interface ByoCooldownEnv {
  AUTH_CACHE_KV?: KVNamespace;
  CACHE_L2_KV?: string;
}

/** A stored bench. `until` is epoch-ms; `strikes` drives the doubling ladder. */
export interface ByoCooldownRecord {
  until: number;
  strikes: number;
  /** Why the model was benched — surfaced in the `cooled` routing metadata. */
  reason: string;
}

/** One entry of the response routing metadata (`cooled: [{model, until, reason}]`). */
export interface CooledModelInfo {
  model: string;
  until: number;
  reason: string;
}

const BASE_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = 15 * 60;
/** L1 window on the seed-time lookup — short enough that a fresh bench demotes
 *  almost immediately, long enough that one cascade doesn't re-read per candidate. */
const READ_TTL_SECONDS = 5;

const byoCooldownKey = (tenantId: number, vendor: string, model: string): string =>
  `byo-cooldown:${tenantId}:${vendor}/${model}`;

/**
 * Bench time after `strikes` consecutive 429s with no provider hint:
 * 60s → 120s → 240s → 480s → 900s (cap). PURE.
 */
export function byoCooldownTtlSeconds(strikes: number): number {
  const n = Math.max(1, Math.floor(strikes) || 1);
  return Math.min(BASE_TTL_SECONDS * 2 ** (n - 1), MAX_TTL_SECONDS);
}

const finiteNum = (v: string | null): number | null => {
  if (v == null || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * THE one `Retry-After` parser for the gateway (it was parsed nowhere in
 * application/llm before). Returns SECONDS to wait, or null when the provider
 * said nothing usable:
 *   - `Retry-After`: delta-seconds or an HTTP-date (RFC 9110);
 *   - `x-ratelimit-reset-requests` / `-tokens`: OpenAI-style durations (`1s`,
 *     `6m0s`, `200ms`) or bare seconds;
 *   - `x-ratelimit-reset`: epoch seconds (or ms).
 * The tightest (smallest positive) hint wins; past instants clamp to 0.
 */
export function parseRetryAfter(headers: Headers, now: number = Date.now()): number | null {
  const candidates: number[] = [];
  const ra = headers.get('retry-after');
  if (ra != null && ra.trim() !== '') {
    const secs = finiteNum(ra);
    if (secs != null) candidates.push(secs);
    else {
      const t = Date.parse(ra);
      if (Number.isFinite(t)) candidates.push((t - now) / 1000);
    }
  }
  for (const kind of ['requests', 'tokens']) {
    const v = headers.get(`x-ratelimit-reset-${kind}`);
    if (v == null) continue;
    const bare = finiteNum(v);
    if (bare != null) { candidates.push(bare); continue; }
    // OpenAI duration format: a sum of <number><unit> parts, e.g. "6m0s", "1s200ms".
    let total = 0;
    let matched = false;
    for (const m of v.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g)) {
      matched = true;
      const n = Number(m[1]);
      total += m[2] === 'ms' ? n / 1000 : m[2] === 's' ? n : m[2] === 'm' ? n * 60 : n * 3600;
    }
    if (matched) candidates.push(total);
  }
  const reset = finiteNum(headers.get('x-ratelimit-reset'));
  if (reset != null) {
    const resetMs = reset > 1e12 ? reset : reset * 1000; // epoch seconds or ms
    candidates.push((resetMs - now) / 1000);
  }
  const positive = candidates.filter((s) => Number.isFinite(s)).map((s) => Math.max(0, s));
  if (positive.length === 0) return null;
  return Math.min(...positive);
}

/** Per-isolate fallback when `AUTH_CACHE_KV` is unbound (tests, local dev) —
 *  the same shape `vendorHealth.ts` keeps, but read/written THROUGH the shared
 *  cache helpers so L1 invalidation and KV expiry stay in one place. */
const memoryRecords = new Map<string, ByoCooldownRecord>();

/** Test seam — drop in-memory benches between cases. */
export function _resetMemoryByoCooldowns(): void {
  memoryRecords.clear();
}

async function readRecord(env: ByoCooldownEnv, key: string): Promise<ByoCooldownRecord | null> {
  if (env.AUTH_CACHE_KV) {
    try {
      const raw = await env.AUTH_CACHE_KV.get(key);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<ByoCooldownRecord>;
        if (typeof parsed.until === 'number') {
          return { until: parsed.until, strikes: parsed.strikes ?? 1, reason: parsed.reason ?? 'rate_limit' };
        }
        return null;
      }
    } catch (error) { /* fall through to the in-memory copy */
      reportCaughtError(error, { source: 'application/llm/byoCooldown.ts', operation: 'readRecord' });
    }
  }
  const local = memoryRecords.get(key);
  if (!local) return null;
  if (Date.now() >= local.until) { memoryRecords.delete(key); return null; }
  return local;
}

/** The live record for one tenant+vendor+model, or null. Cached read (L1+KV). */
export async function loadByoCooldown(
  env: ByoCooldownEnv,
  tenantId: number,
  vendor: string,
  model: string,
): Promise<ByoCooldownRecord | null> {
  const key = byoCooldownKey(tenantId, vendor, model);
  const rec = await getOrSetCached<ByoCooldownRecord | null>(
    env as CacheEnv,
    key,
    () => readRecord(env, key),
    { kvTtlSeconds: READ_TTL_SECONDS, l1TtlMs: READ_TTL_SECONDS * 1000 },
  ).catch((error) => {
    reportCaughtError(error, { source: 'application/llm/byoCooldown.ts', operation: 'loadByoCooldown' });
    return null;
  });
  return rec && Date.now() < rec.until ? rec : null;
}

/**
 * THE one "is this BYO candidate cooled for THIS tenant?" reader. Used by the
 * seed demotion AND the mid-cascade re-check — never copy this predicate.
 */
export async function isTenantCooled(
  env: ByoCooldownEnv,
  tenantId: number | null,
  vendor: string,
  model: string,
): Promise<boolean> {
  if (tenantId == null) return false;
  return (await loadByoCooldown(env, tenantId, vendor, model)) != null;
}

/**
 * Record an owner-served 429 / rate-limit failure for THIS tenant only.
 * `retryAfterSeconds` comes from {@link parseRetryAfter} (null when the provider
 * said nothing) — a provider hint replaces the doubling ladder for this strike,
 * but the strike count still escalates so a chronically throttled account that
 * stops sending hints still backs off. Never throws: a bench is advisory.
 */
export async function recordByoCooldown(
  env: ByoCooldownEnv,
  tenantId: number | null,
  vendor: string,
  model: string,
  retryAfterSeconds: number | null,
  reason = '429 rate_limit',
): Promise<void> {
  if (tenantId == null) return;
  const key = byoCooldownKey(tenantId, vendor, model);
  try {
    const prior = await readRecord(env, key);
    const strikes = (prior?.strikes ?? 0) + 1;
    const ttl = retryAfterSeconds != null && retryAfterSeconds > 0
      ? Math.min(Math.ceil(retryAfterSeconds), MAX_TTL_SECONDS)
      : byoCooldownTtlSeconds(strikes);
    const record: ByoCooldownRecord = { until: Date.now() + ttl * 1000, strikes, reason };
    memoryRecords.set(key, record);
    // WRITE first, then invalidate — a reader that misses in between reloads the
    // stored record, never a stale "not cooled" (the providerHeadroom pattern).
    if (env.AUTH_CACHE_KV) {
      await env.AUTH_CACHE_KV.put(key, JSON.stringify(record), { expirationTtl: Math.max(60, ttl) });
    }
    await invalidateCached(env as CacheEnv, key);
    console.warn(`[byo-cooldown] tenant ${tenantId} ${vendor}/${model} cooled for ${ttl}s (strike ${strikes}) — ${reason}`);
  } catch (error) { /* advisory — routing still works without the record */
    reportCaughtError(error, { source: 'application/llm/byoCooldown.ts', operation: 'recordByoCooldown' });
  }
}

/**
 * Reset strikes + bench after a SUCCESS on this tenant+model. Cheap-exits when
 * nothing is recorded — the overwhelmingly common case pays one cached read and
 * writes nothing (the `recordVendorUpstreamSuccess` pattern).
 */
export async function resetByoCooldown(
  env: ByoCooldownEnv,
  tenantId: number | null,
  vendor: string,
  model: string,
): Promise<void> {
  if (tenantId == null) return;
  const key = byoCooldownKey(tenantId, vendor, model);
  try {
    const prior = await loadByoCooldown(env, tenantId, vendor, model);
    if (!prior) return;
    memoryRecords.delete(key);
    if (env.AUTH_CACHE_KV) await env.AUTH_CACHE_KV.delete(key);
    await invalidateCached(env as CacheEnv, key);
    // Seed a fresh "not cooled" so the short read-through window can't resurrect
    // the record we just deleted from a stale L2 copy.
    await setCached<ByoCooldownRecord | null>(env as CacheEnv, key, null, {
      kvTtlSeconds: READ_TTL_SECONDS, l1TtlMs: READ_TTL_SECONDS * 1000,
    });
  } catch (error) { /* advisory */
    reportCaughtError(error, { source: 'application/llm/byoCooldown.ts', operation: 'resetByoCooldown' });
  }
}

/**
 * Demote tenant-cooled candidates behind the healthy ones — a STABLE partition,
 * never a drop: a cooled model stays a last resort (the account may recover
 * mid-cascade, and a cooled-only tenant must still get an attempt).
 *
 * `pinned` (an explicit user model pin) is never moved; its cooldown is reported
 * in `cooled` metadata instead. Returns the reordered list plus the metadata
 * entries for every cooled candidate seen, in input order.
 */
export async function demoteTenantCooled(
  env: ByoCooldownEnv,
  tenantId: number | null,
  models: readonly string[],
  vendorOf: (model: string) => string,
  pinned?: string,
): Promise<{ ordered: string[]; cooled: CooledModelInfo[] }> {
  if (tenantId == null || models.length === 0) return { ordered: [...models], cooled: [] };
  const records = await Promise.all(models.map((m) => loadByoCooldown(env, tenantId, vendorOf(m), m)));
  const cooled: CooledModelInfo[] = [];
  const healthy: string[] = [];
  const benched: string[] = [];
  models.forEach((m, i) => {
    const rec = records[i];
    if (!rec) { healthy.push(m); return; }
    cooled.push({ model: m, until: rec.until, reason: rec.reason });
    if (m === pinned) healthy.push(m); // explicit pin: noted, never demoted
    else benched.push(m);
  });
  return { ordered: [...healthy, ...benched], cooled };
}