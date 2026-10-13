/**
 * The method link's realization reads — `/api/realizations` (PRD 33 §5.3).
 *
 *   GET  /api/realizations/journey-signal   → ProofJourneySignalDto (make | measure | null)
 *   GET  /api/realizations/:id/measure      → ProofEvaluationDto (404 when the proof declares no measure)
 *   POST /api/realizations/:id/call-early   { reason } → { realization } — a person grades it now
 *
 * Its own router so `realizationRoutes.ts` is not grown further; mounted BEFORE it,
 * because `/journey-signal` would otherwise be read as `/:id`. Guards are attached
 * per route so this router never wraps a path it does not own. A presentation
 * adapter only: application services, no tables.
 */
import { Hono } from 'hono';
import type { Env, HonoEnv } from '../../env';
import type { DbHandle as Db } from '../../application/shared/dbHandle';
import { getRealization, toRealizationView } from '../../application/realization/realizationStore';
import { evaluateProofMeasure } from '../../application/realization/proofMeasure';
import { cleanReason, EARLY_CALL_REASON_MAX, syncRealizationVerdict } from '../../application/realization/realizationVerdict';
import { journeySignal } from '../../application/realization/journeySignal';
import { authMiddleware } from '../middleware/authMiddleware';
import { parseBody, z } from './requestBody';

const CallEarlyBody = z.object({ reason: z.string().max(EARLY_CALL_REASON_MAX * 2) });

export function createRealizationMeasureRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.get('/journey-signal', authMiddleware, async (c) => {
    return c.json(await journeySignal(c.env as Env, db, c.get('tenantId') as number));
  });

  router.get('/:id/measure', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const row = await getRealization(db, tenantId, c.req.param('id'));
    if (!row) return c.json({ error: 'Realization not found' }, 404);
    const evaluation = await evaluateProofMeasure(c.env as Env, db, row);
    if (!evaluation) return c.json({ error: 'This proof is not graded by visitor behaviour' }, 404);
    return c.json(evaluation);
  });

  /**
   * Call it before the sample is in. The reason is REQUIRED and written onto the
   * record beside the measured numbers — an early call is a judgement, and a
   * judgement nobody explained is indistinguishable from impatience.
   */
  router.post('/:id/call-early', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const body = await parseBody(c, CallEarlyBody);
    const reason = cleanReason(body.reason);
    if (!reason) return c.json({ error: 'An early call needs a written reason' }, 400);
    const row = await getRealization(db, tenantId, c.req.param('id'));
    if (!row) return c.json({ error: 'Realization not found' }, 404);
    if (!row.measure) return c.json({ error: 'This proof is graded by its console, not by its visitors' }, 409);
    if (row.verdict === 'abandoned') return c.json({ error: 'This idea was parked; a parked proof is not graded' }, 409);
    const synced = await syncRealizationVerdict(c.env as Env, db, tenantId, row, { earlyCallReason: reason });
    return c.json({ realization: toRealizationView(synced) });
  });

  return router;
}
