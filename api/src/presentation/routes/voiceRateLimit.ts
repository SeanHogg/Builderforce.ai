/**
 * The voice routes' use of the platform's ONE sliding-window limiter
 * (`application/ratelimit/slidingWindow`): a 429 response when `key` is over `limit`
 * per minute, or null to carry on. Fails open when the limiter is not bound.
 */
import type { Context } from 'hono';
import type { Env, HonoEnv } from '../../env';
import { checkSlidingWindow } from '../../application/ratelimit/slidingWindow';

/** On-device clip registrations per tenant+user per minute (each one signs and writes a row). */
export const VOICE_REGISTER_RPM = 30;
/** Public provenance lookups per client IP per minute (uncredentialed, so IP is the only subject). */
export const VOICE_VERIFY_RPM = 60;

export async function voiceRateLimited(c: Context<HonoEnv>, key: string, limit: number): Promise<Response | null> {
  const verdict = await checkSlidingWindow(c.env as Env, key, limit);
  if (!verdict || verdict.allowed) return null;
  c.header('Retry-After', String(verdict.retryAfterSeconds));
  return c.json({ error: 'Rate limit exceeded. Please slow down.', resetAt: verdict.resetAt }, 429);
}

/** The caller's address as the edge saw it, or 'unknown' (one shared bucket) without one. */
export function clientIp(c: Context<HonoEnv>): string {
  return c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ?? 'unknown';
}
