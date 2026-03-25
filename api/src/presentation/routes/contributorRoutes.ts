/**
 * Contributor routes – /api/contributors
 *
 * Unified contributor profiles with cross-platform identity reconciliation and
 * activity-based productivity metrics.
 *
 * GET    /api/contributors                    List contributors (MANAGER+)
 * POST   /api/contributors                    Create contributor (MANAGER+)
 * GET    /api/contributors/:id                Contributor detail + metrics (MANAGER+)
 * PATCH  /api/contributors/:id               Update contributor (MANAGER+)
 * DELETE /api/contributors/:id               Delete contributor (MANAGER+)
 * POST   /api/contributors/:id/identities    Add platform identity (MANAGER+)
 * DELETE /api/contributors/:id/identities/:identityId (MANAGER+)
 *
 * POST   /api/contributors/activity          Ingest activity events (claw API key OR JWT)
 * GET    /api/contributors/:id/activity      List activity events (MANAGER+)
 * GET    /api/contributors/:id/metrics       Aggregated daily metrics (MANAGER+)
 * POST   /api/contributors/aggregate         Trigger daily metrics recalculation (MANAGER+)
 */

import { Hono } from 'hono';
import { and, asc, between, desc, eq, gte, lte, sum, count, sql } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import {
  contributors,
  contributorIdentities,
  activityEvents,
  contributorDailyMetrics,
} from '../../infrastructure/database/schema';
import { TenantRole } from '../../domain/shared/types';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

// ---------------------------------------------------------------------------
// Metrics aggregation helper
// ---------------------------------------------------------------------------

async function aggregateDailyMetrics(
  db: Db,
  tenantId: number,
  contributorId: number,
  date: Date,
): Promise<void> {
  const dayStart = new Date(date);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

  const events = await db
    .select()
    .from(activityEvents)
    .where(and(
      eq(activityEvents.tenantId, tenantId),
      eq(activityEvents.contributorId, contributorId),
      gte(activityEvents.occurredAt, dayStart),
      lte(activityEvents.occurredAt, dayEnd),
    ));

  const m = {
    commits:        events.filter((e) => e.eventType === 'commit').length,
    prsOpened:      events.filter((e) => e.eventType === 'pr_opened').length,
    prsMerged:      events.filter((e) => e.eventType === 'pr_merged').length,
    prsReviewed:    events.filter((e) => e.eventType === 'pr_reviewed').length,
    issuesCreated:  events.filter((e) => e.eventType === 'issue_created').length,
    issuesResolved: events.filter((e) => e.eventType === 'issue_resolved').length,
    linesAdded:     events.reduce((s, e) => s + (e.linesAdded ?? 0), 0),
    linesRemoved:   events.reduce((s, e) => s + (e.linesRemoved ?? 0), 0),
    filesChanged:   events.reduce((s, e) => s + (e.filesChanged ?? 0), 0),
  };

  // Weighted activity score: commits×1 + PRs×3 + reviews×2 + issues×1.5
  const activityScore = Math.round(
    m.commits * 1 +
    (m.prsOpened + m.prsMerged) * 3 +
    m.prsReviewed * 2 +
    (m.issuesCreated + m.issuesResolved) * 1.5,
  );
  const isActiveDay = m.commits > 0 || m.prsOpened > 0 || m.prsMerged > 0;

  await db
    .insert(contributorDailyMetrics)
    .values({
      tenantId,
      contributorId,
      date: dayStart,
      ...m,
      activityScore,
      isActiveDay,
    })
    .onConflictDoUpdate({
      target: [contributorDailyMetrics.tenantId, contributorDailyMetrics.contributorId, contributorDailyMetrics.date],
      set: { ...m, activityScore, isActiveDay, updatedAt: new Date() },
    });
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function createContributorRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  // ── Activity ingest (no JWT — accepts claw API key via query params) ──────
  // POST /api/contributors/activity
  router.post('/activity', async (c) => {
    // Accept tenant JWT for this endpoint
    await authMiddleware(c as unknown as Parameters<typeof authMiddleware>[0], async () => {});
    const tenantId = (c as unknown as { get: (k: string) => unknown }).get('tenantId') as number | undefined;
    if (!tenantId) return c.text('Unauthorized', 401);

    const body = await c.req.json<{
      provider: string;
      events: Array<{
        externalId?: string;
        contributorExternalId?: string;
        eventType: string;
        repositoryName?: string;
        repositoryFullName?: string;
        title?: string;
        url?: string;
        linesAdded?: number;
        linesRemoved?: number;
        filesChanged?: number;
        cycleTimeHours?: number;
        occurredAt: string;
      }>;
    }>();

    if (!body.provider || !Array.isArray(body.events) || body.events.length === 0) {
      return c.json({ error: 'provider and events[] are required' }, 400);
    }

    const inserted: number[] = [];
    const skipped: string[] = [];
    const now = new Date();

    for (const ev of body.events) {
      // Resolve contributorId from external identity
      let contributorId: number | null = null;
      if (ev.contributorExternalId) {
        const [identity] = await db
          .select({ contributorId: contributorIdentities.contributorId })
          .from(contributorIdentities)
          .where(and(
            eq(contributorIdentities.tenantId, tenantId),
            eq(contributorIdentities.provider, body.provider as 'github'),
            eq(contributorIdentities.externalId, ev.contributorExternalId),
          ));
        contributorId = identity?.contributorId ?? null;
      }

      try {
        const [row] = await db
          .insert(activityEvents)
          .values({
            tenantId,
            contributorId,
            provider:           body.provider as 'github',
            eventType:          ev.eventType as 'commit',
            externalId:         ev.externalId ?? null,
            repositoryName:     ev.repositoryName ?? null,
            repositoryFullName: ev.repositoryFullName ?? null,
            title:              ev.title ?? null,
            url:                ev.url ?? null,
            linesAdded:         ev.linesAdded ?? null,
            linesRemoved:       ev.linesRemoved ?? null,
            filesChanged:       ev.filesChanged ?? null,
            cycleTimeHours:     ev.cycleTimeHours ?? null,
            occurredAt:         new Date(ev.occurredAt),
            createdAt:          now,
          })
          .onConflictDoNothing()
          .returning({ id: activityEvents.id });

        if (row) {
          inserted.push(row.id);
          // Trigger incremental daily metrics update
          if (contributorId) {
            aggregateDailyMetrics(db, tenantId, contributorId, new Date(ev.occurredAt)).catch(() => {});
          }
        } else {
          skipped.push(ev.externalId ?? 'unknown');
        }
      } catch {
        skipped.push(ev.externalId ?? 'unknown');
      }
    }

    return c.json({ inserted: inserted.length, skipped: skipped.length }, 201);
  });

  // All remaining routes require JWT + MANAGER role
  router.use('*', authMiddleware);
  router.use('*', requireRole(TenantRole.MANAGER));

  // ── GET /api/contributors ─────────────────────────────────────────────────
  router.get('/', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const rows = await db
      .select()
      .from(contributors)
      .where(eq(contributors.tenantId, tenantId))
      .orderBy(asc(contributors.displayName));
    return c.json({ contributors: rows });
  });

  // ── POST /api/contributors ────────────────────────────────────────────────
  router.post('/', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const body = await c.req.json<{
      displayName: string;
      email?: string;
      avatarUrl?: string;
      jobTitle?: string;
      roleType?: string;
      excludeFromMetrics?: boolean;
      userId?: string;
    }>();

    if (!body.displayName?.trim()) {
      return c.json({ error: 'displayName is required' }, 400);
    }

    const [row] = await db
      .insert(contributors)
      .values({
        tenantId,
        displayName:         body.displayName.trim(),
        email:               body.email ?? null,
        avatarUrl:           body.avatarUrl ?? null,
        jobTitle:            body.jobTitle ?? null,
        roleType:            body.roleType ?? 'developer',
        excludeFromMetrics:  body.excludeFromMetrics ?? false,
        userId:              body.userId ?? null,
      })
      .returning();

    return c.json(row, 201);
  });

  // ── GET /api/contributors/:id ─────────────────────────────────────────────
  router.get('/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = Number(c.req.param('id'));

    const [contributor] = await db
      .select()
      .from(contributors)
      .where(and(eq(contributors.id, id), eq(contributors.tenantId, tenantId)));
    if (!contributor) return c.json({ error: 'Contributor not found' }, 404);

    const identities = await db
      .select()
      .from(contributorIdentities)
      .where(and(eq(contributorIdentities.contributorId, id), eq(contributorIdentities.tenantId, tenantId)));

    return c.json({ ...contributor, identities });
  });

  // ── PATCH /api/contributors/:id ───────────────────────────────────────────
  router.patch('/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = Number(c.req.param('id'));

    const [existing] = await db
      .select({ id: contributors.id })
      .from(contributors)
      .where(and(eq(contributors.id, id), eq(contributors.tenantId, tenantId)));
    if (!existing) return c.json({ error: 'Contributor not found' }, 404);

    const body = await c.req.json<Partial<{
      displayName: string; email: string | null; avatarUrl: string | null;
      jobTitle: string | null; roleType: string; excludeFromMetrics: boolean;
      isActive: boolean;
    }>>();

    const [updated] = await db
      .update(contributors)
      .set({ ...body, updatedAt: new Date() })
      .where(and(eq(contributors.id, id), eq(contributors.tenantId, tenantId)))
      .returning();

    return c.json(updated);
  });

  // ── DELETE /api/contributors/:id ──────────────────────────────────────────
  router.delete('/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = Number(c.req.param('id'));

    const [existing] = await db
      .select({ id: contributors.id })
      .from(contributors)
      .where(and(eq(contributors.id, id), eq(contributors.tenantId, tenantId)));
    if (!existing) return c.json({ error: 'Contributor not found' }, 404);

    await db.delete(contributors)
      .where(and(eq(contributors.id, id), eq(contributors.tenantId, tenantId)));

    return c.json({ deleted: true });
  });

  // ── POST /api/contributors/:id/identities ─────────────────────────────────
  router.post('/:id/identities', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = Number(c.req.param('id'));

    const [existing] = await db
      .select({ id: contributors.id })
      .from(contributors)
      .where(and(eq(contributors.id, id), eq(contributors.tenantId, tenantId)));
    if (!existing) return c.json({ error: 'Contributor not found' }, 404);

    const body = await c.req.json<{
      provider: string;
      externalId: string;
      externalEmail?: string;
      displayName?: string;
      avatarUrl?: string;
    }>();

    if (!body.provider || !body.externalId) {
      return c.json({ error: 'provider and externalId are required' }, 400);
    }

    const [row] = await db
      .insert(contributorIdentities)
      .values({
        contributorId:  id,
        tenantId,
        provider:       body.provider as 'github',
        externalId:     body.externalId,
        externalEmail:  body.externalEmail ?? null,
        displayName:    body.displayName ?? null,
        avatarUrl:      body.avatarUrl ?? null,
      })
      .onConflictDoNothing()
      .returning();

    return c.json(row ?? { error: 'Identity already exists' }, row ? 201 : 409);
  });

  // ── DELETE /api/contributors/:id/identities/:identityId ──────────────────
  router.delete('/:id/identities/:identityId', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id       = Number(c.req.param('id'));
    const iid      = Number(c.req.param('identityId'));

    await db.delete(contributorIdentities)
      .where(and(
        eq(contributorIdentities.id, iid),
        eq(contributorIdentities.contributorId, id),
        eq(contributorIdentities.tenantId, tenantId),
      ));

    return c.json({ deleted: true });
  });

  // ── GET /api/contributors/:id/activity ────────────────────────────────────
  router.get('/:id/activity', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id       = Number(c.req.param('id'));
    const from     = c.req.query('from');
    const to       = c.req.query('to');
    const limit    = Math.min(Number(c.req.query('limit') ?? '100'), 500);

    const conditions = [
      eq(activityEvents.tenantId, tenantId),
      eq(activityEvents.contributorId, id),
    ];
    if (from) conditions.push(gte(activityEvents.occurredAt, new Date(from)));
    if (to)   conditions.push(lte(activityEvents.occurredAt, new Date(to)));

    const events = await db
      .select()
      .from(activityEvents)
      .where(and(...conditions))
      .orderBy(desc(activityEvents.occurredAt))
      .limit(limit);

    return c.json({ events, total: events.length });
  });

  // ── GET /api/contributors/:id/metrics ─────────────────────────────────────
  router.get('/:id/metrics', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id       = Number(c.req.param('id'));
    const from     = c.req.query('from') ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const to       = c.req.query('to')   ?? new Date().toISOString();

    const rows = await db
      .select()
      .from(contributorDailyMetrics)
      .where(and(
        eq(contributorDailyMetrics.tenantId, tenantId),
        eq(contributorDailyMetrics.contributorId, id),
        gte(contributorDailyMetrics.date, new Date(from)),
        lte(contributorDailyMetrics.date, new Date(to)),
      ))
      .orderBy(asc(contributorDailyMetrics.date));

    // Compute summary
    const summary = {
      totalCommits:       rows.reduce((s, r) => s + r.commits, 0),
      totalPrsOpened:     rows.reduce((s, r) => s + r.prsOpened, 0),
      totalPrsMerged:     rows.reduce((s, r) => s + r.prsMerged, 0),
      totalPrsReviewed:   rows.reduce((s, r) => s + r.prsReviewed, 0),
      totalLinesAdded:    rows.reduce((s, r) => s + r.linesAdded, 0),
      totalLinesRemoved:  rows.reduce((s, r) => s + r.linesRemoved, 0),
      activeDays:         rows.filter((r) => r.isActiveDay).length,
      totalDays:          rows.length,
      avgActivityScore:   rows.length > 0
        ? Math.round(rows.reduce((s, r) => s + r.activityScore, 0) / rows.length)
        : 0,
    };

    return c.json({ summary, dailyMetrics: rows });
  });

  // ── POST /api/contributors/aggregate ─────────────────────────────────────
  // Recalculate daily metrics for all contributors in a date range.
  router.post('/aggregate', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const body = await c.req.json<{ from?: string; to?: string }>();

    const fromDate = body.from ? new Date(body.from) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const toDate   = body.to   ? new Date(body.to)   : new Date();

    const allContributors = await db
      .select({ id: contributors.id })
      .from(contributors)
      .where(and(eq(contributors.tenantId, tenantId), eq(contributors.isActive, true)));

    let processed = 0;
    for (const contributor of allContributors) {
      const d = new Date(fromDate);
      while (d <= toDate) {
        await aggregateDailyMetrics(db, tenantId, contributor.id, new Date(d));
        d.setUTCDate(d.getUTCDate() + 1);
        processed++;
      }
    }

    return c.json({ processed, contributors: allContributors.length });
  });

  return router;
}
