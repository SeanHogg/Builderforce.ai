/**
 * `POST /api/collections/:entity/bulk` (PRD 47 §3.3) — ONE request carries the
 * whole bulk action (ids + action), whatever the count. This is the fix for the
 * F6 429: a bulk Delete / Archive / Merge of 500 records costs one request in
 * the tenant's rate bucket, not 500.
 *
 *   POST /api/collections/:entity/bulk
 *     { action: 'delete'|'archive'|'restore'|'merge', ids: string[1..1000],
 *       targetId?: string, dryRun?: boolean }
 *     → BulkResult { action, succeeded[], skipped[{id, reason}], preview? }
 *
 * The body carries NO tenant id (D2): the authenticated JWT tenant the route's
 * auth middleware established is the one `runBulkAction` acts for, and any id
 * outside it comes back as `skipped: not_found`. `Idempotency-Key` replays the
 * first 2xx verbatim for a day (reusing `middleware/idempotentReplay`).
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { BULK_MAX, type BulkAction } from '@builderforce/interaction-contract';
import type { HonoEnv } from '../../env';
import { parseBody } from './requestBody';
import { RequestValidationError } from '../../domain/shared/errors';
import { runBulkAction } from '../../application/collections/runBulkAction';
import { idempotentReplay } from '../middleware/idempotentReplay';

/** The bulk body. `merge` must keep the target: the port receives the REST of ids as sources. */
export const BulkBody: z.ZodType<{ action: BulkAction; ids: string[]; targetId?: string; dryRun?: boolean }> = z.object({
  action: z.enum(['delete', 'archive', 'restore', 'merge']),
  ids: z.array(z.string().min(1).max(64)).min(1).max(BULK_MAX),
  targetId: z.string().min(1).max(64).optional(),
  dryRun: z.boolean().optional(),
}).superRefine((body, ctx) => {
  if (body.action !== 'merge') return;
  if (!body.targetId) {
    ctx.addIssue({ code: 'custom', path: ['targetId'], message: "bulk 'merge' requires a targetId" });
  } else if (!body.ids.includes(body.targetId)) {
    ctx.addIssue({ code: 'custom', path: ['targetId'], message: "bulk 'merge' targetId must be one of ids" });
  }
});

export function createCollectionBulkRoutes(): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  // Replay-after-write safety for the offline clients that batch these: the
  // first 2xx is stored per (tenant, key); a retried POST with the same key
  // gets the stored response, never a second run of the handler.
  router.use('*', idempotentReplay({ bindBody: true }));

  router.post('/:entity/bulk', async (c) => {
    const entity = c.req.param('entity');
    let body: z.infer<typeof BulkBody>;
    try {
      body = await parseBody(c, BulkBody);
    } catch (error) {
      // Only a refused body is answered here (with which field failed); anything
      // else is a real fault and goes to the global handler.
      if (!(error instanceof RequestValidationError)) throw error;
      return c.json({
        error: 'Invalid bulk request: action + ids[1..1000] (+ targetId for merge) required',
        code: 'bulk_request_invalid',
        issues: error.issues,
      }, 400);
    }
    const result = await runBulkAction(c, { entity, ...body });
    return c.json(result);
  });

  return router;
}
