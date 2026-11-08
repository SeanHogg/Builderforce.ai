/**
 * Abuse limits on steering a run (`POST /executions/:id/messages`, PRD 09 S3).
 *
 * A steer is persisted, broadcast to every stream subscriber, relayed to a host and
 * folded into a PRD revision — so an unbounded body or an unthrottled loop is a cheap
 * way to bloat a run's thread and its model context. Two limits, both defined here:
 *   - {@link STEER_MAX_TEXT_CHARS}: one steer's text length (413 beyond it);
 *   - {@link STEER_RATE_LIMIT_PER_MINUTE}: steers per EXECUTION per minute (429), via
 *     the platform sliding-window counter, which fails open when its binding is absent.
 */
import { checkSlidingWindow, type SlidingWindowEnv } from '../ratelimit/slidingWindow';

export const STEER_MAX_TEXT_CHARS = 8_000;
export const STEER_RATE_LIMIT_PER_MINUTE = 20;
const STEER_WINDOW_MS = 60_000;

export function steerTextTooLong(text: string): boolean {
  return text.length > STEER_MAX_TEXT_CHARS;
}

/** Spends one steer from the execution's bucket. Returns the Retry-After seconds when
 *  the bucket is full, or null to proceed (including when the limiter is unavailable). */
export async function steerRateLimited(env: SlidingWindowEnv, executionId: number): Promise<number | null> {
  try {
    const verdict = await checkSlidingWindow(env, `steer:${executionId}`, STEER_RATE_LIMIT_PER_MINUTE, STEER_WINDOW_MS);
    return verdict && !verdict.allowed ? verdict.retryAfterSeconds : null;
  } catch {
    return null; // fail open: the limiter caps abuse, it is not a second point of failure
  }
}
