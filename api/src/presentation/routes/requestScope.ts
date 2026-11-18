/**
 * requestScope — the (tenantId, segmentId) a signed-in request is scoped to, read from the context
 * the auth middleware filled. The ONE reader every segment-scoped route uses; it lived inside
 * segmentTrackerRoutes.ts, so routes that only needed the scope imported the tracker factory module.
 */
import type { Context } from 'hono';
import type { HonoEnv } from '../../env';

/** The (tenantId, segmentId) scope every segment-scoped query filters by. */
export function scope(c: Context<HonoEnv>): { tenantId: number; segmentId: string } {
  return { tenantId: c.get('tenantId'), segmentId: c.get('segmentId') as string };
}
