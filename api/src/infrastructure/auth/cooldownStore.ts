import { reportCaughtError } from '../../application/observability/caughtErrorReporter';
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
const TRIAL_AFTER_MAX_SEC  = 90;     // … but never wait longer than 90s on the FIRST strike.

/**
 * ESCALATING BACKOFF — the fix for "the whole failover chain burns on every dispatch".
 *
 * MEASURED (project 11, 2026-07-31): 150 of 164 terminal runs in one day were provider
 * 429s — `Gateway 429 on model 'direct/…' · chain: … → … → …` — i.e. the cascade walked
 * its entire chain and exhausted it, over and over, all day.
 *
 * The flat TTL above cannot stop that, and it is worth being precise about WHY, because
 * the numbers look like they should: a 5-minute cool with a 90-second half-open probe
 * means a chronically-throttled model is re-tried roughly every 90 seconds FOREVER. Each
 * of those probes is a real dispatch that costs a billable run, marks a ticket failed,
 * and learns nothing that the previous ninety-one probes did not already establish. The
 * half-open trial is exactly right for a model that blipped; it is exactly wrong for a
 * free pool that is saturated for the day, and the flat TTL cannot tell the two apart.
 *
 * So a cooldown now carries a STRIKE COUNT, and each consecutive strike doubles both the
 * bench time and the probe delay. A model that blipped once is still back in ~75s; a
 * model that has 429'd five times in a row stands down for the hour it needs to.
 *
 * It SELF-RESETS with no extra write on the success path — the strike count lives inside
 * the cooldown record, so when the full TTL elapses without a fresh failure the record
 * expires and the next strike starts again at one. That matters: a success hook would
 * mean a KV write on every successful request, which is the hot path.
 */
const COOLDOWN_MAX_TTL_SEC = 60 * 60;   // no class benches a model longer than an hour.

/**
 * Bench time owed after `strikes` CONSECUTIVE failures of the same (vendor, model).
 * Doubles per strike from the class base, capped. PURE — unit-tested directly.
 */
export function escalatedTtlSeconds(cls: Exclude<CooldownClass, 'request_error'>, strikes: number): number {
  const n = Math.max(1, Math.floor(strikes) || 1);
  return Math.min(TTL_SECONDS[cls] * 2 ** (n - 1), COOLDOWN_MAX_TTL_SEC);
}

/**
 * How long before a cooled entry opens its single half-open probe. Still a quarter of
 * the (already escalated) TTL, but the 90-second ceiling now scales with the strike
 * count — otherwise the escalation above would be defeated by the probe, which is the
 * thing actually spending the runs. PURE.
 */
export function trialAfterDelaySeconds(ttlSec: number, strikes: number): number {
  const n = Math.max(1, Math.floor(strikes) || 1);
  return Math.min(ttlSec * TRIAL_AFTER_FRACTION, TRIAL_AFTER_MAX_SEC * n);
}

/** Epoch-ms at which a cooldown opens its single half-open trial window. */
function trialAfterFor(now: number, ttlSec: number, strikes: number): number {
  return now + trialAfterDelaySeconds(ttlSec, strikes) * 1000;
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

/**
 * ONE composite key per vendor holding EVERY cooled model on it, rather than one
 * key per (vendor, model).
 *
 * WHY. A failed cascade cools every attempt it made, and the old scheme turned that
 * into 2N parallel KV writes on the failure path (one `recordFailure` per attempt —
 * itself a read + a write — plus a vendor-fault write per attempt). The read side
 * was worse: composing a chain prefetched one KV read PER CANDIDATE, which is what
 * `COOLDOWN_PREFETCH_LIMIT` exists to cap. A Worker has a hard subrequest ceiling,
 * and spending it on bookkeeping is spending it instead of on the actual retries.
 * Grouped by vendor, a whole cascade costs one read + one write per DISTINCT VENDOR
 * — typically one or two, regardless of how many models were tried.
 *
 * THE TRADE-OFF, stated plainly: the blob is read-modify-written, so two concurrent
 * requests cooling different models on the same vendor can lose one of the two
 * writes. That is acceptable and it is not a new class of error — a cooldown is
 * ADVISORY (the worst case is one extra doomed attempt, which the cascade already
 * handles), whereas exhausting the subrequest budget fails the request outright.
 * Writes prune expired entries, so the blob cannot grow without bound.
 */
const vendorModelsKey   = (vendor: VendorId) => `cooldowns:${vendor}`;
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
  /** Consecutive failures of this (vendor, model) — drives {@link escalatedTtlSeconds}.
   *  Absent on legacy entries written before escalation; treated as 0 so the next
   *  failure starts the ladder at one. */
  strikes?: number;
}

/** Vendor-level cooldown as stored. `strikes` escalates the vendor bench exactly as
 *  the per-model one does — a vendor that keeps tripping is saturated, not blipping. */
interface VendorCooldownRecord {
  until: number;
  strikes?: number;
}

/** Every cooled model on one vendor, keyed by model id — the composite blob. */
type VendorModelCooldowns = Record<string, CooldownRecord>;

interface CooldownBackend {
  /** The whole composite blob for one vendor. Expired entries are dropped on read
   *  so a caller never has to re-check `until` for membership. ONE KV read. */
  readModels(vendor: VendorId): Promise<VendorModelCooldowns>;
  /** Replace one vendor's blob. `ttlSec` must cover the LONGEST-lived entry in it,
   *  or a still-valid auth cooldown would expire with a short transient one. */
  writeModels(vendor: VendorId, models: VendorModelCooldowns, ttlSec: number): Promise<void>;

  /** Returns the vendor's cooldown record (expiry epoch-ms + strike count); undefined if not cooled. */
  readVendor(vendor: VendorId): Promise<VendorCooldownRecord | undefined>;
  /** Persists vendor cooldown for `ttlSec`. */
  writeVendor(vendor: VendorId, until: number, ttlSec: number, cls: 'transient' | 'auth' | 'capacity', strikes: number): Promise<void>;
  /** Read recent failure timestamps for sliding-window decisions. */
  readVendorFailures(vendor: VendorId): Promise<number[]>;
  /** Persist filtered + appended failure ring. TTL bounded by `VENDOR_FAILURE_WINDOW_MS`. */
  writeVendorFailures(vendor: VendorId, ring: number[]): Promise<void>;
}

const memMap            = new Map<VendorId, VendorModelCooldowns>();
const memVendorCooldown = new Map<VendorId, VendorCooldownRecord>();
const memVendorRing     = new Map<VendorId, number[]>();

/** Drop entries whose full TTL has elapsed. Applied on every read AND before every
 *  write so the composite blob is self-pruning and cannot grow without bound. */
function livingEntries(models: VendorModelCooldowns, now: number): VendorModelCooldowns {
  const out: VendorModelCooldowns = {};
  for (const [model, rec] of Object.entries(models)) {
    if (rec && typeof rec.until === 'number' && now < rec.until) out[model] = rec;
  }
  return out;
}

const memBackend: CooldownBackend = {
  async readModels(vendor) {
    return livingEntries(memMap.get(vendor) ?? {}, Date.now());
  },
  async writeModels(vendor, models, _ttlSec) {
    const living = livingEntries(models, Date.now());
    if (Object.keys(living).length === 0) memMap.delete(vendor);
    else memMap.set(vendor, living);
  },
  async readVendor(vendor) {
    const rec = memVendorCooldown.get(vendor);
    if (!rec) return undefined;
    if (Date.now() >= rec.until) { memVendorCooldown.delete(vendor); return undefined; }
    return rec;
  },
  async writeVendor(vendor, until, _ttlSec, _cls, strikes) {
    memVendorCooldown.set(vendor, { until, strikes });
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
    async readModels(vendor) {
      const v = await kv.get(vendorModelsKey(vendor)).catch(() => null);
      if (v == null) return {};
      try {
        const parsed = JSON.parse(v) as { models?: unknown };
        const models = (parsed?.models ?? {}) as Record<string, unknown>;
        const out: VendorModelCooldowns = {};
        for (const [model, raw] of Object.entries(models)) {
          const r = raw as { until?: unknown; trialAfter?: unknown; strikes?: unknown };
          out[model] = {
            until: typeof r?.until === 'number' ? r.until : 0,
            ...(typeof r?.trialAfter === 'number' ? { trialAfter: r.trialAfter } : {}),
            ...(typeof r?.strikes === 'number' ? { strikes: r.strikes } : {}),
          };
        }
        return livingEntries(out, Date.now());
      } catch { return {}; /* malformed blob — treat the vendor as uncooled */ }
    },
    async writeModels(vendor, models, ttlSec) {
      const living = livingEntries(models, Date.now());
      if (Object.keys(living).length === 0) {
        await kv.delete(vendorModelsKey(vendor)).catch((error) => { /* absorb */
          reportCaughtError(error, { source: "infrastructure/auth/cooldownStore.ts", operation: "writeModels" });
        });
        return;
      }
      await kv.put(
        vendorModelsKey(vendor),
        JSON.stringify({ models: living }),
        { expirationTtl: Math.max(60, ttlSec) },
      ).catch((err) => {
        reportCaughtError(err, { source: "infrastructure/auth/cooldownStore.ts", operation: "writeModels", level: 'warning', context: { logMessage: `[cooldown] kv.put failed for ${vendor} cooldown blob: ${err}` } });
      });
    },
    async readVendor(vendor) {
      const v = await kv.get(vendorCooldownKey(vendor)).catch(() => null);
      if (v == null) return undefined;
      try {
        const parsed = JSON.parse(v) as { until?: unknown; strikes?: unknown };
        return {
          until: typeof parsed?.until === 'number' ? parsed.until : 0,
          strikes: typeof parsed?.strikes === 'number' ? parsed.strikes : undefined,
        };
      } catch { return { until: 0 }; }
    },
    async writeVendor(vendor, until, ttlSec, cls, strikes) {
      await kv.put(
        vendorCooldownKey(vendor),
        JSON.stringify({ cls, until, strikes }),
        { expirationTtl: ttlSec },
      ).catch((err) => {
        reportCaughtError(err, { source: "infrastructure/auth/cooldownStore.ts", operation: "writeVendor", level: 'warning', context: { logMessage: `[cooldown] kv.put failed for vendor ${vendor}: ${err}` } });
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
        await kv.delete(vendorFailuresKey(vendor)).catch((error) => { /* absorb */ 
          reportCaughtError(error, { source: "infrastructure/auth/cooldownStore.ts", operation: "writeVendorFailures" });
        });
        return;
      }
      await kv.put(
        vendorFailuresKey(vendor),
        JSON.stringify({ ring }),
        { expirationTtl: Math.ceil(VENDOR_FAILURE_WINDOW_MS / 1000) },
      ).catch((err) => {
        reportCaughtError(err, { source: "infrastructure/auth/cooldownStore.ts", operation: "writeVendorFailures", level: 'warning', context: { logMessage: `[cooldown] kv.put failed for vendor-failures ${vendor}: ${err}` } });
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
  // ONE read per DISTINCT VENDOR. Previously this was one read per candidate, which
  // is what `COOLDOWN_PREFETCH_LIMIT` had to cap: a wide chain spent its subrequest
  // budget asking about cooldowns instead of making the retries the budget is for.
  const byVendor = new Map<VendorId, string[]>();
  for (const { vendor, model } of candidates) {
    byVendor.set(vendor, [...(byVendor.get(vendor) ?? []), model]);
  }
  await Promise.all([...byVendor].map(async ([vendor, models]) => {
    const blob: VendorModelCooldowns = await backend.readModels(vendor).catch(() => ({}));
    for (const model of models) {
      const rec = blob[model];
      if (rec === undefined) continue;
      if (mode === 'gate' && !isStillActive(now, rec.until, rec.trialAfter)) continue;
      out.set(`${vendor}/${model}`, rec.until);
    }
  }));
  return out;
}

/**
 * Every model currently cooled on ONE vendor, in ONE read.
 *
 * The composite key scheme makes this the natural query: a whole vendor's cooldowns
 * live in a single blob, so asking "what is cooled on this vendor" costs exactly the
 * same as asking about one model. Used by the mid-cascade re-check, which needs to
 * answer that question repeatedly for different models on the same vendor without
 * paying a read each time.
 *
 * Half-open (`trialAfter` elapsed) models are OMITTED — same `'gate'` semantics as
 * `loadCooldowns`, so a model due for its one probe is reported as eligible.
 */
export async function loadCooledModelsForVendor(
  env: CooldownEnv,
  vendor: VendorId,
): Promise<Set<string>> {
  const now = Date.now();
  const blob = await backendFor(env).readModels(vendor);
  return new Set(
    Object.entries(blob)
      .filter(([, rec]) => isStillActive(now, rec.until, rec.trialAfter))
      .map(([model]) => model),
  );
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
  // Delegates so the single-attempt and whole-cascade paths cannot diverge —
  // classification, the request_error carve-out, and the vendor trip all live in
  // `recordFailures`.
  await recordFailures(env, [{ vendor, model, status, ...(hint !== undefined ? { hint } : {}) }]);
}

/** One model's cooldown decision, folded into an existing blob. PURE except for the
 *  log line — separated so the single and batch paths cannot diverge. */
function coolInto(
  models: VendorModelCooldowns,
  vendor: VendorId,
  model: string,
  cls: Exclude<CooldownClass, 'request_error'>,
  status: number,
  hint: string | undefined,
  now: number,
): number {
  // The strike count comes from the blob we already read. An entry that has lived out
  // its TTL is pruned on read, so a model that recovered starts the ladder over at one
  // — the escalation self-resets with no success hook writing KV on every good request.
  const strikes = (models[model]?.strikes ?? 0) + 1;
  const ttl = escalatedTtlSeconds(cls, strikes);
  const trialAfter = trialAfterFor(now, ttl, strikes);
  models[model] = { until: now + ttl * 1000, trialAfter, strikes };
  console.warn(
    `[cooldown] ${vendor}/${model} cooled for ${ttl}s (strike ${strikes}, half-open trial after ${Math.round((trialAfter - now) / 1000)}s) — class=${cls} status=${status}` +
    (hint ? ` hint="${hint.slice(0, 120)}"` : ''),
  );
  return ttl;
}

/**
 * Cool a WHOLE cascade's worth of failed attempts in one pass.
 *
 * This is the shape the failure path actually has: a cascade that exhausted N
 * candidates has N attempts to record, and doing them one at a time cost 2N+
 * parallel KV operations on a request that had already spent its budget failing.
 * Grouped by vendor it is one read + one write per DISTINCT VENDOR, plus the
 * vendor-level trip decision — which is where the real signal is anyway.
 *
 * `recordFailure` is the single-attempt front door onto exactly this code, so the
 * two paths cannot drift.
 */
export async function recordFailures(
  env: CooldownEnv,
  attempts: ReadonlyArray<{ vendor: VendorId; model: string; status: number; hint?: string }>,
): Promise<void> {
  if (attempts.length === 0) return;
  const backend = backendFor(env);
  const now = Date.now();

  const byVendor = new Map<VendorId, Array<{ model: string; status: number; hint?: string; cls: CooldownClass }>>();
  for (const a of attempts) {
    const cls = classifyFailure(a.status, a.hint);
    // Request-validation failures (400/422) are the caller's bug, not the model's or
    // vendor's. Record NOTHING — cooling a healthy model would bench it for the next
    // caller, and tripping vendor cooldown would starve every other tenant on that
    // upstream for one malformed payload. The cascade surfaces these as a fatal 4xx
    // instead (see LlmProxyService.exhaustedResponse).
    if (cls === 'request_error') {
      console.warn(
        `[cooldown] ${a.vendor}/${a.model} request_error status=${a.status} — NOT cooled (caller-side validation)` +
        (a.hint ? ` hint="${a.hint.slice(0, 120)}"` : ''),
      );
      continue;
    }
    byVendor.set(a.vendor, [...(byVendor.get(a.vendor) ?? []), { model: a.model, status: a.status, ...(a.hint !== undefined ? { hint: a.hint } : {}), cls }]);
  }
  if (byVendor.size === 0) return;

  await Promise.all([...byVendor].map(async ([vendor, entries]) => {
    const models = await backend.readModels(vendor).catch(() => ({} as VendorModelCooldowns));
    let maxTtl = 0;
    for (const e of entries) {
      maxTtl = Math.max(maxTtl, coolInto(models, vendor, e.model, e.cls as Exclude<CooldownClass, 'request_error'>, e.status, e.hint, now));
    }
    // The blob's TTL must cover its LONGEST-lived entry — a 30-min auth cooldown
    // sharing a key with a 5-min transient one must not expire in five minutes. The
    // pre-existing entries are already inside their own `until`, so taking the max of
    // what we just wrote plus what survived pruning is the correct bound.
    const survivingTtl = Math.max(
      ...Object.values(models).map((r) => Math.ceil((r.until - now) / 1000)),
      maxTtl,
    );
    await backend.writeModels(vendor, models, survivingTtl);
    // The vendor-level decision is per VENDOR, not per attempt: three transient
    // failures on one vendor is one signal, and firing it once per attempt was how a
    // single cascade could trip a vendor bench on its own noise.
    // Auth/capacity trip on a SINGLE strike, so one is enough to decide. Otherwise the
    // transient ring must still see EVERY attempt: three transient failures on one
    // vendor inside the window is the signal that makes the cascade jump upstream, and
    // collapsing a 3-attempt cascade to one timestamp would stop it ever tripping from
    // the case it was written for.
    const decisive = entries.find((e) => e.cls === 'auth' || e.cls === 'capacity');
    if (decisive) {
      await maybeTripVendorCooldown(backend, vendor, decisive.cls, decisive.status);
    } else {
      const transient = entries.filter((e) => e.cls === 'transient');
      if (transient.length > 0) {
        await maybeTripVendorCooldown(backend, vendor, 'transient', transient[0]!.status, transient.length);
      }
    }
  }));
}

/**
 * Vendor-level cooldown decision. Auth failures trip immediately; transient
 * failures accumulate in a 60-second ring buffer and trip when ≥3 distinct
 * model failures land in the same window. Embedded failures do not propagate
 * to vendor cooldown because they're model-specific.
 */
/**
 * Vendor bench time after `strikes` consecutive trips. Same ladder as the per-model
 * one ({@link escalatedTtlSeconds}) and for the same reason: a vendor that trips again
 * while its previous cooldown is still warm is saturated, not blipping. PURE.
 */
export function escalatedVendorTtlSeconds(cls: 'transient' | 'auth' | 'capacity', strikes: number): number {
  const n = Math.max(1, Math.floor(strikes) || 1);
  return Math.min(VENDOR_COOLDOWN_TTL_SEC[cls] * 2 ** (n - 1), COOLDOWN_MAX_TTL_SEC);
}

/** Strike number this trip represents. A vendor still inside its previous cooldown (or
 *  whose record has not yet expired) escalates; one whose record has aged out starts at
 *  1 — the same self-resetting rule as the per-model ladder. */
async function nextVendorStrike(backend: CooldownBackend, vendor: VendorId): Promise<number> {
  const prior = await backend.readVendor(vendor).catch(() => undefined);
  return (prior?.strikes ?? 0) + 1;
}

async function maybeTripVendorCooldown(
  backend: CooldownBackend,
  vendor: VendorId,
  cls: CooldownClass,
  status: number,
  /** How many transient failures this call represents. >1 when a single cascade hit
   *  several models on the same vendor — each one is a distinct data point for the
   *  sliding window, so they all have to land in the ring. */
  transientCount = 1,
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
    const strikes = await nextVendorStrike(backend, vendor);
    const ttl   = escalatedVendorTtlSeconds(cls, strikes);
    const until = Date.now() + ttl * 1000;
    console.warn(
      `[cooldown] vendor ${vendor} cooled for ${ttl}s (strike ${strikes}) — ${cls} failure (status=${status}); cascade will skip this vendor`,
    );
    await backend.writeVendor(vendor, until, ttl, cls, strikes);
    return;
  }

  // Transient — accumulate timestamps and trip when threshold reached.
  const now    = Date.now();
  const cutoff = now - VENDOR_FAILURE_WINDOW_MS;
  const prior  = await backend.readVendorFailures(vendor);
  const ring   = [...prior.filter((t) => t >= cutoff), ...Array.from({ length: Math.max(1, transientCount) }, () => now)];

  if (ring.length >= VENDOR_FAILURE_THRESHOLD) {
    const strikes = await nextVendorStrike(backend, vendor);
    const ttl   = escalatedVendorTtlSeconds('transient', strikes);
    const until = now + ttl * 1000;
    console.warn(
      `[cooldown] vendor ${vendor} cooled for ${ttl}s (strike ${strikes}) — ${ring.length} transient failures in ${VENDOR_FAILURE_WINDOW_MS}ms; cascade will skip this vendor`,
    );
    // Clear the ring once we've tripped — fresh failures after cooldown lifts
    // shouldn't inherit prior timestamps.
    await Promise.all([
      backend.writeVendor(vendor, until, ttl, 'transient', strikes),
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
    const rec = await backend.readVendor(vendor);
    if (rec !== undefined) out.set(vendor, rec.until);
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
