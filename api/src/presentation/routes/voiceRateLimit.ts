/**
 * The voice routes' limits on the platform's ONE sliding-window limiter. The 429 itself is
 * the shared presentation helper (`middleware/rateLimitResponse`); `voiceRateLimited` is that
 * helper under the name the voice routes import.
 */
import type { Context } from 'hono';
import type { HonoEnv } from '../../env';
import { slidingWindowLimited } from '../middleware/rateLimitResponse';

/** On-device clip registrations per tenant+user per minute (each one signs and writes a row). */
export const VOICE_REGISTER_RPM = 30;
/** Public provenance lookups per client IP per minute (uncredentialed, so IP is the only subject). */
export const VOICE_VERIFY_RPM = 60;

/** A 429 when `key` is over `limit` per minute, or null to carry on. */
export const voiceRateLimited = slidingWindowLimited;

/** The caller's address as the edge saw it, or 'unknown' (one shared bucket) without one. */
export function clientIp(c: Context<HonoEnv>): string {
  return c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ?? 'unknown';
}
