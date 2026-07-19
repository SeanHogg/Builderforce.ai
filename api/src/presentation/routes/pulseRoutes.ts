/**
 * Internal sentiment / pulse survey — /api/pulse (EMP-15).
 *
 * A manager opens a single-question pulse; any member answers ONCE, anonymously.
 * Aggregate reads (average / distribution / eNPS / trend) are manager-gated and
 * NEVER expose a per-user score; the member-facing endpoints only reveal whether
 * the CURRENT user has already answered.
 *
 *   GET  /active            the open survey + whether I answered   [viewer]
 *   POST /:id/respond       submit my anonymous score              [viewer]
 *   GET  /                  list surveys (manager summary)          [manager]
 *   POST /                  open a new survey                       [manager]
 *   POST /:id/close         close a survey                          [manager]
 *   GET  /trend             cross-survey sentiment trend            [manager]
 *   GET  /:id               one survey's anonymous aggregate        [manager]
 */

import { Hono } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import { scope } from './segmentTrackerRoutes';
import { pulseSurveys, pulseResponses } from '../../infrastructure/database/schema';
import { computePulseAggregate, computePulseTrend } from '../../application/insights/pulseSurvey';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

function userIdOf(c: unknown): string | null {
  return (c as { get(k: string): string | undefined }).get('userId') ?? null;
}

export function createPulseRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // The current open survey for a member to answer + whether they already have.
  router.get('/active', requireRole(TenantRole.VIEWER), async (c) => {
    const { tenantId } = scope(c);
    const [survey] = await db
      .select({ id: pulseSurveys.id, question: pulseSurveys.question, scale: pulseSurveys.scale })
      .from(pulseSurveys)
      .where(and(eq(pulseSurveys.tenantId, tenantId), eq(pulseSurveys.active, true)))
      .orderBy(desc(pulseSurveys.createdAt))
      .limit(1);
    if (!survey) return c.json({ survey: null, hasResponded: false });

    const userId = userIdOf(c);
    let hasResponded = false;
    if (userId) {
      const existing = await db
        .select({ id: pulseResponses.id })
        .from(pulseResponses)
        .where(and(eq(pulseResponses.surveyId, survey.id), eq(pulseResponses.userId, userId)))
        .limit(1);
      hasResponded = existing.length > 0;
    }
    return c.json({ survey, hasResponded });
  });

  // Submit an anonymous response (one per user, enforced by uq_pulse_response_user).
  router.post('/:id/respond', requireRole(TenantRole.VIEWER), async (c) => {
    const { tenantId } = scope(c);
    const surveyId = c.req.param('id');
    const userId = userIdOf(c);

    const [survey] = await db
      .select({ id: pulseSurveys.id, scale: pulseSurveys.scale, active: pulseSurveys.active })
      .from(pulseSurveys)
      .where(and(eq(pulseSurveys.id, surveyId), eq(pulseSurveys.tenantId, tenantId)))
      .limit(1);
    if (!survey) return c.json({ error: 'survey not found' }, 404);
    if (!survey.active) return c.json({ error: 'survey is closed' }, 409);

    type Body = { score?: number; comment?: string };
    const body = await c.req.json<Body>().catch(() => ({} as Body));
    const score = Math.round(Number(body.score));
    if (!Number.isInteger(score) || score < 1 || score > survey.scale) {
      return c.json({ error: `score must be an integer 1..${survey.scale}` }, 400);
    }
    const comment = typeof body.comment === 'string' ? body.comment.trim().slice(0, 2000) : null;

    await db
      .insert(pulseResponses)
      .values({ surveyId, tenantId, userId, score, comment })
      .onConflictDoUpdate({
        target: [pulseResponses.surveyId, pulseResponses.userId],
        set: { score, comment, createdAt: new Date() },
      });
    return c.json({ ok: true }, 201);
  });

  // Manager: list surveys with a lightweight anonymous summary (count + average).
  router.get('/', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId } = scope(c);
    const surveys = await db
      .select({ id: pulseSurveys.id, question: pulseSurveys.question, scale: pulseSurveys.scale, active: pulseSurveys.active, createdAt: pulseSurveys.createdAt, closedAt: pulseSurveys.closedAt })
      .from(pulseSurveys)
      .where(eq(pulseSurveys.tenantId, tenantId))
      .orderBy(desc(pulseSurveys.createdAt))
      .limit(100);
    const withAgg = await Promise.all(surveys.map(async (s) => {
      const agg = await computePulseAggregate(db, tenantId, s.id);
      return {
        id: s.id, question: s.question, scale: s.scale, active: s.active,
        createdAt: new Date(s.createdAt).toISOString(),
        closedAt: s.closedAt ? new Date(s.closedAt).toISOString() : null,
        responseCount: agg?.responseCount ?? 0,
        averageScore: agg?.averageScore ?? null,
        enps: agg?.enps ?? null,
      };
    }));
    return c.json({ surveys: withAgg });
  });

  router.post('/', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId } = scope(c);
    type Body = { question?: string; scale?: number };
    const body = await c.req.json<Body>().catch(() => ({} as Body));
    const question = typeof body.question === 'string' ? body.question.trim().slice(0, 255) : '';
    if (!question) return c.json({ error: 'question is required' }, 400);
    const scale = Number.isInteger(body.scale) && body.scale! >= 2 && body.scale! <= 10 ? body.scale! : 5;
    const [row] = await db
      .insert(pulseSurveys)
      .values({ tenantId, question, scale, active: true, createdBy: userIdOf(c) })
      .returning();
    return c.json(row, 201);
  });

  router.post('/:id/close', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId } = scope(c);
    const id = c.req.param('id');
    const [row] = await db
      .update(pulseSurveys)
      .set({ active: false, closedAt: new Date() })
      .where(and(eq(pulseSurveys.id, id), eq(pulseSurveys.tenantId, tenantId)))
      .returning();
    if (!row) return c.json({ error: 'survey not found' }, 404);
    return c.json(row);
  });

  router.get('/trend', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId } = scope(c);
    return c.json({ trend: await computePulseTrend(db, tenantId) });
  });

  router.get('/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId } = scope(c);
    const agg = await computePulseAggregate(db, tenantId, c.req.param('id'));
    if (!agg) return c.json({ error: 'survey not found' }, 404);
    return c.json(agg);
  });

  return router;
}
