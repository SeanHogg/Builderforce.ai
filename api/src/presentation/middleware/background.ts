import type { Context } from 'hono';
import type { HonoEnv } from '../../env';

/**
 * Run `work` after the response is sent, without failing the request.
 *
 * Every middleware that wants a fire-and-forget write (session `last_seen_at`,
 * telemetry, audit) needs the same three things: swallow rejections so a
 * best-effort write can never 500 a good request, hand the promise to the
 * Worker's `executionCtx` so the isolate stays alive until it settles, and
 * tolerate the absence of an execution context (unit tests and direct handler
 * invocation have none). Written once here rather than re-derived per call site.
 */
export function background(c: Context<HonoEnv>, work: Promise<unknown> | Promise<unknown>[]): void {
  const promise = Array.isArray(work) ? Promise.all(work) : work;
  const swallowed = promise.then(() => undefined).catch(() => undefined);
  try {
    c.executionCtx.waitUntil(swallowed);
  } catch {
    // No execution context available — the promise still runs, it just isn't
    // kept alive past the response. Correct for tests and local invocation.
  }
}
