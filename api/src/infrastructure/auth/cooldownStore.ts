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
import { CAPACITY_LIMIT_MARKER } from '../../application/llm/vendors';

/**
 * Just the slice of `Env` this module needs. Narrowing it here keeps the
 * `LlmProxyService.ProxyEnv` (which doesn't carry NEON / JWT / etc.) callable
 * without forcing every test or non-Worker caller to fabricate the full Env.
 */
export interface CooldownEnv {
  AUTH_CACHE_KV?: KVNamespace;
}

export type CooldownClass = 'transient' | 'auth' | 'embedded' | 'request_error' | 'capacity';

/** Per-classification TTL. Transient errors recover fast; auth errors are sticky.
 *  `request_error` is special — it writes NO cooldown at all (TTL 0), so it never
 *  appears in this table's hot path; see `recordFailure`'s early return. */
const TTL_SECONDS: Record<Exclude<CooldownClass, 'request_error'>, number> = {
  transient: 5 * 60,        // 5 min — 5xx / 408 / 429 / network / vendor timeout
  auth:      30 * 60,       // 30 min — 401 / 403 (usually missing/expired key)
  embedded:  5 * 60,        // 5 min — 200 OK with embedded { error: ... }
  // 60 min — a usage cap / spend limit / low credit balance ({@link CAPACITY_LIMIT_MARKER}).
  // A metered account that has hit its monthly cap won't recover for hours-to-days,
  // so a 5-min transient cool would let the cascade re-reach (and, until the cap
  // tripped, re-SPEND on) the capped key every minute. A long backoff makes a capped
  // vendor genuinely stand down. Trips vendor cooldown on the FIRST strike (one
  // capped key is capped for every model on it) — see maybeTripVendorCooldown.
  capacity:  60 * 60,
};

/**
 * Early-recovery ("half-open") trial — gap [1235].
 *
 * The full TTL above keeps a model benched even when the vendor blip lasted
 * only a few seconds, so a 1-minute outage costs ~5 minutes of unnecessary
 * skipping. We can't run a true background HEAD probe in-isolate without
 * spending an unbounded number of KV/network subrequests (the same ceiling
 * `COOLDOWN_PREFETCH_LIMIT` guards). Instead, each cooldown carries a
 * `trialAfter` epoch-ms — a short fraction of the full TTL — after which the
 * read path stops reporting the model as cooled, letting the dispatcher send
 * exactly ONE live request as the probe:
 *
 *   - probe succeeds → no `recordFailure`, so nothing re-cools; the stale KV
 *     entry simply lives out its TTL while being ignored. Model is back.
 *   - probe fails    → `recordFailure` writes a fresh cooldown (new TTL + new
 *     `trialAfter`), so the half-open window re-opens later, not immediately.
 *
 * Cost: ZERO extra KV subrequests — `trialAfter` rides inside the value the
 * read already fetches, and the trial is just the dispatch the cascade was
 * going to make anyway. The only trade-off is that under concurrent load more
 * than one in-flight request may trial the same model in the half-open window
 * (each is one request, never a fan-out); that's the same one-request-lag
 * trade-off already accepted for `COOLDOWN_PREFETCH_LIMIT`.
 *
 * `trialAfter` is capped so even the 30-min auth cooldown gets a probe within
 * a couple of minutes — a rotated key shouldn't wait half an hour to be
 * noticed — while staying long enough that a genuinely-down vendor isn't
 * hammered every request.
 */
const TRIAL_AFTER_FRACTION = 0.25;   // probe after a quarter of the TTL …
const TRIAL_AFTER_MAX_SEC  = 90;     // … but never wait longer than 90s.

/** Epoch-ms at which a cooldown opens its single half-open trial window. */
function trialAfterFor(now: number, ttlSec: number): number {
  const delaySec = Math.min(ttlSec * TRIAL_AFTER_FRACTION, TRIAL_AFTER_MAX_SEC);
  return now + delaySec * 1000;
}

/**
 * A stored cooldown is still "active" (skip the model) only until its
 * `trialAfter` instant. Past that — but before `until` — the model is
 * half-open and the read path reports it as eligible so the cascade can probe
 * it. A legacy entry with no `trialAfter` (number absent) falls back to the
 * pre-[1235] behavior: cooled for the whole `until` window.
 */
function isStillActive(now: number, until: number, trialAfter?: number): boolean {
  if (now >= until) return false;                 // full TTL elapsed
  if (typeof trialAfter === 'number') return now < trialAfter;
  return true;                                    // legacy: no trial window
}

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
const VENDOR_COOLDOWN_TTL_SEC: Record<'transient' | 'auth' | 'capacity', number> = {
  transient: 5 * 60,        // 5 min — matches per-model transient
  auth:      30 * 60,       // 30 min — bad key won't recover without rotation
  capacity:  60 * 60,       // 60 min — account hit its usage/spend cap; back off hard
};

/**
 * Classify an HTTP status into a cooldown bucket. Single source of truth.
 *
 *   - `auth` (401/403): bad/expired key — sticky per-model AND vendor cooldown.
 *   - `embedded`: 200 OK with an embedded error body — model-specific.
 *   - `request_error` (400/422): caller-side schema / validation bug. The model
 *     and vendor are fine — the *request* is malformed — so this writes NEITHER
 *     model nor vendor cooldown. Cooling them would (a) wrongly bench a healthy
 *     model and (b) trip vendor cooldown for what is the caller's own bad
 *     payload, starving every other tenant on that vendor for a schema typo.
 *   - `capacity`: a usage cap / spend limit / low credit balance ({@link
 *     CAPACITY_LIMIT_MARKER}). The vendor mapped its 400/429 to this because the
 *     request is fine but the ACCOUNT is out of budget — a long, vendor-wide
 *     backoff so the gateway stops re-reaching (and re-spending on) a capped key.
 *   - `transient` (5xx/408/429/network): everything else — short per-model cool.
 */
export function classifyFailure(status: number, hint?: string): CooldownClass {
  // Capacity is checked FIRST: it rides on a 429 (so the request_error/auth gates
  // below would misroute it) and its long backoff is the whole point of the class.
  if (hint && hint.includes(CAPACITY_LIMIT_MARKER)) return 'capacity';
  if (status === 401 || status === 403) return 'auth';
  if (status === 400 || status === 422) return 'request_error';
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

/** Raw cooldown record as stored. `until` is the full-TTL expiry epoch-ms (0 if
 *  unknown/legacy); `trialAfter` is the half-open probe instant ([1235]), absent
 *  on legacy entries. */
interface CooldownRecord {
  until: number;
  trialAfter?: number;
}

interface CooldownBackend {
  /** Returns the stored record (full `until` + optional `trialAfter`), or
   *  undefined if not cooled at all. Does NOT apply half-open eligibility —
   *  callers (`read`-gating vs `status`-display) decide via `isStillActive`. */
  read(vendor: VendorId, model: string): Promise<CooldownRecord | undefined>;
  /** Persists `until` epoch-ms + `trialAfter` with a `ttlSec` lifetime. Errors are absorbed. */
  write(vendor: VendorId, model: string, until: number, trialAfter: number, ttlSec: number, status: number, cls: CooldownClass): Promise<void>;

  /** Returns vendor cooldown expiry epoch-ms; undefined if not cooled. */
  readVendor(vendor: VendorId): Promise<number | undefined>;
  /** Persists vendor cooldown for `ttlSec`. */
  writeVendor(vendor: VendorId, until: number, ttlSec: number, cls: 'transient' | 'auth' | 'capacity'): Promise<void>;
  /** Read recent failure timestamps for sliding-window decisions. */
  readVendorFailures(vendor: VendorId): Promise<number[]>;
  /** Persist filtered + appended failure ring. TTL bounded by `VENDOR_FAILURE_WINDOW_MS`. */
  writeVendorFailures(vendor: VendorId, ring: number[]): Promise<void>;
}

const memMap            = new Map<string, CooldownRecord>();
const memVendorCooldown = new Map<VendorId, number>();
const memVendorRing     = new Map<VendorId, number[]>();

const memBackend: CooldownBackend = {
  async read(vendor, model) {
    const k = cacheKey(vendor, model);
    const rec = memMap.get(k);
    if (!rec) return undefined;
    if (Date.now() >= rec.until) { memMap.delete(k); return undefined; }
    return rec;
  },
  async write(vendor, model, until, trialAfter) {
    memMap.set(cacheKey(vendor, model), { until, trialAfter });
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
        const parsed = JSON.parse(v) as { until?: unknown; trialAfter?: unknown };
        const until = typeof parsed?.until === 'number' ? parsed.until : 0;
        const trialAfter = typeof parsed?.trialAfter === 'number' ? parsed.trialAfter : undefined;
        return { until, trialAfter };
      } catch { return { until: 0 }; /* malformed value — still cooled, expiry unknown */ }
    },
    async write(vendor, model, until, trialAfter, ttlSec, status, cls) {
      await kv.put(
        cacheKey(vendor, model),
        JSON.stringify({ cls, status, until, trialAfter }),
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
 *
 * `mode` selects how the half-open trial window ([1235]) is reported:
 *   - `'gate'` (default): a model past its `trialAfter` is treated as eligible
 *     and OMITTED from the map, so the cascade probes it with one live request.
 *   - `'display'`: the full `until` is returned regardless of `trialAfter`, so
 *     the admin/status surface can still show the original countdown while the
 *     model is half-open.
 */
export async function loadCooldownExpiries(
  env: CooldownEnv,
  candidates: ReadonlyArray<{ vendor: VendorId; model: string }>,
  mode: 'gate' | 'display' = 'gate',
): Promise<Map<string, number>> {
  const backend = backendFor(env);
  const now = Date.now();
  const out = new Map<string, number>();
  await Promise.all(candidates.map(async ({ vendor, model }) => {
    const rec = await backend.read(vendor, model);
    if (rec === undefined) return;
    if (mode === 'gate' && !isStillActive(now, rec.until, rec.trialAfter)) return;
    out.set(`${vendor}/${model}`, rec.until);
  }));
  return out;
}

/**
 * Set view of `loadCooldownExpiries` — for callers that only need to filter
 * the candidate chain and don't care about expiry timestamps. Always uses the
 * `'gate'` mode so half-open models are reported as eligible for a trial.
 */
export async function loadCooldowns(
  env: CooldownEnv,
  candidates: ReadonlyArray<{ vendor: VendorId; model: string }>,
): Promise<Set<string>> {
  const map = await loadCooldownExpiries(env, candidates, 'gate');
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

  // Request-validation failures (400/422) are the caller's bug, not the model's
  // or vendor's. Record NOTHING — cooling a healthy model would bench it for the
  // next caller, and tripping vendor cooldown would starve every other tenant on
  // that upstream for one malformed payload. The cascade surfaces these as a
  // fatal 4xx instead (see LlmProxyService.exhaustedResponse).
  if (cls === 'request_error') {
    console.warn(
      `[cooldown] ${vendor}/${model} request_error status=${status} — NOT cooled (caller-side validation)` +
      (hint ? ` hint="${hint.slice(0, 120)}"` : ''),
    );
    return;
  }

  const ttl = TTL_SECONDS[cls];
  const now = Date.now();
  const until = now + ttl * 1000;
  const trialAfter = trialAfterFor(now, ttl);

  console.warn(
    `[cooldown] ${vendor}/${model} cooled for ${ttl}s (half-open trial after ${Math.round((trialAfter - now) / 1000)}s) — class=${cls} status=${status}` +
    (hint ? ` hint="${hint.slice(0, 120)}"` : ''),
  );

  const backend = backendFor(env);
  await Promise.all([
    backend.write(vendor, model, until, trialAfter, ttl, status, cls),
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
  // `embedded` is model-specific; `request_error` is caller-side and never even
  // reaches here (recordFailure returns first). Neither propagates to the vendor.
  if (cls === 'embedded' || cls === 'request_error') return;

  // Auth (bad key) and capacity (account out of budget) both trip the vendor on a
  // SINGLE strike: the condition is global to the key, so every model on it is
  // unreachable. Capacity gets the longer backoff so a capped metered key (the
  // funded Anthropic floor that blew its monthly limit) stands down instead of
  // being re-reached — and re-billed — by the next run.
  if (cls === 'auth' || cls === 'capacity') {
    const ttl   = VENDOR_COOLDOWN_TTL_SEC[cls];
    const until = Date.now() + ttl * 1000;
    console.warn(
      `[cooldown] vendor ${vendor} cooled for ${ttl}s — ${cls} failure (status=${status}); cascade will skip this vendor`,
    );
    await backend.writeVendor(vendor, until, ttl, cls);
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
