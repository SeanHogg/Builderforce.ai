/**
 * requestScope — the (tenantId, segmentId) a signed-in request is scoped to, read from the context
 * the auth middleware filled. The ONE reader every segment-scoped route uses; it lived inside
 * segmentTrackerRoutes.ts, so routes that only needed the scope imported the tracker factory module.
 */
import type { Context } from 'hono';
import type { HonoEnv } from '../../env';

/**
 * The request's ExecutionContext, or undefined when the runtime supplied none. Hono THROWS on
 * `c.executionCtx` in that case; a caller that only uses it to defer best-effort work
 * (`waitUntil`) must degrade to "await inline", never to a 500.
 */
export function optionalExecutionCtx(c: Context<HonoEnv>): ExecutionContext | undefined {
  try {
    return c.executionCtx;
  } catch {
    // Not an error: the runtime simply has no execution context (a test, a non-Worker host).
    return undefined;
  }
}

/** The (tenantId, segmentId) scope every segment-scoped query filters by. */
export function scope(c: Context<HonoEnv>): { tenantId: number; segmentId: string } {
  return { tenantId: c.get('tenantId'), segmentId: c.get('segmentId') as string };
}
