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

/**
 * Vendor-level cooldown — fires when one upstream key looks broken across
 * multiple models, so the cascade can jump to a different vendor instead of
 * walking 20+ models on a saturated key one 429 at a time.
 *
 *   - `auth` (401/403): 1 strike → cool. The key is bad for every model.
 *   - `transient` (429/5xx/408): N strikes within a sliding window → cool.
 *     One model 429ing doesn't mean the vendor is throttled, but three
 *     different models on the same vendor 429ing inside 60s almost always
 *     means the *key* is rate-limited globally.
 *   - `embedded` (200 + bad body): model-specific, never trips vendor cooldown.
 */
const VENDOR_FAILURE_WINDOW_MS  = 60_000;
const VENDOR_FAILURE_THRESHOLD  = 3;
const VENDOR_COOLDOWN_TTL_SEC: Record<'transient' | 'auth', number> = {
  transient: 5 * 60,        // 5 min — matches per-model transient
  auth:      30 * 60,       // 30 min — bad key won't recover without rotation
};

/** Classify an HTTP status into a cooldown bucket. Single source of truth. */
export function classifyFailure(status: number, hint?: string): CooldownClass {
  if (status === 401 || status === 403) return 'auth';
  if (hint && hint.startsWith('embedded:')) return 'embedded';
  return 'transient';
}

const cacheKey         = (vendor: VendorId, model: string) => `cooldown:${vendor}:${model}`;
const vendorCooldownKey = (vendor: VendorId) => `vendor_cooldown:${vendor}`;
const vendorFailuresKey = (vendor: VendorId) => `vendor_failures:${vendor}`;

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

  /** Returns vendor cooldown expiry epoch-ms; undefined if not cooled. */
  readVendor(vendor: VendorId): Promise<number | undefined>;
  /** Persists vendor cooldown for `ttlSec`. */
  writeVendor(vendor: VendorId, until: number, ttlSec: number, cls: 'transient' | 'auth'): Promise<void>;
  /** Read recent failure timestamps for sliding-window decisions. */
  readVendorFailures(vendor: VendorId): Promise<number[]>;
  /** Persist filtered + appended failure ring. TTL bounded by `VENDOR_FAILURE_WINDOW_MS`. */
  writeVendorFailures(vendor: VendorId, ring: number[]): Promise<void>;
}

const memMap            = new Map<string, number>();
const memVendorCooldown = new Map<VendorId, number>();
const memVendorRing     = new Map<VendorId, number[]>();

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
  async readVendor(vendor) {
    const until = memVendorCooldown.get(vendor);
    if (!until) return undefined;
    if (Date.now() >= until) { memVendorCooldown.delete(vendor); return undefined; }
    return until;
  },
  async writeVendor(vendor, until) {
    memVendorCooldown.set(vendor, until);
  },
  async readVendorFailures(vendor) {
    return memVendorRing.get(vendor) ?? [];
  },
  async writeVendorFailures(vendor, ring) {
    if (ring.length === 0) memVendorRing.delete(vendor);
    else memVendorRing.set(vendor, ring);
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
    async readVendor(vendor) {
      const v = await kv.get(vendorCooldownKey(vendor)).catch(() => null);
      if (v == null) return undefined;
      try {
        const parsed = JSON.parse(v) as { until?: unknown };
        return typeof parsed?.until === 'number' ? parsed.until : 0;
      } catch { return 0; }
    },
    async writeVendor(vendor, until, ttlSec, cls) {
      await kv.put(
        vendorCooldownKey(vendor),
        JSON.stringify({ cls, until }),
        { expirationTtl: ttlSec },
      ).catch((err) => {
        console.warn(`[cooldown] kv.put failed for vendor ${vendor}: ${err}`);
      });
    },
    async readVendorFailures(vendor) {
      const v = await kv.get(vendorFailuresKey(vendor)).catch(() => null);
      if (v == null) return [];
      try {
        const parsed = JSON.parse(v) as { ring?: unknown };
        return Array.isArray(parsed?.ring) ? parsed.ring.filter((n): n is number => typeof n === 'number') : [];
      } catch { return []; }
    },
    async writeVendorFailures(vendor, ring) {
      if (ring.length === 0) {
        await kv.delete(vendorFailuresKey(vendor)).catch(() => { /* absorb */ });
        return;
      }
      await kv.put(
        vendorFailuresKey(vendor),
        JSON.stringify({ ring }),
        { expirationTtl: Math.ceil(VENDOR_FAILURE_WINDOW_MS / 1000) },
      ).catch((err) => {
        console.warn(`[cooldown] kv.put failed for vendor-failures ${vendor}: ${err}`);
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
 *
 * Also tracks vendor-level signal: an `auth` failure trips vendor cooldown
 * immediately (the key is bad for every model), and 3 `transient` failures
 * within `VENDOR_FAILURE_WINDOW_MS` across any models on the same vendor
 * trips vendor cooldown so the cascade jumps to a different upstream instead
 * of walking the rest of the vendor's pool one 429 at a time.
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

  const backend = backendFor(env);
  await Promise.all([
    backend.write(vendor, model, until, ttl, status, cls),
    maybeTripVendorCooldown(backend, vendor, cls, status),
  ]);
}

/**
 * Vendor-level cooldown decision. Auth failures trip immediately; transient
 * failures accumulate in a 60-second ring buffer and trip when ≥3 distinct
 * model failures land in the same window. Embedded failures do not propagate
 * to vendor cooldown because they're model-specific.
 */
async function maybeTripVendorCooldown(
  backend: CooldownBackend,
  vendor: VendorId,
  cls: CooldownClass,
  status: number,
): Promise<void> {
  if (cls === 'embedded') return;

  if (cls === 'auth') {
    const ttl   = VENDOR_COOLDOWN_TTL_SEC.auth;
    const until = Date.now() + ttl * 1000;
    console.warn(
      `[cooldown] vendor ${vendor} cooled for ${ttl}s — auth failure (status=${status}); cascade will skip this vendor`,
    );
    await backend.writeVendor(vendor, until, ttl, 'auth');
    return;
  }

  // Transient — accumulate timestamps and trip when threshold reached.
  const now    = Date.now();
  const cutoff = now - VENDOR_FAILURE_WINDOW_MS;
  const prior  = await backend.readVendorFailures(vendor);
  const ring   = [...prior.filter((t) => t >= cutoff), now];

  if (ring.length >= VENDOR_FAILURE_THRESHOLD) {
    const ttl   = VENDOR_COOLDOWN_TTL_SEC.transient;
    const until = now + ttl * 1000;
    console.warn(
      `[cooldown] vendor ${vendor} cooled for ${ttl}s — ${ring.length} transient failures in ${VENDOR_FAILURE_WINDOW_MS}ms; cascade will skip this vendor`,
    );
    // Clear the ring once we've tripped — fresh failures after cooldown lifts
    // shouldn't inherit prior timestamps.
    await Promise.all([
      backend.writeVendor(vendor, until, ttl, 'transient'),
      backend.writeVendorFailures(vendor, []),
    ]);
    return;
  }

  await backend.writeVendorFailures(vendor, ring);
}

/**
 * Bulk-fetch vendor-level cooldown expiry. Returns a Map keyed by vendor whose
 * value is the epoch-ms expiry (`0` for legacy entries without an expiry).
 * Vendors not on cooldown are absent. Admin UI uses the expiry to show
 * countdown; chain composer uses the keyset to skip cooled vendors.
 */
export async function loadCooledVendorExpiries(
  env: CooldownEnv,
  vendors: ReadonlyArray<VendorId>,
): Promise<Map<VendorId, number>> {
  const backend = backendFor(env);
  const out = new Map<VendorId, number>();
  await Promise.all(vendors.map(async (vendor) => {
    const until = await backend.readVendor(vendor);
    if (until !== undefined) out.set(vendor, until);
  }));
  return out;
}

/** Set view of `loadCooledVendorExpiries` for chain-composition callers. */
export async function loadCooledVendors(
  env: CooldownEnv,
  vendors: ReadonlyArray<VendorId>,
): Promise<Set<VendorId>> {
  const map = await loadCooledVendorExpiries(env, vendors);
  return new Set(map.keys());
}

/** Test-only: clear the in-memory maps. */
export function _resetMemoryCooldowns(): void {
  memMap.clear();
  memVendorCooldown.clear();
  memVendorRing.clear();
}
