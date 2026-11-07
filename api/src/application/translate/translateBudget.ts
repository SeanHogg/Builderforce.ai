/**
 * Daily character budget for the cloud translation fallback (PRD 42 E4).
 *
 * The per-minute request limit caps burst; this caps SPEND on the free Workers AI quota:
 * a per-tenant budget so one workspace cannot drain it, and a global ceiling so all of
 * them together cannot. Built on THE sliding-window counter (`checkSlidingWindow`) with a
 * 24-hour window and the request's character count as its cost, so there is no second
 * counter or key scheme (unlike the RPM check, this one fails closed). Cache hits are still charged: the budget meters
 * what callers ask for, which is what an abuser controls.
 */
import { checkSlidingWindow, type RateLimitVerdict, type SlidingWindowEnv } from '../ratelimit/slidingWindow';

export const TRANSLATE_TENANT_DAILY_CHARS = 200_000;
export const TRANSLATE_GLOBAL_DAILY_CHARS = 5_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Verdict returned when the limiter is unavailable: the daily budget FAILS CLOSED, because
 *  it guards real spend (the per-minute RPM check, which only caps burst, may fail open). */
function unavailableVerdict(limit: number): RateLimitVerdict {
  return { allowed: false, current: limit, limit, resetAt: new Date(Date.now() + 60_000).toISOString(), retryAfterSeconds: 60 };
}

/** Spend `chars` against the tenant's, then the global, daily budget. Returns the first
 *  refusing verdict, or null when admitted. An unavailable limiter refuses (fail closed). */
export async function spendTranslateBudget(
  env: SlidingWindowEnv,
  tenantId: number,
  chars: number,
): Promise<RateLimitVerdict | null> {
  const tenant = await checkSlidingWindow(env, `translate-chars:t:${tenantId}`, TRANSLATE_TENANT_DAILY_CHARS, DAY_MS, chars);
  if (!tenant) return unavailableVerdict(TRANSLATE_TENANT_DAILY_CHARS);
  if (!tenant.allowed) return tenant;
  const global = await checkSlidingWindow(env, 'translate-chars:global', TRANSLATE_GLOBAL_DAILY_CHARS, DAY_MS, chars);
  if (!global) return unavailableVerdict(TRANSLATE_GLOBAL_DAILY_CHARS);
  return global.allowed ? null : global;
}
