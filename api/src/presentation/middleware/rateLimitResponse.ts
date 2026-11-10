/**
 * The ONE HTTP shape of "you are over a rate limit": `Retry-After` + a 429 JSON body
 * `{ error, resetAt }`. Every limiter in the presentation layer answers through here, so the
 * header name, the status and the body cannot drift between the tenant middleware, the voice
 * routes and translate.
 *
 * {@link slidingWindowLimited} is the common case: count one request against `key` on the
 * platform's ONE sliding-window limiter (`application/ratelimit/slidingWindow`) and answer 429
 * when it is over `limit` per minute, or null to carry on. Fails open when the limiter is not
 * bound, exactly as the limiter does.
 */
import type { Context } from 'hono';
import type { Env, HonoEnv } from '../../env';
import { checkSlidingWindow } from '../../application/ratelimit/slidingWindow';

export const RATE_LIMIT_EXCEEDED_MESSAGE = 'Rate limit exceeded. Please slow down.';

/** Anything that knows when its window empties: a sliding-window verdict or a spent budget. */
export interface RetryWindow {
  retryAfterSeconds: number;
  resetAt: string;
}

/** The 429 for an exhausted window, with `Retry-After` set. */
export function rateLimitedResponse(
  c: Context<HonoEnv>, window: RetryWindow, error: string = RATE_LIMIT_EXCEEDED_MESSAGE,
): Response {
  c.header('Retry-After', String(window.retryAfterSeconds));
  return c.json({ error, resetAt: window.resetAt }, 429);
}

/** Count one request against `key`; a 429 when over `limit` per minute, else null. */
export async function slidingWindowLimited(c: Context<HonoEnv>, key: string, limit: number): Promise<Response | null> {
  const verdict = await checkSlidingWindow(c.env as Env, key, limit);
  if (!verdict || verdict.allowed) return null;
  return rateLimitedResponse(c, verdict);
}
