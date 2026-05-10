/**
 * Persistent vendor-model cooldown store.
 *
 * Used by the LLM dispatcher to skip models that failed recently — across
 * Worker isolates and request boundaries, not just within one isolate's
 * lifetime. Failure classification drives TTL choice so transient hiccups
 * (5xx / timeouts) recover quickly while auth misconfiguration stays cooled
 * long enough to stop burning budget on doomed retries.
 *
 * Backed by the same `AUTH_CACHE_KV` binding as key-resolution caching to
 * avoid provisioning a second namespace. Different key prefix (`cooldown:`
 * vs `auth:`) keeps the concerns separate.
 *
 * Falls back to a per-isolate in-memory `Map` when `AUTH_CACHE_KV` isn't
 * bound — preserves the legacy local-only cooldown behavior so dev / test
 * environments without KV continue to work.
 */

import type { VendorId } from '../../application/llm/vendors';

/**
 * Just the slice of `Env` this module needs. Narrowing it here keeps the
 * `LlmProxyService.ProxyEnv` (which doesn't carry NEON / JWT / etc.) callable
 * without forcing every test or non-Worker caller to fabricate the full Env.
 */
export interface CooldownEnv {
  AUTH_CACHE_KV?: KVNamespace;
}

export type CooldownClass = 'transient' | 'auth' | 'embedded';

/** Per-classification TTL. Transient errors recover fast; auth errors are sticky. */
const TTL_SECONDS: Record<CooldownClass, number> = {
  transient: 5 * 60,        // 5 min — 5xx / 408 / 429 / network / vendor timeout
  auth:      30 * 60,       // 30 min — 401 / 403 (usually missing/expired key)
  embedded:  5 * 60,        // 5 min — 200 OK with embedded { error: ... }
};

/** Classify an HTTP status into a cooldown bucket. Single source of truth. */
export function classifyFailure(status: number, hint?: string): CooldownClass {
  if (status === 401 || status === 403) return 'auth';
  if (hint && hint.startsWith('embedded:')) return 'embedded';
  return 'transient';
}

const cacheKey = (vendor: VendorId, model: string) => `cooldown:${vendor}:${model}`;

// ---------------------------------------------------------------------------
// Backend abstraction — KV (production) and in-memory (dev/test) implement
// the same surface so `loadCooldownExpiries` and `recordFailure` each have a
// single body. Selection is per-call: the binding may be present in prod and
// absent in tests within the same import.
// ---------------------------------------------------------------------------

interface CooldownBackend {
  /** Returns expiry epoch-ms; 0 if cooled with unknown expiry; undefined if not cooled. */
  read(vendor: VendorId, model: string): Promise<number | undefined>;
  /** Persists `until` epoch-ms with a `ttlSec` lifetime. Errors are absorbed. */
  write(vendor: VendorId, model: string, until: number, ttlSec: number, status: number, cls: CooldownClass): Promise<void>;
}

const memMap = new Map<string, number>();

const memBackend: CooldownBackend = {
  async read(vendor, model) {
    const k = cacheKey(vendor, model);
    const until = memMap.get(k);
    if (!until) return undefined;
    if (Date.now() >= until) { memMap.delete(k); return undefined; }
    return until;
  },
  async write(vendor, model, until) {
    memMap.set(cacheKey(vendor, model), until);
  },
};

function kvBackend(kv: KVNamespace): CooldownBackend {
  return {
    async read(vendor, model) {
      const v = await kv.get(cacheKey(vendor, model)).catch(() => null);
      if (v == null) return undefined;
      try {
        const parsed = JSON.parse(v) as { until?: unknown };
        return typeof parsed?.until === 'number' ? parsed.until : 0;
      } catch { return 0; /* malformed value — still cooled, expiry unknown */ }
    },
    async write(vendor, model, until, ttlSec, status, cls) {
      await kv.put(
        cacheKey(vendor, model),
        JSON.stringify({ cls, status, until }),
        { expirationTtl: ttlSec },
      ).catch((err) => {
        console.warn(`[cooldown] kv.put failed for ${vendor}/${model}: ${err}`);
      });
    },
  };
}

const backendFor = (env: CooldownEnv): CooldownBackend =>
  env.AUTH_CACHE_KV ? kvBackend(env.AUTH_CACHE_KV) : memBackend;

// ---------------------------------------------------------------------------
// Public API — backend-agnostic.
// ---------------------------------------------------------------------------

/**
 * Bulk-fetch cooldown expiry for a list of (vendor, model) pairs. Returns a
 * Map keyed by `${vendor}/${model}` whose value is the epoch-ms expiry. Pairs
 * not on cooldown are absent from the map. `0` is used when the entry exists
 * in KV but the stored value lacks an `until` field (legacy shape) — caller
 * should treat that as "cooled, expiry unknown".
 */
export async function loadCooldownExpiries(
  env: CooldownEnv,
  candidates: ReadonlyArray<{ vendor: VendorId; model: string }>,
): Promise<Map<string, number>> {
  const backend = backendFor(env);
  const out = new Map<string, number>();
  await Promise.all(candidates.map(async ({ vendor, model }) => {
    const until = await backend.read(vendor, model);
    if (until !== undefined) out.set(`${vendor}/${model}`, until);
  }));
  return out;
}

/**
 * Set view of `loadCooldownExpiries` — for callers that only need to filter
 * the candidate chain and don't care about expiry timestamps.
 */
export async function loadCooldowns(
  env: CooldownEnv,
  candidates: ReadonlyArray<{ vendor: VendorId; model: string }>,
): Promise<Set<string>> {
  const map = await loadCooldownExpiries(env, candidates);
  return new Set(map.keys());
}

/**
 * Mark a vendor-model pair cooled. Caller passes the raw HTTP status (or
 * 0 for network/timeout) plus an optional `hint` carried by VendorRetryableError
 * so the classifier can distinguish embedded-error 200s.
 */
export async function recordFailure(
  env: CooldownEnv,
  vendor: VendorId,
  model: string,
  status: number,
  hint?: string,
): Promise<void> {
  const cls = classifyFailure(status, hint);
  const ttl = TTL_SECONDS[cls];
  const until = Date.now() + ttl * 1000;

  console.warn(
    `[cooldown] ${vendor}/${model} cooled for ${ttl}s — class=${cls} status=${status}` +
    (hint ? ` hint="${hint.slice(0, 120)}"` : ''),
  );

  await backendFor(env).write(vendor, model, until, ttl, status, cls);
}

/** Test-only: clear the in-memory map. */
export function _resetMemoryCooldowns(): void { memMap.clear(); }
