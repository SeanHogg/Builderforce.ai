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

// In-memory fallback (per-isolate). Mirrors the legacy behavior when no KV
// binding is present — never written when KV is bound to avoid drift.
const memCooldowns = new Map<string, number>();

/**
 * Bulk-fetch cooldown state for a list of (vendor, model) pairs. Returns the
 * subset currently on cooldown so the dispatcher can filter the chain in
 * a single call (vs. a roundtrip per candidate).
 */
export async function loadCooldowns(
  env: CooldownEnv,
  candidates: ReadonlyArray<{ vendor: VendorId; model: string }>,
): Promise<Set<string>> {
  const cooled = new Set<string>();
  const kv = env.AUTH_CACHE_KV;

  if (!kv) {
    const now = Date.now();
    for (const { vendor, model } of candidates) {
      const k = cacheKey(vendor, model);
      const until = memCooldowns.get(k);
      if (until && now < until) cooled.add(`${vendor}/${model}`);
      else if (until) memCooldowns.delete(k);
    }
    return cooled;
  }

  // KV path — parallel reads.
  await Promise.all(candidates.map(async ({ vendor, model }) => {
    const v = await kv.get(cacheKey(vendor, model)).catch(() => null);
    if (v != null) cooled.add(`${vendor}/${model}`);
  }));
  return cooled;
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

  // Always emit a structured log line so ops can grep for stuck vendors.
  console.warn(
    `[cooldown] ${vendor}/${model} cooled for ${ttl}s — class=${cls} status=${status}` +
    (hint ? ` hint="${hint.slice(0, 120)}"` : ''),
  );

  const kv = env.AUTH_CACHE_KV;
  if (!kv) {
    memCooldowns.set(cacheKey(vendor, model), Date.now() + ttl * 1000);
    return;
  }

  await kv.put(
    cacheKey(vendor, model),
    JSON.stringify({ cls, status, at: Date.now() }),
    { expirationTtl: ttl },
  ).catch((err) => {
    // KV write failures shouldn't break dispatch — log and move on.
    console.warn(`[cooldown] kv.put failed for ${vendor}/${model}: ${err}`);
  });
}

/** Test-only: clear the in-memory map. */
export function _resetMemoryCooldowns(): void { memCooldowns.clear(); }
