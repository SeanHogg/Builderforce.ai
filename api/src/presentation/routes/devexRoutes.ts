/**
 * DevEx Surveys & Insights — /api/devex/*
 *
 * The pulse-survey framework (templates → campaigns → responses) plus the
 * insights lens that reads it ("AI DevEx Analysis"). Mirrors insightsRoutes.ts
 * (auth + role gates + short-TTL cache) and segmentTrackerRoutes.ts (scope helper).
 *
 *   GET    /insights                 the rollup lens                 [manager, cached]
 *   GET    /templates                list templates                 [developer+]
 *   POST   /templates                create template                [manager]
 *   PATCH  /templates/:id            update template                [manager]
 *   DELETE /templates/:id            delete template                [manager]
 *   GET    /campaigns                list campaigns + response counts[developer+]
 *   POST   /campaigns                launch campaign                 [manager]
 *   PATCH  /campaigns/:id            update / close campaign         [manager]
 *   POST   /campaigns/:id/respond    submit a response               [developer+]
 */

import { Hono } from 'hono';
import { and, eq, sql } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import { scope } from './segmentTrackerRoutes';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { computeDevexInsights } from '../../application/insights/devexInsights';
import {
  devexSurveyTemplates, devexCampaigns, devexResponses,
  normalizeQuestions, validateAnswers, respondentHash,
} from '../../application/devex/devexSurveys';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

const SHORT_TTL = { kvTtlSeconds: 60, l1TtlMs: 15_000 };

/** Clamp a `?days=` window to a sane range (default 90 — surveys are infrequent). */
function parseDays(raw: string | undefined, def = 90): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 && n <= 365 ? Math.floor(n) : def;
}

function parseIntId(raw: string | undefined): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function createDevexRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // ---- Insights lens (manager, cached) ------------------------------------
  router.get('/insights', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId } = scope(c);
    const days = parseDays(c.req.query('days'));
    const env = c.env as Env;
    const key = `devex:insights:t:${tenantId}:d:${days}`;
    return c.json(await getOrSetCached(env, key, () => computeDevexInsights(db, tenantId, days), SHORT_TTL));
  });

  // ---- Templates ----------------------------------------------------------
  router.get('/templates', async (c) => {
    const { tenantId } = scope(c);
    const rows = await db.select().from(devexSurveyTemplates).where(eq(devexSurveyTemplates.tenantId, tenantId));
    return c.json(rows);
  });

  router.post('/templates', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId, segmentId } = scope(c);
    const body = await c.req.json<Record<string, unknown>>();
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return c.json({ error: 'name is required' }, 400);
    const questions = normalizeQuestions(body.questions);
    const [row] = await db.insert(devexSurveyTemplates).values({
      tenantId,
      segmentId: segmentId ?? null,
      name: name.slice(0, 160),
      description: typeof body.description === 'string' ? body.description : '',
      questions,
      isActive: body.isActive === undefined ? true : Boolean(body.isActive),
      createdBy: c.get('userId') ?? null,
    }).returning();
    return c.json(row, 201);
  });

  router.patch('/templates/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId } = scope(c);
    const id = parseIntId(c.req.param('id'));
    if (id == null) return c.json({ error: 'invalid id' }, 400);
    const body = await c.req.json<Record<string, unknown>>();
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim().slice(0, 160);
    if (typeof body.description === 'string') patch.description = body.description;
    if (body.questions !== undefined) patch.questions = normalizeQuestions(body.questions);
    if (body.isActive !== undefined) patch.isActive = Boolean(body.isActive);
    const [row] = await db.update(devexSurveyTemplates).set(patch)
      .where(and(eq(devexSurveyTemplates.id, id), eq(devexSurveyTemplates.tenantId, tenantId)))
      .returning();
    if (!row) return c.json({ error: 'not found' }, 404);
    return c.json(row);
  });

  router.delete('/templates/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId } = scope(c);
    const id = parseIntId(c.req.param('id'));
    if (id == null) return c.json({ error: 'invalid id' }, 400);
    const [row] = await db.delete(devexSurveyTemplates)
      .where(and(eq(devexSurveyTemplates.id, id), eq(devexSurveyTemplates.tenantId, tenantId)))
      .returning();
    if (!row) return c.json({ error: 'not found' }, 404);
    return c.json({ deleted: row.id });
  });

  // ---- Campaigns ----------------------------------------------------------
  router.get('/campaigns', async (c) => {
    const { tenantId } = scope(c);
    // Campaigns + their response counts (LEFT JOIN aggregate).
    const rows = await db
      .select({
        id: devexCampaigns.id,
        tenantId: devexCampaigns.tenantId,
        segmentId: devexCampaigns.segmentId,
        templateId: devexCampaigns.templateId,
        title: devexCampaigns.title,
        periodMonth: devexCampaigns.periodMonth,
        status: devexCampaigns.status,
        anonymous: devexCampaigns.anonymous,
        openedAt: devexCampaigns.openedAt,
        closedAt: devexCampaigns.closedAt,
        createdAt: devexCampaigns.createdAt,
        responseCount: sql<number>`count(${devexResponses.id})::int`,
      })
      .from(devexCampaigns)
      .leftJoin(devexResponses, eq(devexResponses.campaignId, devexCampaigns.id))
      .where(eq(devexCampaigns.tenantId, tenantId))
      .groupBy(devexCampaigns.id);
    return c.json(rows);
  });

  router.post('/campaigns', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId, segmentId } = scope(c);
    const body = await c.req.json<Record<string, unknown>>();
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) return c.json({ error: 'title is required' }, 400);
    const templateId = parseIntId(typeof body.templateId === 'number' ? String(body.templateId) : (body.templateId as string | undefined));
    const periodMonth = typeof body.periodMonth === 'string' && /^\d{4}-\d{2}$/.test(body.periodMonth) ? body.periodMonth : null;
    const [row] = await db.insert(devexCampaigns).values({
      tenantId,
      segmentId: segmentId ?? null,
      templateId: templateId ?? null,
      title: title.slice(0, 200),
      periodMonth,
      status: 'open',
      anonymous: body.anonymous === undefined ? true : Boolean(body.anonymous),
    }).returning();
    return c.json(row, 201);
  });

  router.patch('/campaigns/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId } = scope(c);
    const id = parseIntId(c.req.param('id'));
    if (id == null) return c.json({ error: 'invalid id' }, 400);
    const body = await c.req.json<Record<string, unknown>>();
    const patch: Record<string, unknown> = {};
    if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim().slice(0, 200);
    if (typeof body.periodMonth === 'string' && /^\d{4}-\d{2}$/.test(body.periodMonth)) patch.periodMonth = body.periodMonth;
    if (body.status === 'open' || body.status === 'closed') {
      patch.status = body.status;
      patch.closedAt = body.status === 'closed' ? new Date() : null;
    }
    if (body.anonymous !== undefined) patch.anonymous = Boolean(body.anonymous);
    if (Object.keys(patch).length === 0) return c.json({ error: 'nothing to update' }, 400);
    const [row] = await db.update(devexCampaigns).set(patch)
      .where(and(eq(devexCampaigns.id, id), eq(devexCampaigns.tenantId, tenantId)))
      .returning();
    if (!row) return c.json({ error: 'not found' }, 404);
    return c.json(row);
  });

  // ---- Respond (any authenticated member: developer+) ---------------------
  router.post('/campaigns/:id/respond', requireRole(TenantRole.DEVELOPER), async (c) => {
    const { tenantId } = scope(c);
    const userId = c.get('userId');
    const id = parseIntId(c.req.param('id'));
    if (id == null) return c.json({ error: 'invalid id' }, 400);

    const [campaign] = await db.select().from(devexCampaigns)
      .where(and(eq(devexCampaigns.id, id), eq(devexCampaigns.tenantId, tenantId)))
      .limit(1);
    if (!campaign) return c.json({ error: 'campaign not found' }, 404);
    if (campaign.status !== 'open') return c.json({ error: 'campaign is closed' }, 409);

    // Resolve the campaign's questions (via its template) to validate answers.
    let questions: ReturnType<typeof normalizeQuestions> = [];
    if (campaign.templateId != null) {
      const [tpl] = await db.select({ questions: devexSurveyTemplates.questions })
        .from(devexSurveyTemplates)
        .where(and(eq(devexSurveyTemplates.id, campaign.templateId), eq(devexSurveyTemplates.tenantId, tenantId)))
        .limit(1);
      questions = normalizeQuestions(tpl?.questions ?? []);
    }

    const body = await c.req.json<{ answers?: unknown }>();
    const { clean, errors } = validateAnswers(questions, body.answers);
    if (errors.length) return c.json({ error: 'invalid answers', details: errors }, 400);

    // Anonymous → store a stable respondent_hash, NOT the user id. Identified →
    // store the user id (and no hash). The hash also dedups one submission per
    // respondent per campaign.
    const hash = respondentHash(userId, id);
    const values = campaign.anonymous
      ? { tenantId, campaignId: id, respondentHash: hash, userId: null, answers: clean }
      : { tenantId, campaignId: id, respondentHash: hash, userId, answers: clean };

    // One submission per respondent: if a row with this (campaign, hash) exists,
    // overwrite its answers rather than inserting a duplicate.
    const [existing] = await db.select({ id: devexResponses.id }).from(devexResponses)
      .where(and(eq(devexResponses.campaignId, id), eq(devexResponses.respondentHash, hash)))
      .limit(1);
    if (existing) {
      const [row] = await db.update(devexResponses)
        .set({ answers: clean, userId: values.userId, submittedAt: new Date() })
        .where(eq(devexResponses.id, existing.id))
        .returning();
      return c.json(row);
    }
    const [row] = await db.insert(devexResponses).values(values).returning();
    return c.json(row, 201);
  });

  return router;
}
