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
 * POST   /api/contributors/activity          Ingest activity events (tenant JWT)
 * GET    /api/contributors/:id/activity      List activity events (MANAGER+)
 * GET    /api/contributors/:id/metrics       Aggregated daily metrics (MANAGER+)
 * POST   /api/contributors/aggregate         Trigger daily metrics recalculation (MANAGER+)
 */

import { Hono } from 'hono';
import { and, asc, between, desc, eq, gte, lte, sum, count, sql } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { optionalTenantId } from '../middleware/tenantContext';
import {
  contributors,
  contributorIdentities,
  activityEvents,
  activityEventTypeEnum,
  contributorDailyMetrics,
  integrationProviderEnum,
} from '../../infrastructure/database/schema';
import { TenantRole } from '../../domain/shared/types';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { contributorMerges, tenantMembers } from '../../infrastructure/database/schema';
import {
  previewMerge,
  mergeContributors,
  unmergeContributors,
  suggestDuplicates,
} from '../../application/contributors/mergeService';
import { aggregateDailyMetrics, ingestActivityEvents } from '../../application/contributors/activityIngest';
import { limitParam } from './queryParams';
import { LIST_ROW_CAP } from '../../domain/shared/boundedInt';
import { parseBody, z, zNonEmptyString, zOptionalString, zPositiveInt } from './requestBody';

// ── Body schemas ─────────────────────────────────────────────────────────────
// Provider and event-type are the SAME pg enums the rows are written with, so a
// value the column would refuse is refused here, by name, as a 400.

const ActivityIngestEvent = z.object({
  externalId: zOptionalString,
  contributorExternalId: zOptionalString,
  authorDisplayName: zOptionalString,
  authorEmail: zOptionalString,
  authorAvatarUrl: zOptionalString,
  eventType: z.enum(activityEventTypeEnum.enumValues),
  repositoryName: zOptionalString,
  repositoryFullName: zOptionalString,
  title: zOptionalString,
  url: zOptionalString,
  linesAdded: z.number().optional(),
  linesRemoved: z.number().optional(),
  filesChanged: z.number().optional(),
  cycleTimeHours: z.number().optional(),
  occurredAt: zNonEmptyString,
});
const ActivityIngestBody = z.object({
  provider: z.enum(integrationProviderEnum.enumValues),
  events: z.array(ActivityIngestEvent).min(1),
});

const MergePairBody = z.object({ sourceId: zPositiveInt, targetId: zPositiveInt });

const ContributorCreateBody = z.object({
  displayName: zNonEmptyString,
  email: zOptionalString,
  avatarUrl: zOptionalString,
  jobTitle: zOptionalString,
  roleType: zOptionalString,
  excludeFromMetrics: z.boolean().optional(),
  userId: zOptionalString,
});

/** PATCH: every column optional; spread straight into `.set()`, so unknown keys
 *  are stripped rather than forwarded. */
const ContributorPatchBody = z.object({
  displayName: zNonEmptyString.optional(),
  email: z.string().nullable().optional(),
  avatarUrl: z.string().nullable().optional(),
  jobTitle: z.string().nullable().optional(),
  roleType: zNonEmptyString.optional(),
  excludeFromMetrics: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

const IdentityBody = z.object({
  provider: z.enum(integrationProviderEnum.enumValues),
  externalId: zNonEmptyString,
  externalEmail: zOptionalString,
  displayName: zOptionalString,
  avatarUrl: zOptionalString,
});

const LinkUserBody = z.object({ userId: z.string().nullable() });

const AggregateBody = z.object({ from: zOptionalString, to: zOptionalString });

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function createContributorRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  // ── Activity ingest (tenant JWT) ───────────────────────────────────────────
  // POST /api/contributors/activity
  // Shares the same producer→store core as the GitHub webhook: unknown authors are
  // auto-created (no orphan events) and each event is attributed to a project via
  // its connected repo. See application/contributors/activityIngest.ts.
  router.post('/activity', async (c) => {
    await authMiddleware(c as unknown as Parameters<typeof authMiddleware>[0], async () => {});
    const tenantId = optionalTenantId(c);
    if (!tenantId) return c.text('Unauthorized', 401);

    const body = await parseBody(c, ActivityIngestBody);

    const result = await ingestActivityEvents(c.env as Env, db, {
      tenantId,
      provider: body.provider,
      events: body.events,
    });

    return c.json(result, 201);
  });

  // All remaining routes require JWT + MANAGER role
  router.use('*', authMiddleware);
  router.use('*', requireRole(TenantRole.MANAGER));

  // ── Consolidation (merge duplicate profiles) ──────────────────────────────
  // Registered before GET /:id so the static paths aren't swallowed by the
  // dynamic id route.

  // GET /api/contributors/duplicates — likely-duplicate groups to consolidate.
  router.get('/duplicates', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const groups = await suggestDuplicates(db, tenantId);
    return c.json({ groups });
  });

  // GET /api/contributors/merges — merge history (audit + undo).
  router.get('/merges', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const rows = await db
      .select({
        id: contributorMerges.id,
        targetContributorId: contributorMerges.targetContributorId,
        sourceContributorId: contributorMerges.sourceContributorId,
        movedActivityCount: contributorMerges.movedActivityCount,
        movedIdentityCount: contributorMerges.movedIdentityCount,
        status: contributorMerges.status,
        mergedByUserId: contributorMerges.mergedByUserId,
        mergedAt: contributorMerges.mergedAt,
        revertedAt: contributorMerges.revertedAt,
      })
      .from(contributorMerges)
      .where(eq(contributorMerges.tenantId, tenantId))
      .orderBy(desc(contributorMerges.mergedAt))
      .limit(100);
    return c.json({ merges: rows });
  });

  // POST /api/contributors/merge/preview — counts + conflicts for a proposed merge.
  router.post('/merge/preview', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const { sourceId, targetId } = await parseBody(c, MergePairBody);
    return c.json(await previewMerge(db, tenantId, sourceId, targetId));
  });

  // POST /api/contributors/merge — consolidate source INTO target (tenant-wide).
  router.post('/merge', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string | undefined;
    const { sourceId, targetId } = await parseBody(c, MergePairBody);
    const result = await mergeContributors(db, c.env as Env, { tenantId, sourceId, targetId, mergedByUserId: userId ?? null });
    return c.json(result, 201);
  });

  // POST /api/contributors/merges/:mergeId/revert — undo a prior merge.
  router.post('/merges/:mergeId/revert', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const mergeId = c.req.param('mergeId');
    // `MergeError` carries `status`; `app.onError` answers it through `statusOf`.
    return c.json(await unmergeContributors(db, c.env as Env, { tenantId, mergeId }));
  });

  // ── GET /api/contributors ─────────────────────────────────────────────────
  router.get('/', async (c) => {
    const tenantId = c.get('tenantId') as number;
    // Hide merged-away (tombstoned) profiles by default; ?includeMerged=true shows them.
    const includeMerged = c.req.query('includeMerged') === 'true';
    const conds = [eq(contributors.tenantId, tenantId)];
    if (!includeMerged) conds.push(sql`${contributors.mergedIntoId} is null`);
    const rows = await db
      .select()
      .from(contributors)
      .where(and(...conds))
      .orderBy(asc(contributors.displayName)).limit(LIST_ROW_CAP);
    return c.json({ contributors: rows });
  });

  // ── POST /api/contributors ────────────────────────────────────────────────
  router.post('/', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const body = await parseBody(c, ContributorCreateBody);

    const [row] = await db
      .insert(contributors)
      .values({
        tenantId,
        displayName:         body.displayName,
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

    const body = await parseBody(c, ContributorPatchBody);

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

    const body = await parseBody(c, IdentityBody);

    const [row] = await db
      .insert(contributorIdentities)
      .values({
        contributorId:  id,
        tenantId,
        provider:       body.provider,
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

  // ── PATCH /api/contributors/:id/link-user ────────────────────────────────
  // Bind (or unbind, userId: null) this contributor to a Builderforce user, so
  // external activity (this profile) and platform/VS Code engagement (that user)
  // attach to one person. Validates the user is a member of the tenant.
  router.patch('/:id/link-user', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = Number(c.req.param('id'));
    const { userId } = await parseBody(c, LinkUserBody);

    const [existing] = await db
      .select({ id: contributors.id })
      .from(contributors)
      .where(and(eq(contributors.id, id), eq(contributors.tenantId, tenantId)));
    if (!existing) return c.json({ error: 'Contributor not found' }, 404);

    if (userId) {
      const [member] = await db
        .select({ userId: tenantMembers.userId })
        .from(tenantMembers)
        .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, userId)));
      if (!member) return c.json({ error: 'User is not a member of this workspace' }, 400);
    }

    const [updated] = await db
      .update(contributors)
      .set({ userId: userId ?? null, updatedAt: new Date() })
      .where(and(eq(contributors.id, id), eq(contributors.tenantId, tenantId)))
      .returning();

    return c.json(updated);
  });

  // ── GET /api/contributors/:id/activity ────────────────────────────────────
  router.get('/:id/activity', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id       = Number(c.req.param('id'));
    const from     = c.req.query('from');
    const to       = c.req.query('to');
    const limit    = limitParam(c.req.query('limit'), 100, 500);

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
    const body = await parseBody(c, AggregateBody);

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
