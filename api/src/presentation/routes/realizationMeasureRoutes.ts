/**
 * The method link's realization grading — `/api/realizations` (PRD 33 §5.3): the
 * reads that grade a proof and the two verdicts a person sets.
 *
 *   GET   /api/realizations/journey-signal  → ProofJourneySignalDto (make | measure | null)
 *   GET   /api/realizations/:id/measure     → ProofEvaluationDto (404 when the proof declares no measure)
 *   POST  /api/realizations/:id/call-early  { reason } → { realization } — a manager grades it now
 *   PATCH /api/realizations/:id/verdict     { verdict: 'abandoned', note? } → { realization } — park it
 *
 * Its own router so `realizationRoutes.ts` is not grown further; mounted BEFORE it,
 * because `/journey-signal` would otherwise be read as `/:id`. Guards are attached
 * per route so this router never wraps a path it does not own. A presentation
 * adapter only: application services, no tables.
 */
import { Hono } from 'hono';
import type { Env, HonoEnv } from '../../env';
import type { DbHandle as Db } from '../../application/shared/dbHandle';
import { abandonRealization, getRealization, toRealizationView } from '../../application/realization/realizationStore';
import { evaluateProofMeasure } from '../../application/realization/proofMeasure';
import { cleanReason, EARLY_CALL_REASON_MAX, syncRealizationVerdict } from '../../application/realization/realizationVerdict';
import { bumpJourneySignal, journeySignal } from '../../application/realization/journeySignal';
import { recordProofOutcome } from '../../application/realization/proofOutcomes';
import { TenantRole } from '../../domain/shared/types';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { parseBody, parseOptionalBody, z } from './requestBody';

const CallEarlyBody = z.object({ reason: z.string().max(EARLY_CALL_REASON_MAX * 2) });
const VerdictBody = z.object({
  verdict: z.unknown().optional(),
  note: z.unknown().optional(),
});

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
   * judgement nobody explained is indistinguishable from impatience. A grade is a
   * manager's call, as on every other verdict that closes work.
   */
  router.post('/:id/call-early', authMiddleware, requireRole(TenantRole.MANAGER), async (c) => {
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

  /**
   * Park it. The one verdict a person sets rather than the console: abandoning
   * is a judgement call with no number to compute, so it does not go through
   * the same rollup as `met`/`missed`.
   */
  router.patch('/:id/verdict', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const body = await parseOptionalBody(c, VerdictBody);
    if (body.verdict !== 'abandoned') {
      return c.json(
        { error: 'Only "abandoned" may be set here — met and missed are recorded from the proof\'s own console.' },
        400,
      );
    }
    const note = typeof body.note === 'string' ? body.note : undefined;
    const updated = await abandonRealization(db, tenantId, c.req.param('id'), note);
    if (!updated) return c.json({ error: 'Realization not found' }, 404);
    // Terminates the grade correlation as FAILED, never validated: parking an
    // idea is a judgement with no number behind it, and counting it as graded
    // would let the north-star metric be satisfied by giving up.
    await recordProofOutcome(db, {
      tenantId,
      userId: (c.get('userId') as string) ?? null,
      projectId: updated.projectId,
      sessionId: updated.sessionId,
      correlationId: `grade:${updated.id}`,
      action: 'proof.grade',
      phase: 'failed',
      realizationId: updated.id,
      targetKey: updated.targetKey,
      metadata: { verdict: 'abandoned' },
    });
    await bumpJourneySignal(c.env as Env, tenantId);
    return c.json({ realization: toRealizationView(updated) });
  });

  return router;
}
