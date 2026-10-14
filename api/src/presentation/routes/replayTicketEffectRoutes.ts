/**
 * The effect of a ticket raised from a replay moment — `/api/replay` (PRD 33 §5.3.4).
 *
 *   GET /ticket-effect/:taskId   → ReplayTicketEffectDto | { effect: null }
 *
 * A workspace member who can read the ticket (`authMiddleware`; the task is looked up
 * inside the caller's workspace and the moment's site must be the workspace's), in a
 * workspace holding Insights (`insightsGate`, which also refuses superadmin
 * emulation — the effect is read from recordings). The gate's proof-site clause
 * reads `?site=`, so a client that knows the ticket's site may pass it; the chip
 * answers a 403 by showing nothing. Guards are per route because the `/api/replay`
 * prefix is shared. A presentation adapter only.
 */
import { Hono } from 'hono';
import type { Env, HonoEnv } from '../../env';
import { requestDb } from '../../application/shared/dbHandle';
import { effectFor } from '../../application/replay/ticketEffect';
import { ValidationError } from '../../domain/shared/errors';
import { authMiddleware } from '../middleware/authMiddleware';
import { insightsGate } from './replayRouteScope';
import { positiveIntParam } from './queryParams';

export function createReplayTicketEffectRoutes(): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.get('/ticket-effect/:taskId', authMiddleware, insightsGate, async (c) => {
    const taskId = positiveIntParam(c.req.param('taskId'));
    if (!taskId) throw new ValidationError('taskId must be a positive integer');
    const effect = await effectFor(c.env as Env, requestDb(c), { tenantId: c.get('tenantId') as number, taskId });
    return c.json(effect ?? { effect: null });
  });
  return router;
}
