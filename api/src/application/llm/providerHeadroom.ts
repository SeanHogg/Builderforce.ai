/**
 * ACCOUNT HEADROOM — how much of a tenant's connected account is left, read from the
 * provider's own rate-limit headers, so routing moves off an account BEFORE it runs out.
 *
 * Until now the gateway only learned an account was spent from the refusal itself (a
 * `capacity` alert, `providerAuthAlerts.ts`): the turn that hit the wall paid for the
 * attempt, and a Claude subscription at 98% of its 5-hour window kept leading every
 * coding call until it refused one. Every major provider already says how close it is on
 * every response:
 *   • Anthropic subscription — `anthropic-ratelimit-unified-{5h,7d}-utilization` (0..1),
 *     `anthropic-ratelimit-unified-status` (`rejected` = spent), `-reset` (epoch s);
 *   • ChatGPT/Codex subscription — `x-codex-{primary,secondary}-used-percent` (0..100),
 *     `x-codex-primary-reset-after-seconds`;
 *   • Anthropic API key — `anthropic-ratelimit-{tokens,requests}-{remaining,limit,reset}`;
 *   • OpenAI-compatible (OpenAI, xAI, MiniMax, OpenRouter, …) —
 *     `x-ratelimit-{remaining,limit}-{tokens,requests}`, `x-ratelimit-reset-*` ("6m0s").
 * The last two are mostly PER-MINUTE throughput buckets, not account quota: one large
 * agent turn can drain a TPM bucket by itself, and demoting on that would keep a healthy
 * API-key account off the lead most of the time. A remaining/limit window counts only
 * when it resets at least {@link MIN_QUOTA_WINDOW_MS} away — a daily or monthly cap.
 * The most-used window decides. An account at or past {@link LOW_HEADROOM_USED_FRACTION}
 * is recorded for the tenant until that window resets, and the credential resolver
 * demotes it exactly as it demotes an alerted account — DEMOTE, never remove: it stays in
 * the chain as a fallback, and the record expires when the provider says the window
 * resets.
 *
 * The parser is pure. Only an OWNER-served attempt is recorded: the operator pool's
 * headroom is the shared cooldown store's business, not one tenant's.
 */

import type { Env } from '../../env';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { deferPastResponse } from '../shared/requestScope';

/** Used share of the tightest window at which an account stops leading. */
export const LOW_HEADROOM_USED_FRACTION = 0.9;

/** How long a low-headroom record lives when the provider names no reset. */
const DEFAULT_RECORD_SECONDS = 15 * 60;
/** KV's floor, and a ceiling so a weekly window is re-learned from live headers. */
const MIN_RECORD_SECONDS = 60;
const MAX_RECORD_SECONDS = 6 * 60 * 60;
const READ_TTL_SECONDS = 60;
/** A remaining/limit window resetting sooner than this is throughput, not quota. */
export const MIN_QUOTA_WINDOW_MS = 5 * 60_000;

export interface AccountHeadroom {
  /** Used share (0..1) of the most-used window the provider reported. */
  usedFraction: number;
  /** When that window resets (epoch ms), when the provider said. */
  resetAt: number | null;
}

interface Window { used: number; resetAt: number | null }

const num = (v: string | null): number | null => {
  if (v == null || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** `1.5s`, `6m0s`, `20ms`, `1h2m` — OpenAI's reset durations — to milliseconds. */
export function parseResetDuration(v: string | null): number | null {
  if (!v) return null;
  const s = v.trim();
  const bare = num(s);
  if (bare != null) return bare * 1000;
  let total = 0;
  let matched = false;
  for (const m of s.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) {
    matched = true;
    const n = Number(m[1]);
    total += m[2] === 'h' ? n * 3_600_000 : m[2] === 'm' ? n * 60_000 : m[2] === 's' ? n * 1000 : n;
  }
  return matched ? total : null;
}

/** An RFC 3339 timestamp, epoch seconds or epoch ms — whichever the provider sent. */
function parseResetInstant(v: string | null): number | null {
  const n = num(v);
  if (n != null) return n > 1e12 ? n : n * 1000;
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

const clampShare = (n: number): number => Math.max(0, Math.min(1, n));
/** Each header family states its unit; never guess one from the value. */
const fraction = (v: number | null): number | null => (v == null ? null : clampShare(v));
const percent = (v: number | null): number | null => (v == null ? null : clampShare(v / 100));

function remainingWindow(remaining: number | null, limit: number | null, resetAt: number | null, now: number): Window | null {
  if (remaining == null || limit == null || limit <= 0) return null;
  if (resetAt == null || resetAt - now < MIN_QUOTA_WINDOW_MS) return null;
  return { used: clampShare(1 - remaining / limit), resetAt };
}

/** Every window the response reports. Pure. */
function windowsOf(h: Headers, now: number): Window[] {
  const out: Window[] = [];
  const push = (w: Window | null): void => { if (w) out.push(w); };

  // Anthropic subscription (unified limiter).
  const unifiedReset = parseResetInstant(h.get('anthropic-ratelimit-unified-reset'));
  for (const span of ['5h', '7d']) {
    const used = fraction(num(h.get(`anthropic-ratelimit-unified-${span}-utilization`)));
    if (used != null) push({ used, resetAt: parseResetInstant(h.get(`anthropic-ratelimit-unified-${span}-reset`)) ?? unifiedReset });
  }
  if (h.get('anthropic-ratelimit-unified-status')?.toLowerCase() === 'rejected') push({ used: 1, resetAt: unifiedReset });

  // Anthropic API key, and the OpenAI-compatible family.
  for (const kind of ['tokens', 'requests']) {
    push(remainingWindow(
      num(h.get(`anthropic-ratelimit-${kind}-remaining`)),
      num(h.get(`anthropic-ratelimit-${kind}-limit`)),
      parseResetInstant(h.get(`anthropic-ratelimit-${kind}-reset`)),
      now,
    ));
    const resetIn = parseResetDuration(h.get(`x-ratelimit-reset-${kind}`));
    push(remainingWindow(
      num(h.get(`x-ratelimit-remaining-${kind}`)),
      num(h.get(`x-ratelimit-limit-${kind}`)),
      resetIn != null ? now + resetIn : null,
      now,
    ));
  }

  // ChatGPT / Codex subscription.
  for (const slot of ['primary', 'secondary']) {
    const used = percent(num(h.get(`x-codex-${slot}-used-percent`)));
    const resetIn = num(h.get(`x-codex-${slot}-reset-after-seconds`));
    if (used != null) push({ used, resetAt: resetIn != null ? now + resetIn * 1000 : null });
  }
  return out;
}

/** The account's headroom as this response reports it, or null when it says nothing. Pure. */
export function headroomFromHeaders(headers: Headers, now: number = Date.now()): AccountHeadroom | null {
  const windows = windowsOf(headers, now);
  if (windows.length === 0) return null;
  const tightest = windows.reduce((a, b) => (b.used > a.used ? b : a));
  return { usedFraction: tightest.used, resetAt: tightest.resetAt };
}

/** Whether an account should stop leading. Pure. */
export function isLowHeadroom(h: AccountHeadroom | null | undefined): boolean {
  return !!h && h.usedFraction >= LOW_HEADROOM_USED_FRACTION;
}

/** Seconds a low-headroom record should live: until the window resets, within bounds. */
export function recordSeconds(h: AccountHeadroom, now: number = Date.now()): number {
  const untilReset = h.resetAt != null ? Math.ceil((h.resetAt - now) / 1000) : DEFAULT_RECORD_SECONDS;
  return Math.max(MIN_RECORD_SECONDS, Math.min(MAX_RECORD_SECONDS, untilReset));
}

// ---------------------------------------------------------------------------
// Storage — the same KV namespace, read-through cache and invalidate-on-write the
// account alerts use (`providerAuthAlerts.ts`), keyed per tenant + dispatch vendor.
// ---------------------------------------------------------------------------

type HeadroomEnv = { AUTH_CACHE_KV?: KVNamespace };

const headroomKey = (tenantId: number, vendor: string): string => `byoheadroom:${tenantId}:${vendor}`;

/** Per-isolate fallback for environments without `AUTH_CACHE_KV` (unit tests, local dev). */
const memoryRecords = new Map<string, number>();

/** Test seam. */
export function _resetMemoryHeadroom(): void {
  memoryRecords.clear();
}

/**
 * Record that a tenant's account on `vendor` is nearly spent. Never throws. Written once
 * per window per isolate: while this isolate's own record is live a repeat is a no-op —
 * an account above the line says so on every dispatch, and a write per dispatch would run
 * into KV's one-write-per-second-per-key limit.
 */
export async function recordLowHeadroom(env: HeadroomEnv, tenantId: number, vendor: string, h: AccountHeadroom): Promise<void> {
  const key = headroomKey(tenantId, vendor);
  const held = memoryRecords.get(key);
  if (held && Date.now() < held) return;
  const ttl = recordSeconds(h);
  memoryRecords.set(key, Date.now() + ttl * 1000);
  try {
    await invalidateCached(env as unknown as Env, key);
    if (env.AUTH_CACHE_KV) await env.AUTH_CACHE_KV.put(key, JSON.stringify(h), { expirationTtl: ttl });
  } catch (error) { /* advisory — routing still works without the record */
    reportCaughtError(error, { source: 'application/llm/providerHeadroom.ts', operation: 'recordLowHeadroom' });
  }
}

async function isRecordedLow(env: HeadroomEnv, tenantId: number, vendor: string): Promise<boolean> {
  const key = headroomKey(tenantId, vendor);
  return getOrSetCached<boolean>(env as unknown as Env, key, async () => {
    if (env.AUTH_CACHE_KV) return (await env.AUTH_CACHE_KV.get(key)) != null;
    const until = memoryRecords.get(key);
    if (until && Date.now() < until) return true;
    memoryRecords.delete(key);
    return false;
  }, { kvTtlSeconds: READ_TTL_SECONDS });
}

/**
 * The dispatch vendor ids among `vendorIds` whose account is nearly spent right now.
 * An unreadable record degrades to "has headroom": a missing warning must never demote
 * a working account.
 */
export async function loadLowHeadroomVendors(env: HeadroomEnv, tenantId: number, vendorIds: Iterable<string>): Promise<Set<string>> {
  const vendors = [...new Set(vendorIds)];
  const low = await Promise.all(vendors.map(async (vendor) => {
    try {
      return (await isRecordedLow(env, tenantId, vendor)) ? [vendor] : [];
    } catch (error) {
      reportCaughtError(error, { source: 'application/llm/providerHeadroom.ts', operation: 'loadLowHeadroomVendors' });
      return [];
    }
  }));
  return new Set(low.flat());
}

/**
 * One dispatch's observer. Each OWNER-served attempt's headers are read as they arrive —
 * including an attempt a mid-stream failover makes after the response has gone out — and
 * a nearly-spent account is recorded past the response (`deferPastResponse`), so the
 * write never sits on time-to-first-byte. Returns that write, or null when there is none.
 */
export function createHeadroomObserver(
  env: HeadroomEnv,
  tenantId: number | null,
  isOwnerServedModel: (model: string) => boolean,
): (model: string, vendor: string, headers: Headers) => Promise<void> | null {
  return (model, vendor, headers) => {
    if (tenantId == null || !isOwnerServedModel(model)) return null;
    const h = headroomFromHeaders(headers);
    if (!h || !isLowHeadroom(h)) return null;
    const write = recordLowHeadroom(env, tenantId, vendor, h);
    deferPastResponse(write);
    return write;
  };
}
