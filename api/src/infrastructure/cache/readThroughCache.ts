import { reportCaughtError } from '../../application/observability/caughtErrorReporter';
/**
 * Canonical read-through cache: L1 in-isolate Map + L2 Workers KV.
 *
 * Use this for read-heavy / expensive paths (DB round-trips, fan-out, stable
 * recomputation) instead of an ad-hoc `Map + TTL` (which never propagates
 * cross-isolate). The L1 Map lives here — the one place a per-isolate cache is
 * acceptable — and is backed by the shared KV namespace so a value populated on
 * one isolate is visible to others.
 *
 * Pattern: cache on read, invalidate on write. For an unbounded keyspace (e.g.
 * search) fold a version token into the key so old entries age out naturally.
 *
 * The KV binding (`AUTH_CACHE_KV`) is optional — when unbound, every call falls
 * straight through to the loader, so caching is opt-in via wrangler.toml without
 * touching call sites.
 */

import type { Env } from '../../env';
import { isKvRateLimit, retryTransient } from '../shared/retryTransient';

type L1Entry = { value: unknown; expiresAt: number };

/** Per-isolate L1 layer. Short TTL — KV is the cross-isolate source of truth. */
const l1 = new Map<string, L1Entry>();
const L1_TTL_MS = 30_000;
const DEFAULT_KV_TTL_SECONDS = 300;

/**
 * Workers KV refuses any `expirationTtl` below 60 seconds with
 * `400 Invalid expiration_ttl of N. Expiration TTL must be at least 60.`
 *
 * Eleven call sites asked for 10–45s, so every one of their KV writes threw and
 * was swallowed by the best-effort catch — 3,514 failures in a day, and those
 * paths silently degraded to an L1-only, per-isolate cache: exactly the
 * behaviour the shared helper exists to prevent, with none of the noise a
 * broken cache normally makes.
 *
 * Sub-minute expiry is simply not expressible in KV, so the honest resolution is
 * to raise the L2 entry to the platform minimum. The caller's `l1TtlMs` is NOT
 * clamped, so in-isolate freshness stays exactly as requested; only the
 * cross-isolate copy lives longer. Callers needing tighter cross-isolate
 * freshness than 60s should fold a version token into the key (as the ticket
 * search and Project 360 readers already do) rather than lean on expiry.
 */
const KV_MIN_TTL_SECONDS = 60;
const KV_MAX_KEY_BYTES = 512;
const KV_KEY_PREFIX = 'cache:';
const textEncoder = new TextEncoder();

function kvTtl(requested: number | undefined): number {
  return Math.max(requested ?? DEFAULT_KV_TTL_SECONDS, KV_MIN_TTL_SECONDS);
}

/**
 * Preserve existing storage keys while they fit Cloudflare's 512-byte limit.
 * Oversized keys are content-addressed so every read/write/invalidation derives
 * the same bounded key without truncation collisions.
 */
async function kvKey(key: string): Promise<string> {
  const raw = `${KV_KEY_PREFIX}${key}`;
  const bytes = textEncoder.encode(raw);
  if (bytes.byteLength <= KV_MAX_KEY_BYTES) return raw;

  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `${KV_KEY_PREFIX}sha256:${hex}`;
}

/** KV is JSON storage, so a freshly loaded value must have the same observable shape
 * as a later KV hit. In particular, Dates become ISO strings on both paths. */
function toJsonShape<T>(value: T): T {
  const encoded = JSON.stringify(value);
  return encoded === undefined ? value : JSON.parse(encoded) as T;
}

/**
 * Return the cached value for `key`, or compute it via `loader`, cache it in
 * both layers, and return it. KV/L1 errors degrade to a direct loader call.
 */
export async function getOrSetCached<T>(
  env: Env,
  key: string,
  loader: () => Promise<T>,
  opts?: { kvTtlSeconds?: number; l1TtlMs?: number },
): Promise<T> {
  const now = Date.now();

  const hit = l1.get(key);
  if (hit && hit.expiresAt > now) return hit.value as T;
  if (hit) l1.delete(key);

  // env may be absent (unit tests, non-Worker callers); the helper's contract is
  // "no KV → fall through to the loader", so guard env itself, not just the binding.
  const kv = env?.AUTH_CACHE_KV;
  const l1Ttl = opts?.l1TtlMs ?? L1_TTL_MS;

  if (kv) {
    const storageKey = await kvKey(key);
    try {
      const cached = (await kv.get(storageKey, 'json')) as T | null;
      if (cached != null) {
        l1.set(key, { value: cached, expiresAt: now + l1Ttl });
        return cached;
      }
    } catch (error) {
      // KV read failures never fail the request — fall through to the loader.

      reportCaughtError(error, {
        source: 'infrastructure/cache/readThroughCache.ts',
        operation: 'getOrSetCached',
        context: { cacheOperation: 'get', storageKey, sourceKeyBytes: textEncoder.encode(key).byteLength },
      });
    }
  }

  const fresh = toJsonShape(await loader());
  l1.set(key, { value: fresh, expiresAt: now + l1Ttl });
  if (kv) {
    const storageKey = await kvKey(key);
    try {
      await kv.put(storageKey, JSON.stringify(fresh), {
        expirationTtl: kvTtl(opts?.kvTtlSeconds),
      });
    } catch (error) {
      // Best-effort write — a miss next time is acceptable.

      reportCaughtError(error, {
        source: 'infrastructure/cache/readThroughCache.ts',
        operation: 'getOrSetCached',
        context: { cacheOperation: 'put', storageKey, sourceKeyBytes: textEncoder.encode(key).byteLength },
      });
    }
  }
  return fresh;
}

/**
 * Peek at the cached value for `key` WITHOUT invoking a loader — L1 then L2, no
 * write-back of a freshly-loaded value. Returns null on a miss. Use when a caller
 * must distinguish "cached value present" from "absent" (e.g. an incremental
 * read-modify-write that reconciles from the source only on a cold miss, instead
 * of double-counting against a loader that already includes the new write).
 */
export async function peekCached<T>(env: Env, key: string): Promise<T | null> {
  const now = Date.now();
  const hit = l1.get(key);
  if (hit && hit.expiresAt > now) return hit.value as T;
  if (hit) l1.delete(key);

  const kv = env?.AUTH_CACHE_KV;
  if (kv) {
    const storageKey = await kvKey(key);
    try {
      const cached = (await kv.get(storageKey, 'json')) as T | null;
      if (cached != null) {
        l1.set(key, { value: cached, expiresAt: now + L1_TTL_MS });
        return cached;
      }
    } catch (error) {
      // KV read failure → treat as a miss.

      reportCaughtError(error, {
        source: 'infrastructure/cache/readThroughCache.ts',
        operation: 'peekCached',
        context: { cacheOperation: 'get', storageKey, sourceKeyBytes: textEncoder.encode(key).byteLength },
      });
    }
  }
  return null;
}

/**
 * Write `value` into both cache layers for `key`. The counterpart to
 * {@link peekCached} — lets a caller persist a derived value it computed itself
 * (e.g. an incrementally-updated routing blob) so the next read hits without a
 * recompute. Best-effort on the KV write.
 */
export async function setCached<T>(
  env: Env,
  key: string,
  value: T,
  opts?: { kvTtlSeconds?: number; l1TtlMs?: number },
): Promise<void> {
  l1.set(key, { value, expiresAt: Date.now() + (opts?.l1TtlMs ?? L1_TTL_MS) });
  const kv = env?.AUTH_CACHE_KV;
  if (kv) {
    const storageKey = await kvKey(key);
    try {
      await kv.put(storageKey, JSON.stringify(value), {
        expirationTtl: kvTtl(opts?.kvTtlSeconds),
      });
    } catch (error) {
      // Best-effort — a miss next read just triggers a reconcile.

      reportCaughtError(error, {
        source: 'infrastructure/cache/readThroughCache.ts',
        operation: 'setCached',
        context: { cacheOperation: 'put', storageKey, sourceKeyBytes: textEncoder.encode(key).byteLength },
      });
    }
  }
}

/**
 * Read (or lazily mint) an opaque version token for `versionKey`. Fold the token
 * into data-cache keys (`...:v:${token}`) when the keyspace is unbounded or one
 * write fans out to many dependent keys (e.g. every epic-tree in a project) —
 * bumping the token orphans them all at once instead of enumerating each key.
 */
export async function getCacheVersion(env: Env, versionKey: string): Promise<string> {
  return getOrSetCached(env, `ver:${versionKey}`, async () => crypto.randomUUID(), {
    kvTtlSeconds: 86_400,
  });
}

/** Bump a version token: the next getCacheVersion mints a fresh one, orphaning
 *  every data key that embedded the previous token (they age out via TTL). */
export async function bumpCacheVersion(env: Env, versionKey: string): Promise<void> {
  await invalidateCached(env, `ver:${versionKey}`);
}

/**
 * TEST-ONLY: clear the module-global L1 `Map` so cache-backed tests are
 * order-independent. The L1 layer persists for the life of the isolate, which in
 * a single Vitest worker means one populated key (e.g. `am:recall:1:0:5:q`) can
 * leak an `ok:true` hit into a later test that expected its loader to run. Call
 * this from a shared `beforeEach` (see `api/test/setup.ts`, wired via vitest
 * `setupFiles`) instead of hand-picking collision-free keys per test. No-op for
 * the L2 KV layer — that is per-test bound (usually absent) and never shared.
 */
export function __clearL1CacheForTests(): void {
  l1.clear();
}

/** Cache key for a segment-tracker list at a given scope; projectId omitted =
 *  portfolio (`all`). Lives here (not in the route factory) so every writer — the
 *  route CRUD AND non-route writers like the built-in MCP roadmap tools — invalidate
 *  the SAME keys, one format, no drift. */
export function trackerCacheKey(ns: string, tenantId: number, segmentId: string, projectId?: number): string {
  return `tracker:${ns}:t:${tenantId}:s:${segmentId}:p:${projectId ?? 'all'}`;
}

/** Cache keys for the diagnostics project-score + tenant-rollup reads (which carry the
 *  remediation-badge state). Shared here so EVERY writer that changes badge inputs — a
 *  diagnostic run (`ToolService.persist`) AND a task status/PR transition
 *  (`taskLifecycle.recordStatusTransition`) — invalidates the SAME keys, so the badge
 *  never lags a PR merge / lane move by the read-through TTL. */
export const projectScoreCacheKey = (tenantId: number, projectId: number): string =>
  `tools:projectscore:tenant:${tenantId}:project:${projectId}`;
export const tenantRollupCacheKey = (tenantId: number): string =>
  `tools:rollup:tenant:${tenantId}`;

/** Version key for the chat↔ticket link-picker typeahead (`/api/brain/tickets/search`).
 *  Tenant-scoped: every ticket-bearing write (task/epic/gap, objective/initiative/
 *  portfolio, roadmap, spec) bumps it so the next search re-loads. The search keyspace
 *  is unbounded (per free-text query), so callers fold this token into the data key
 *  rather than enumerating every query. Paired with a short KV TTL as a backstop for
 *  the write paths that don't yet bump (e.g. some MCP tool writes). */
export function ticketSearchVersionKey(tenantId: number): string {
  return `ticket-search-version:tenant:${tenantId}`;
}

/** Orphan every cached ticket-search page for a tenant. Call from ticket writes.
 *  Best-effort (never throws) so it can be fire-and-forget on a write path. */
export async function bumpTicketSearchVersion(env: Env, tenantId: number): Promise<void> {
  await bumpCacheVersion(env, ticketSearchVersionKey(tenantId)).catch((error) => {
    reportCaughtError(error, { source: "infrastructure/cache/readThroughCache.ts", operation: "bumpTicketSearchVersion" });
  });
}

/** Version key for tenant-scoped derivations of the run-outcome ledger
 *  (`run_model_outcomes`): the SFT/DPO training-dataset export and the
 *  fine-tune-vs-base variant-eval comparison. Both fold this token into their
 *  cache keys; the run scorer bumps it (via {@link bumpOutcomesVersion}) whenever
 *  a new labeled outcome lands, so a fresh run re-materializes the derived views.
 *  The keyspace (per filter/window/variant) is unbounded, so a version token is
 *  the right invalidation, not key enumeration. */
export function outcomesVersionKey(tenantId: number): string {
  return `outcomes-version:tenant:${tenantId}`;
}

/** Orphan every cached dataset/variant-eval view for a tenant. Call from the run
 *  scorer alongside the learned-routing fold. Best-effort (never throws). */
export async function bumpOutcomesVersion(env: Env, tenantId: number): Promise<void> {
  await bumpCacheVersion(env, outcomesVersionKey(tenantId)).catch((error) => {
    reportCaughtError(error, { source: "infrastructure/cache/readThroughCache.ts", operation: "bumpOutcomesVersion" });
  });
}

/** Invalidate both cache layers for `key`. Call from every mutation that
 *  changes the cached data so the next read re-loads. */
export async function invalidateCached(env: Env, key: string): Promise<void> {
  l1.delete(key);
  const kv = env?.AUTH_CACHE_KV;
  if (kv) {
    const storageKey = await kvKey(key);
    try {
      // KV allows one write per second per key, so a burst of writes bumping the
      // SAME version token 429s. "Wait for the TTL" is not an acceptable
      // degradation here: version tokens are stored for 24h (getCacheVersion),
      // so a dropped bump leaves every data key that embedded the old token
      // serving stale reads for a day. Retrying past the per-key window is what
      // makes invalidation actually hold.
      await retryTransient(() => kv.delete(storageKey), isKvRateLimit);
    } catch (error) {
      reportCaughtError(error, {
        source: 'infrastructure/cache/readThroughCache.ts',
        operation: 'invalidateCached',
        context: { cacheOperation: 'delete', storageKey, sourceKeyBytes: textEncoder.encode(key).byteLength },
      });
    }
  }
}
