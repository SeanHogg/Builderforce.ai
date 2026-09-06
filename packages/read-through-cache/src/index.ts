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
 * The KV binding is optional on every call — when unbound, every call falls
 * straight through to the loader, so caching is opt-in via wrangler.toml without
 * touching call sites.
 *
 * WHY A PACKAGE. The API's `infrastructure/cache/readThroughCache.ts` was the one
 * implementation, and it was welded to the API: it imported the API's error
 * reporter, its transient-retry helper and its `Env` type. The legacy worker then
 * needed the SAME cache over the SAME KV namespace — it caches the API's
 * session-introspection verdict, and the API's revoke path deletes that key —
 * and a second copy of an L1+L2 cache is exactly the drift this module exists to
 * prevent. So the core is here, dependency-free by contract: the KV namespace is
 * a per-call argument, error reporting and the delete retry are injected by
 * {@link createReadThroughCache}, and the key hashing carries its own SHA-256.
 * The API's module is now a thin adapter over ONE instance of this.
 */

/** The three KV calls this cache makes — structural, so both the real
 *  `KVNamespace` and a test double satisfy it without a workers-types import. */
export interface KvNamespaceLike {
  get(key: string, type: 'json'): Promise<unknown>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface CacheTtlOptions {
  kvTtlSeconds?: number;
  l1TtlMs?: number;
}

/** What went wrong and where — handed to the injected `onError` so the consumer
 *  can route it through its own reporter without the cache knowing about one. */
export interface CacheErrorContext {
  operation: string;
  cacheOperation: 'get' | 'put' | 'delete';
  storageKey: string;
  sourceKeyBytes: number;
}

export interface ReadThroughCacheOptions {
  /** Every swallowed KV failure is reported here. Default: silent. */
  onError?: (error: unknown, ctx: CacheErrorContext) => void;
  /**
   * Wraps the KV delete in {@link ReadThroughCache.invalidate}. KV allows one
   * write per second per key, so a burst of writes bumping the SAME version
   * token 429s; the consumer decides whether (and how) to retry past that.
   * Default: a single attempt.
   */
  retryDelete?: (op: () => Promise<void>) => Promise<void>;
}

export interface ReadThroughCache {
  /**
   * Return the cached value for `key`, or compute it via `loader`, cache it in
   * both layers, and return it. KV/L1 errors degrade to a direct loader call.
   */
  getOrSet<T>(kv: KvNamespaceLike | undefined, key: string, loader: () => Promise<T>, opts?: CacheTtlOptions): Promise<T>;
  /**
   * Peek at the cached value for `key` WITHOUT invoking a loader — L1 then L2, no
   * write-back of a freshly-loaded value. Returns null on a miss. Use when a caller
   * must distinguish "cached value present" from "absent" (e.g. an incremental
   * read-modify-write that reconciles from the source only on a cold miss, instead
   * of double-counting against a loader that already includes the new write).
   */
  peek<T>(kv: KvNamespaceLike | undefined, key: string): Promise<T | null>;
  /**
   * Write `value` into both cache layers for `key`. The counterpart to
   * {@link peek} — lets a caller persist a derived value it computed itself
   * (e.g. an incrementally-updated routing blob) so the next read hits without a
   * recompute. Best-effort on the KV write.
   */
  set<T>(kv: KvNamespaceLike | undefined, key: string, value: T, opts?: CacheTtlOptions): Promise<void>;
  /** Invalidate both cache layers for `key`. Call from every mutation that
   *  changes the cached data so the next read re-loads. */
  invalidate(kv: KvNamespaceLike | undefined, key: string): Promise<void>;
  /**
   * TEST-ONLY: clear the L1 `Map` so cache-backed tests are order-independent.
   * The L1 layer persists for the life of the isolate, which in a single Vitest
   * worker means one populated key can leak a hit into a later test that expected
   * its loader to run. Call this from a shared `beforeEach`. No-op for the L2 KV
   * layer — that is per-test bound (usually absent) and never shared.
   */
  clearL1(): void;
}

type L1Entry = { value: unknown; expiresAt: number };

/** Short L1 TTL — KV is the cross-isolate source of truth. */
export const L1_TTL_MS = 30_000;
export const DEFAULT_KV_TTL_SECONDS = 300;

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
export const KV_MIN_TTL_SECONDS = 60;
const KV_MAX_KEY_BYTES = 512;
const KV_KEY_PREFIX = 'cache:';
const textEncoder = new TextEncoder();

function kvTtl(requested: number | undefined): number {
  return Math.max(requested ?? DEFAULT_KV_TTL_SECONDS, KV_MIN_TTL_SECONDS);
}

/** SHA-256 as lowercase hex, over WebCrypto — on the global in Workers, Node 18+
 *  and vitest alike, so there is no platform branch to hide here. Exported so the
 *  API's `domain/shared/hash.ts` can delegate to it rather than keep a twin. */
export async function sha256HexBytes(bytes: ArrayBuffer | ArrayBufferView): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
  let out = '';
  for (let i = 0; i < digest.length; i++) out += digest[i]!.toString(16).padStart(2, '0');
  return out;
}

/**
 * Preserve existing storage keys while they fit Cloudflare's 512-byte limit.
 * Oversized keys are content-addressed so every read/write/invalidation derives
 * the same bounded key without truncation collisions.
 */
export async function kvStorageKey(key: string): Promise<string> {
  const raw = `${KV_KEY_PREFIX}${key}`;
  const bytes = textEncoder.encode(raw);
  if (bytes.byteLength <= KV_MAX_KEY_BYTES) return raw;

  return `${KV_KEY_PREFIX}sha256:${await sha256HexBytes(bytes)}`;
}

/** KV is JSON storage, so a freshly loaded value must have the same observable shape
 * as a later KV hit. In particular, Dates become ISO strings on both paths. */
export function toJsonShape<T>(value: T): T {
  const encoded = JSON.stringify(value);
  return encoded === undefined ? value : JSON.parse(encoded) as T;
}

/**
 * One cache = one L1 Map. Make ONE instance per consumer at module level and
 * route every call through it; two instances are two L1s that cannot see each
 * other's invalidations.
 */
export function createReadThroughCache(options: ReadThroughCacheOptions = {}): ReadThroughCache {
  const l1 = new Map<string, L1Entry>();
  const onError = options.onError ?? (() => undefined);
  const retryDelete = options.retryDelete ?? ((op) => op());

  const report = (error: unknown, operation: string, cacheOperation: CacheErrorContext['cacheOperation'], storageKey: string, key: string) =>
    onError(error, { operation, cacheOperation, storageKey, sourceKeyBytes: textEncoder.encode(key).byteLength });

  /** L1 read with expiry; evicts a stale entry on the way out. Returns the ENTRY,
   *  not the value, so a cached `undefined` is still a hit. */
  const l1Get = (key: string, now: number): L1Entry | undefined => {
    const hit = l1.get(key);
    if (hit && hit.expiresAt > now) return hit;
    if (hit) l1.delete(key);
    return undefined;
  };

  /** L2 read; a KV failure is reported and reads as a miss. */
  const kvGet = async <T>(kv: KvNamespaceLike, key: string, operation: string): Promise<T | null> => {
    const storageKey = await kvStorageKey(key);
    try {
      return (await kv.get(storageKey, 'json')) as T | null;
    } catch (error) {
      // KV read failures never fail the request — the caller falls through.
      report(error, operation, 'get', storageKey, key);
      return null;
    }
  };

  /** Best-effort L2 write — a miss next time is acceptable. */
  const kvPut = async (kv: KvNamespaceLike, key: string, value: unknown, ttlSeconds: number | undefined, operation: string): Promise<void> => {
    const storageKey = await kvStorageKey(key);
    try {
      await kv.put(storageKey, JSON.stringify(value), { expirationTtl: kvTtl(ttlSeconds) });
    } catch (error) {
      report(error, operation, 'put', storageKey, key);
    }
  };

  return {
    async getOrSet<T>(kv: KvNamespaceLike | undefined, key: string, loader: () => Promise<T>, opts?: CacheTtlOptions): Promise<T> {
      const now = Date.now();
      const l1Hit = l1Get(key, now);
      if (l1Hit) return l1Hit.value as T;

      const l1Ttl = opts?.l1TtlMs ?? L1_TTL_MS;
      if (kv) {
        const cached = await kvGet<T>(kv, key, 'getOrSet');
        if (cached != null) {
          l1.set(key, { value: cached, expiresAt: now + l1Ttl });
          return cached;
        }
      }

      const fresh = toJsonShape(await loader());
      l1.set(key, { value: fresh, expiresAt: now + l1Ttl });
      if (kv) await kvPut(kv, key, fresh, opts?.kvTtlSeconds, 'getOrSet');
      return fresh;
    },

    async peek<T>(kv: KvNamespaceLike | undefined, key: string): Promise<T | null> {
      const now = Date.now();
      const l1Hit = l1Get(key, now);
      if (l1Hit) return l1Hit.value as T;

      if (kv) {
        const cached = await kvGet<T>(kv, key, 'peek');
        if (cached != null) {
          l1.set(key, { value: cached, expiresAt: now + L1_TTL_MS });
          return cached;
        }
      }
      return null;
    },

    async set<T>(kv: KvNamespaceLike | undefined, key: string, value: T, opts?: CacheTtlOptions): Promise<void> {
      l1.set(key, { value, expiresAt: Date.now() + (opts?.l1TtlMs ?? L1_TTL_MS) });
      if (kv) await kvPut(kv, key, value, opts?.kvTtlSeconds, 'set');
    },

    async invalidate(kv: KvNamespaceLike | undefined, key: string): Promise<void> {
      l1.delete(key);
      if (!kv) return;
      const storageKey = await kvStorageKey(key);
      try {
        await retryDelete(() => kv.delete(storageKey));
      } catch (error) {
        report(error, 'invalidate', 'delete', storageKey, key);
      }
    },

    clearL1(): void {
      l1.clear();
    },
  };
}
