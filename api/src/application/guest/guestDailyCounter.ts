/**
 * UTC-day KV counters — the shared primitive behind every anonymous allowance.
 *
 * Guest limits are all the same shape: a key, a number, and a reset at UTC midnight.
 * `GuestChatService` owned a private copy of that logic for its per-IP message
 * backstop; guest RESEARCH needs the identical mechanic for its own per-visitor and
 * per-IP call caps. One implementation, so a fix to the rollover (or the TTL, or the
 * never-fail-the-request posture) lands everywhere at once.
 *
 * Deliberately KV-only and best-effort: these are ABUSE backstops, not billing. A KV
 * outage degrades to "not counted", never to a refused request — the durable,
 * authoritative allowance is the per-visitor row in `marketing_sessions`.
 */

import { reportCaughtError } from '../observability/caughtErrorReporter';
import type { Env } from '../../env';

/** UTC day key `YYYYMMDD` — the day component of every counter key. */
export function utcDayKey(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

/** Seconds until the next UTC midnight — a counter's TTL, so it expires rather than
 *  needing a sweep. Floored at a minute so a key written at 23:59:59 still lands. */
export function secondsUntilUtcMidnight(): number {
  const next = new Date();
  next.setUTCHours(24, 0, 0, 0);
  return Math.max(60, Math.ceil((next.getTime() - Date.now()) / 1000));
}

/** Namespace a counter to its purpose, subject and UTC day. */
export function dailyCounterKey(scope: string, subject: string): string {
  return `${scope}:${utcDayKey()}:${subject}`;
}

/** Today's value for a counter key (0 when KV is unbound, unset, or unreadable). */
export async function readDailyCounter(env: Env, key: string): Promise<number> {
  const kv = env?.AUTH_CACHE_KV;
  if (!kv) return 0;
  const raw = await kv.get(key).catch(() => null);
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) ? n : 0;
}

/** Verdict of a per-call allowance check. The visitor axis is the one worth
 * showing a human; the IP axis is the spoof backstop behind it. */
export interface GuestAllowance {
  allowed: boolean;
  /** Calls left today on the VISITOR axis. */
  remaining: number;
  limit: number;
  reason?: 'visitor' | 'ip';
}

export interface GuestAllowanceLimits {
  visitorDailyLimit: number;
  ipDailyLimit: number;
}

/**
 * Charge one call against an anonymous allowance, or refuse it.
 *
 * Check-and-consume in ONE step: these surfaces are single requests with no
 * streaming continuation to reconcile, so there is no turn to be idempotent
 * about — and charging before the work means an abandoned request still counts,
 * which is the posture an abuse ceiling needs. (The CHAT cap is deliberately
 * different: it splits check from consume because a turn fans out into appended
 * tool continuations that must not each be billed.)
 *
 * `scope` namespaces the two counters, so every guest capability gets its own
 * ceiling rather than competing for one: a visitor who has spent their research
 * lookups can still download the document they already made.
 */
export async function consumeGuestAllowance(
  env: Env,
  scope: string,
  visitorId: string,
  ip: string | null,
  limits: GuestAllowanceLimits,
): Promise<GuestAllowance> {
  const limit = limits.visitorDailyLimit;
  const used = await readDailyCounter(env, dailyCounterKey(`${scope}:v`, visitorId));
  if (used >= limit) return { allowed: false, remaining: 0, limit, reason: 'visitor' };

  if (ip) {
    const ipUsed = await readDailyCounter(env, dailyCounterKey(`${scope}:ip`, ip));
    if (ipUsed >= limits.ipDailyLimit) {
      return { allowed: false, remaining: Math.max(limit - used, 0), limit, reason: 'ip' };
    }
  }

  const next = await bumpDailyCounter(env, dailyCounterKey(`${scope}:v`, visitorId));
  if (ip) await bumpDailyCounter(env, dailyCounterKey(`${scope}:ip`, ip));
  // With no KV bound the counters are inert (they return 0); report the allowance
  // as untouched rather than pretending to have charged it.
  return { allowed: true, remaining: Math.max(limit - (next || used + 1), 0), limit };
}

/** Increment a counter and return its new value. Never throws. */
export async function bumpDailyCounter(env: Env, key: string, by = 1): Promise<number> {
  const kv = env?.AUTH_CACHE_KV;
  if (!kv) return 0;
  const next = (await readDailyCounter(env, key)) + by;
  await kv
    .put(key, String(next), { expirationTtl: secondsUntilUtcMidnight() })
    .catch((error) => {
      reportCaughtError(error, { source: 'application/guest/guestDailyCounter.ts', operation: 'bumpDailyCounter' });
    });
  return next;
}
