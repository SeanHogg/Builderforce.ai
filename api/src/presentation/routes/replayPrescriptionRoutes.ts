/**
 * Insights PRESCRIPTIONS — `/api/replay/*` (PRD 33 §5.1, §8 S4e, `REPLAY_PATHS`).
 *
 *   GET  /prescriptions?site&area&status&f.*            ReplayPrescriptionDto[] (ranked)
 *   POST /prescriptions/sweep?site                      ReplayPrescriptionSweepResultDto   MANAGER, once an hour (429)
 *   GET  /prescriptions/:prescriptionId?site            ReplayPrescriptionDto (verifies on read, throttled)
 *   POST /prescriptions/:prescriptionId/:action?site    ReplayPrescriptionActionResultDto  MANAGER
 *   GET  /releases/:releaseKey/report?site              ReplayReleaseReportDto
 *
 * Same guards as every Insights route (membership, the Insights gate, `?site=` must
 * be the caller's — `replayRouteScope.ts`), attached PER ROUTE because this router
 * shares the `/api/replay` prefix. A presentation adapter only: services, no tables.
 */
import { Hono, type Context } from 'hono';
import { filterFromQuery, REPLAY_PRESCRIPTION_ROUTE_ACTIONS } from '@builderforce/interaction-contract';
import type { HonoEnv } from '../../env';
import { requestDb } from '../../application/shared/dbHandle';
import { TenantRole } from '../../domain/shared/types';
import { getPrescription, listPrescriptions, releaseReport } from '../../application/replay/prescriptionReads';
import { sweepNow } from '../../application/replay/prescriptionSweep';
import { runPrescriptionAction } from '../../application/replay/prescriptionActions';
import { verifyOnRead } from '../../application/replay/prescriptionVerify';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { insightsGate, replayScopeOf } from './replayRouteScope';
import { parseOptionalBody, z } from './requestBody';

const ActionBody = z.object({
  reason: z.string().max(2_000).optional(),
  agentRef: z.string().max(64).nullish(),
  projectId: z.number().int().positive().nullish(),
  sequenceObjectId: z.string().max(64).nullish(),
  contactIds: z.array(z.string().max(64)).max(500).optional(),
  confirm: z.boolean().optional(),
});

const manager = requireRole(TenantRole.MANAGER);
const userOf = (c: Context<HonoEnv>): string | null => (c.get('userId') as string | undefined) ?? null;

export function createReplayPrescriptionRoutes(): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  const db = (c: Context<HonoEnv>) => requestDb(c);

  router.get('/prescriptions', authMiddleware, insightsGate, async (c) => {
    const scope = await replayScopeOf(c);
    return c.json(await listPrescriptions(c.env, db(c), scope, {
      area: c.req.query('area') || null,
      status: c.req.query('status') || null,
      filter: filterFromQuery(new URL(c.req.url).searchParams),
    }));
  });

  router.post('/prescriptions/sweep', authMiddleware, insightsGate, manager, async (c) => {
    const scope = await replayScopeOf(c);
    return c.json(await sweepNow(c.env, db(c), scope));
  });

  router.get('/prescriptions/:prescriptionId', authMiddleware, insightsGate, async (c) => {
    const scope = await replayScopeOf(c);
    const id = c.req.param('prescriptionId');
    await verifyOnRead(c.env, db(c), scope, id);
    return c.json(await getPrescription(c.env, db(c), scope, id));
  });

  router.post('/prescriptions/:prescriptionId/:action', authMiddleware, insightsGate, manager, async (c) => {
    const scope = await replayScopeOf(c);
    const action = c.req.param('action');
    if (!(REPLAY_PRESCRIPTION_ROUTE_ACTIONS as readonly string[]).includes(action)) return c.json({ error: 'Unknown action' }, 404);
    const body = await parseOptionalBody(c, ActionBody);
    return c.json(await runPrescriptionAction(c.env, db(c), scope, c.req.param('prescriptionId'), action, body, { actorId: userOf(c) }));
  });

  router.get('/releases/:releaseKey/report', authMiddleware, insightsGate, async (c) => {
    const scope = await replayScopeOf(c);
    return c.json(await releaseReport(c.env, db(c), scope, c.req.param('releaseKey')));
  });

  return router;
}
