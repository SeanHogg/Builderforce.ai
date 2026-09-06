import { reportCaughtError } from '../../application/observability/caughtErrorReporter';
/**
 * The API's read-through cache — a thin adapter over the ONE cache core in
 * `@builderforce/read-through-cache` (L1 in-isolate Map + L2 Workers KV).
 *
 * Use this for read-heavy / expensive paths (DB round-trips, fan-out, stable
 * recomputation) instead of an ad-hoc `Map + TTL` (which never propagates
 * cross-isolate). Pattern: cache on read, invalidate on write. For an unbounded
 * keyspace (e.g. search) fold a version token into the key so old entries age
 * out naturally.
 *
 * The KV binding (`AUTH_CACHE_KV`) is optional — when unbound, every call falls
 * straight through to the loader, so caching is opt-in via wrangler.toml without
 * touching call sites.
 *
 * What is API-specific, and therefore here rather than in the package:
 *   - the binding: every export takes the API `Env` and reads `AUTH_CACHE_KV`;
 *   - error reporting goes through `reportCaughtError`;
 *   - the KV delete retries past KV's one-write-per-second per-key 429
 *     (`retryTransient` + `isKvRateLimit`);
 *   - the shared cache-KEY helpers every writer and reader must agree on.
 *
 * The legacy worker holds its own instance of the same core over the SAME KV
 * namespace, which is what lets `invalidateCached` here drop a verdict the
 * worker cached (see `application/auth/sessionRevocation.ts`).
 */

import type { Env } from '../../env';
import { createReadThroughCache } from '@builderforce/read-through-cache';
import { isKvRateLimit, retryTransient } from '../shared/retryTransient';

const SOURCE = 'infrastructure/cache/readThroughCache.ts';

/** ONE instance = ONE L1 Map for the isolate. */
const cache = createReadThroughCache({
  onError: (error, { operation, ...context }) => {
    reportCaughtError(error, { source: SOURCE, operation: legacyOperationName(operation), context });
  },
  // KV allows one write per second per key, so a burst of writes bumping the
  // SAME version token 429s. "Wait for the TTL" is not an acceptable
  // degradation here: version tokens are stored for 24h (getCacheVersion),
  // so a dropped bump leaves every data key that embedded the old token
  // serving stale reads for a day. Retrying past the per-key window is what
  // makes invalidation actually hold.
  retryDelete: (op) => retryTransient(op, isKvRateLimit),
});

/** The reporter's `operation` keeps this module's public names, so dashboards
 *  and alerts keyed on `getOrSetCached` / `invalidateCached` do not go blind. */
function legacyOperationName(operation: string): string {
  switch (operation) {
    case 'getOrSet': return 'getOrSetCached';
    case 'peek': return 'peekCached';
    case 'set': return 'setCached';
    case 'invalidate': return 'invalidateCached';
    default: return operation;
  }
}

/**
 * Return the cached value for `key`, or compute it via `loader`, cache it in
 * both layers, and return it. KV/L1 errors degrade to a direct loader call.
 */
export async function getOrSetCached<T>(
  // Optional by CONTRACT, not by accident: the core already falls through to the
  // loader when there is no KV (unit tests, non-Worker callers). The signature
  // said `Env`, which forced every caller holding an optional env to either
  // assert or drop the cached read entirely.
  env: Env | undefined,
  key: string,
  loader: () => Promise<T>,
  opts?: { kvTtlSeconds?: number; l1TtlMs?: number },
): Promise<T> {
  return cache.getOrSet(env?.AUTH_CACHE_KV, key, loader, opts);
}

/**
 * Peek at the cached value for `key` WITHOUT invoking a loader — L1 then L2, no
 * write-back of a freshly-loaded value. Returns null on a miss. Use when a caller
 * must distinguish "cached value present" from "absent" (e.g. an incremental
 * read-modify-write that reconciles from the source only on a cold miss, instead
 * of double-counting against a loader that already includes the new write).
 */
export async function peekCached<T>(env: Env, key: string): Promise<T | null> {
  return cache.peek<T>(env?.AUTH_CACHE_KV, key);
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
  return cache.set(env?.AUTH_CACHE_KV, key, value, opts);
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
  cache.clearL1();
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
    reportCaughtError(error, { source: SOURCE, operation: 'bumpTicketSearchVersion' });
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
    reportCaughtError(error, { source: SOURCE, operation: 'bumpOutcomesVersion' });
  });
}

/**
 * Version key for the PUBLIC canvas API's board listings (`GET /api/v1/boards`).
 *
 * The listing is the read an integration polls, and its keyspace is unbounded
 * (page × limit × status × folder), so a token folded into the key is the right
 * invalidation rather than enumerating every page.
 *
 * It lives here, next to the ticket-search and outcomes tokens, for the reason
 * those do: the writers are not all in one file. A board's listed shape changes
 * from the public item CRUD, from the in-product canvas save, and from the command
 * batch — three writers, one format, no drift.
 *
 * The board's ITEM read is deliberately NOT versioned this way. It is keyed on the
 * board's own `canvas_revision`, which every write already bumps, so it is exact
 * rather than eventually-correct and no writer has to remember anything at all.
 */
export function publicCanvasVersionKey(tenantId: number): string {
  return `public-canvas-version:tenant:${tenantId}`;
}

/** Orphan every cached public board listing for a tenant. Call from every canvas
 *  write. Best-effort (never throws) so it can be fire-and-forget. */
export async function bumpPublicCanvasVersion(env: Env, tenantId: number): Promise<void> {
  await bumpCacheVersion(env, publicCanvasVersionKey(tenantId)).catch((error) => {
    reportCaughtError(error, { source: SOURCE, operation: 'bumpPublicCanvasVersion' });
  });
}

/** Invalidate both cache layers for `key`. Call from every mutation that
 *  changes the cached data so the next read re-loads. */
export async function invalidateCached(env: Env | undefined, key: string): Promise<void> {
  return cache.invalidate(env?.AUTH_CACHE_KV, key);
}
