/**
 * PRD 23 backlog disposition — `/api/admin/backlog-dispositions` (superadmin only).
 *
 *   GET  /?tenantId=&projectId=   -> the dry-run report: counts by disposition, pending vs
 *                                    applied, tickets with no disposition yet, and the rows
 *   POST /run                     body { tenantId, projectId? }
 *                                 -> recompute the pending proposals now (still a dry run)
 *   POST /apply                   body { tenantId, taskIds?, dispositions?, confirm: true }
 *                                 -> act on the pending proposals (close / consolidate /
 *                                    quarantine). The ONLY route that mutates tickets; the
 *                                    operator triggers it explicitly, the cron never does.
 *
 * A presentation adapter over `application/manager/backlogDisposition*`.
 */
import { Hono } from 'hono';
import type { HonoEnv } from '../../env';
import type { DbHandle } from '../../application/shared/dbHandle';
import {
  applyDispositions, getDispositionReport, runBacklogDispositionPass,
} from '../../application/manager/backlogDispositionPass';
import { superAdminMiddleware } from '../middleware/superAdminMiddleware';
import { parseBody, z } from './requestBody';
import { positiveIntParam } from './queryParams';

const KINDS = z.enum(['keep', 'close', 'consolidate', 'quarantine']);

const RunBody = z.object({
  tenantId: z.number().int().positive(),
  projectId: z.number().int().positive().optional(),
});

const ApplyBody = z.object({
  tenantId: z.number().int().positive(),
  taskIds: z.array(z.number().int().positive()).max(1000).optional(),
  dispositions: z.array(KINDS).optional(),
  // Applying cancels / blocks real tickets: it must be asked for in so many words.
  confirm: z.literal(true),
});

export function createBacklogDispositionRoutes(db: DbHandle): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', superAdminMiddleware);

  router.get('/', async (c) => {
    const tenantId = positiveIntParam(c.req.query('tenantId'));
    if (!tenantId) return c.json({ error: 'tenantId is required' }, 400);
    const projectId = positiveIntParam(c.req.query('projectId')) ?? undefined;
    return c.json(await getDispositionReport(db, { tenantId, projectId }));
  });

  router.post('/run', async (c) => {
    const body = await parseBody(c, RunBody);
    const result = await runBacklogDispositionPass(db, { tenantId: body.tenantId, projectId: body.projectId }, `superadmin:${c.get('userId') as string}`);
    return c.json(result);
  });

  router.post('/apply', async (c) => {
    const body = await parseBody(c, ApplyBody);
    const result = await applyDispositions(db, {
      tenantId: body.tenantId, actor: `superadmin:${c.get('userId') as string}`,
      taskIds: body.taskIds, dispositions: body.dispositions,
    });
    return c.json(result);
  });

  return router;
}
