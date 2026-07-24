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

type L1Entry = { value: unknown; expiresAt: number };

/** Per-isolate L1 layer. Short TTL — KV is the cross-isolate source of truth. */
const l1 = new Map<string, L1Entry>();
const L1_TTL_MS = 30_000;
const DEFAULT_KV_TTL_SECONDS = 300;

function kvKey(key: string): string {
  return `cache:${key}`;
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
    try {
      const cached = (await kv.get(kvKey(key), 'json')) as T | null;
      if (cached != null) {
        l1.set(key, { value: cached, expiresAt: now + l1Ttl });
        return cached;
      }
    } catch {
      // KV read failures never fail the request — fall through to the loader.
    }
  }

  const fresh = await loader();
  l1.set(key, { value: fresh, expiresAt: now + l1Ttl });
  if (kv) {
    try {
      await kv.put(kvKey(key), JSON.stringify(fresh), {
        expirationTtl: opts?.kvTtlSeconds ?? DEFAULT_KV_TTL_SECONDS,
      });
    } catch {
      // Best-effort write — a miss next time is acceptable.
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
    try {
      const cached = (await kv.get(kvKey(key), 'json')) as T | null;
      if (cached != null) {
        l1.set(key, { value: cached, expiresAt: now + L1_TTL_MS });
        return cached;
      }
    } catch {
      // KV read failure → treat as a miss.
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
    try {
      await kv.put(kvKey(key), JSON.stringify(value), {
        expirationTtl: opts?.kvTtlSeconds ?? DEFAULT_KV_TTL_SECONDS,
      });
    } catch {
      // Best-effort — a miss next read just triggers a reconcile.
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
  await bumpCacheVersion(env, ticketSearchVersionKey(tenantId)).catch(() => {});
}

/** Invalidate both cache layers for `key`. Call from every mutation that
 *  changes the cached data so the next read re-loads. */
export async function invalidateCached(env: Env, key: string): Promise<void> {
  l1.delete(key);
  const kv = env?.AUTH_CACHE_KV;
  if (kv) {
    try {
      await kv.delete(kvKey(key));
    } catch {
      // Invalidation failure degrades to "wait for the KV TTL" — acceptable.
    }
  }
}
