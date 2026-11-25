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
  /**
   * OPT-IN last-known-good fallback for `getOrSet`. The KV entry is then written ONCE
   * as a {@link StaleEnvelope} that lives `ttlSeconds` but is only FRESH for
   * `kvTtlSeconds`. Once past fresh, a read calls the loader; if the loader throws and
   * `when(error)` holds, the old value is served instead of the error. Without this
   * option the KV format and TTLs are exactly as before.
   */
  staleOnError?: { ttlSeconds: number; when: (error: unknown) => boolean };
}

/** The KV shape of an entry written with `staleOnError`. The marker makes it
 *  unmistakable next to a raw cached value. */
export interface StaleEnvelope<T = unknown> {
  __rtcStale: 1;
  value: T;
  /** Epoch ms until which the value is a plain hit. */
  freshUntil: number;
}

function isStaleEnvelope(v: unknown): v is StaleEnvelope {
  return typeof v === 'object' && v !== null
    && (v as { __rtcStale?: unknown }).__rtcStale === 1
    && typeof (v as { freshUntil?: unknown }).freshUntil === 'number'
    && 'value' in v;
}

/** What went wrong and where — handed to the injected `onError` so the consumer
 *  can route it through its own reporter without the cache knowing about one. */
export interface CacheErrorContext {
  operation: string;
  cacheOperation: 'get' | 'put' | 'delete';
  storageKey: string;
  sourceKeyBytes: number;
}

export interface InvalidateOptions {
  /** Rethrow a failed KV delete (after `retryDelete`) instead of only reporting it. For writers
   *  whose correctness depends on the entry being gone — a revoked key must not be served
   *  from a copy that outlives the revoke by days. */
  strict?: boolean;
  /** Also delete the last-known-good (`cache:lkg:`) spelling. Set it for keys whose reads opt into
   *  `staleOnError`; without it only the plain spelling is deleted (one KV delete, as before). */
  lkg?: boolean;
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
  /**
   * Hand the KV write-back of a {@link ReadThroughCache.getOrSet} miss to the
   * runtime so it can finish AFTER the response (a Worker's `ctx.waitUntil`).
   * Return true when the task was taken; false (or no hook) and the miss awaits the
   * write itself, because an unattached promise in a Worker can be cancelled the
   * moment the response goes out. Without it every miss pays a KV write's latency on
   * top of its loader.
   */
  defer?: (task: Promise<unknown>) => boolean;
}

export interface ReadThroughCache {
  /**
   * Return the cached value for `key`, or compute it via `loader`, cache it in
   * both layers, and return it. KV/L1 errors degrade to a direct loader call.
   *
   * Single-flight per isolate: concurrent misses on one key share ONE KV read and
   * ONE loader call, instead of every waiting request querying the source at once.
   */
  getOrSet<T>(kv: KvNamespaceLike | undefined, key: string, loader: () => Promise<T>, opts?: CacheTtlOptions): Promise<T>;
  /**
   * Peek at the cached value for `key` WITHOUT invoking a loader — L1 then L2, no
   * write-back of a freshly-loaded value. Returns null on a miss. Use when a caller
   * must distinguish "cached value present" from "absent" (e.g. an incremental
   * read-modify-write that reconciles from the source only on a cold miss, instead
   * of double-counting against a loader that already includes the new write).
   */
  peek<T>(kv: KvNamespaceLike | undefined, key: string, opts?: Pick<CacheTtlOptions, 'staleOnError'>): Promise<T | null>;
  /**
   * Write `value` into both cache layers for `key`. The counterpart to
   * {@link peek} — lets a caller persist a derived value it computed itself
   * (e.g. an incrementally-updated routing blob) so the next read hits without a
   * recompute. Best-effort on the KV write.
   */
  set<T>(kv: KvNamespaceLike | undefined, key: string, value: T, opts?: CacheTtlOptions): Promise<void>;
  /** Invalidate both cache layers for `key` (plus the lkg KV spelling when `opts.lkg`). Call from every
   *  mutation that changes the cached data so the next read re-loads. A failed KV delete is
   *  reported and swallowed unless `opts.strict`, which rethrows once `retryDelete` is spent. */
  invalidate(kv: KvNamespaceLike | undefined, key: string, opts?: InvalidateOptions): Promise<void>;
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
/**
 * Storage-key segment of a {@link StaleEnvelope}. An envelope MUST NOT share a key with the
 * plain value: code that predates `staleOnError` (a rollback, or the other half of a mixed
 * deploy) reads the key as a raw value and would serve `{ __rtcStale, value, freshUntil }` AS the
 * cached value — a 7-day-lived wrong answer. Under `cache:lkg:` it is simply never read by it.
 */
const KV_LKG_SEGMENT = 'lkg:';
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
export async function kvStorageKey(key: string, variant?: 'lkg'): Promise<string> {
  const prefix = variant === 'lkg' ? `${KV_KEY_PREFIX}${KV_LKG_SEGMENT}` : KV_KEY_PREFIX;
  const raw = `${prefix}${key}`;
  const bytes = textEncoder.encode(raw);
  if (bytes.byteLength <= KV_MAX_KEY_BYTES) return raw;

  // The hash covers `raw` (variant included), so the two spellings can never collide either.
  return `${prefix}sha256:${await sha256HexBytes(bytes)}`;
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
  /** Misses currently being resolved, by key — what makes `getOrSet` single-flight.
   *  `invalidate` drops the entry, and a load only writes back while it is still the
   *  registered one, so a write racing an in-flight load cannot be overwritten by it. */
  const inFlight = new Map<string, Promise<unknown>>();
  const onError = options.onError ?? (() => undefined);
  const defer = options.defer ?? (() => false);
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
  const kvGet = async <T>(kv: KvNamespaceLike, key: string, operation: string, variant?: 'lkg'): Promise<T | null> => {
    const storageKey = await kvStorageKey(key, variant);
    try {
      return (await kv.get(storageKey, 'json')) as T | null;
    } catch (error) {
      // KV read failures never fail the request — the caller falls through.
      report(error, operation, 'get', storageKey, key);
      return null;
    }
  };

  /** Best-effort L2 write — a miss next time is acceptable. */
  const kvPut = async (kv: KvNamespaceLike, key: string, value: unknown, ttlSeconds: number | undefined, operation: string, variant?: 'lkg'): Promise<void> => {
    const storageKey = await kvStorageKey(key, variant);
    try {
      await kv.put(storageKey, JSON.stringify(value), { expirationTtl: kvTtl(ttlSeconds) });
    } catch (error) {
      report(error, operation, 'put', storageKey, key);
    }
  };

  /** The ONE KV write for a loaded/set value. Always a SINGLE put: with `staleOnError`
   *  it is the {@link StaleEnvelope}, living the stale window and carrying its own
   *  fresh deadline; without it, the raw value with the plain TTL (the original format). */
  const kvWrite = (kv: KvNamespaceLike, key: string, value: unknown, opts: CacheTtlOptions | undefined, operation: string): Promise<void> => {
    const stale = opts?.staleOnError;
    if (!stale) return kvPut(kv, key, value, opts?.kvTtlSeconds, operation);
    // A value with no JSON form (`undefined`) would serialize to an envelope WITHOUT a `value`
    // key, which no reader accepts: store nothing, so it reads as the miss it is.
    if (value === undefined) return Promise.resolve();
    const freshSeconds = kvTtl(opts?.kvTtlSeconds);
    const envelope: StaleEnvelope = { __rtcStale: 1, value, freshUntil: Date.now() + freshSeconds * 1000 };
    return kvPut(kv, key, envelope, Math.max(stale.ttlSeconds, freshSeconds), operation, 'lkg');
  };

  return {
    async getOrSet<T>(kv: KvNamespaceLike | undefined, key: string, loader: () => Promise<T>, opts?: CacheTtlOptions): Promise<T> {
      const now = Date.now();
      const l1Hit = l1Get(key, now);
      if (l1Hit) return l1Hit.value as T;

      const pending = inFlight.get(key);
      if (pending) return pending as Promise<T>;

      const l1Ttl = opts?.l1TtlMs ?? L1_TTL_MS;
      // `let` + definite assignment: the body compares against its OWN promise to
      // tell whether an invalidate overtook it, so it must be able to name itself.
      const staleOnError = opts?.staleOnError;
      let load!: Promise<T>;
      load = (async (): Promise<T> => {
        // The last-known-good value of an envelope whose fresh window has passed.
        let stale: { value: T } | undefined;
        if (kv) {
          // Opted-in calls live under the `lkg` spelling and plain calls under the plain one —
          // the two never read each other's bytes (see KV_LKG_SEGMENT).
          const raw = await kvGet<unknown>(kv, key, 'getOrSet', staleOnError ? 'lkg' : undefined);
          if (staleOnError) {
            if (isStaleEnvelope(raw)) {
              if (raw.freshUntil > Date.now()) {
                const value = raw.value as T;
                if (inFlight.get(key) === load) l1.set(key, { value, expiresAt: Date.now() + l1Ttl });
                return value;
              }
              stale = { value: raw.value as T };
            }
          } else if (raw != null) {
            const cached = raw as T;
            if (inFlight.get(key) === load) l1.set(key, { value: cached, expiresAt: Date.now() + l1Ttl });
            return cached;
          }
        }

        let fresh: T;
        try {
          fresh = toJsonShape(await loader());
        } catch (error) {
          if (!stale || !staleOnError?.when(error)) throw error;
          // Source refusing (e.g. DB outage): keep answering from last-known-good, and
          // hold it in L1 so a burst of requests does not re-hit the refusing source.
          if (inFlight.get(key) === load) l1.set(key, { value: stale.value, expiresAt: Date.now() + l1Ttl });
          return stale.value;
        }
        // Invalidated while loading: the value may predate the write that invalidated
        // it, so it answers THIS caller but is not cached for the next one.
        if (inFlight.get(key) !== load) return fresh;
        l1.set(key, { value: fresh, expiresAt: Date.now() + l1Ttl });
        if (kv) {
          const write = kvWrite(kv, key, fresh, opts, 'getOrSet');
          if (!defer(write)) await write;
        }
        return fresh;
      })();
      inFlight.set(key, load);
      try {
        return await load;
      } finally {
        if (inFlight.get(key) === load) inFlight.delete(key);
      }
    },

    async peek<T>(kv: KvNamespaceLike | undefined, key: string, opts?: Pick<CacheTtlOptions, 'staleOnError'>): Promise<T | null> {
      const now = Date.now();
      const l1Hit = l1Get(key, now);
      if (l1Hit) return l1Hit.value as T;

      if (kv) {
        const lkg = opts?.staleOnError ? 'lkg' : undefined;
        const raw = await kvGet<unknown>(kv, key, 'peek', lkg);
        // Opted-in: the entry is an envelope, and past its fresh window it is not a hit
        // (peek never serves stale). Plain: the raw value, exactly as before.
        const cached = (lkg ? (isStaleEnvelope(raw) && raw.freshUntil > now ? raw.value : null) : raw) as T | null;
        if (cached != null) {
          l1.set(key, { value: cached, expiresAt: now + L1_TTL_MS });
          return cached;
        }
      }
      return null;
    },

    async set<T>(kv: KvNamespaceLike | undefined, key: string, value: T, opts?: CacheTtlOptions): Promise<void> {
      l1.set(key, { value, expiresAt: Date.now() + (opts?.l1TtlMs ?? L1_TTL_MS) });
      if (kv) await kvWrite(kv, key, value, opts, 'set');
    },

    async invalidate(kv: KvNamespaceLike | undefined, key: string, opts?: InvalidateOptions): Promise<void> {
      l1.delete(key);
      inFlight.delete(key);
      if (!kv) return;
      // The last-known-good spelling only when the caller's reads opted into `staleOnError`
      // (`opts.lkg`): every other key keeps its single delete.
      const storageKeys = [await kvStorageKey(key)];
      if (opts?.lkg) storageKeys.push(await kvStorageKey(key, 'lkg'));
      const outcomes = await Promise.all(storageKeys.map(async (storageKey) => {
        try {
          await retryDelete(() => kv.delete(storageKey));
          return undefined;
        } catch (error) {
          // Strict: the failure is rethrown below and the receiver reports it — reporting here too
          // would be two reports of one error.
          if (!opts?.strict) report(error, 'invalidate', 'delete', storageKey, key);
          return { error };
        }
      }));
      // A failed delete leaves a last-known-good copy that lives for days: a writer whose
      // correctness depends on the invalidation says `strict` and learns of it.
      const failed = outcomes.find((outcome) => outcome !== undefined);
      if (opts?.strict && failed) throw failed.error;
    },

    clearL1(): void {
      l1.clear();
      inFlight.clear();
    },
  };
}
