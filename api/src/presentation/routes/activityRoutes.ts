/**
 * Activity + timecard routes.
 *
 *   /api/activity/*   — capture the audited "click sense" + engagement signal
 *                       stream (portal + VSIX) and the "what did you do today" view.
 *   /api/timecards/*  — resolve signals into billable timecard_entries, roll them into
 *                       an approvable timecard, and run submit → approve/reject.
 *
 * Worker-facing endpoints use the WEB JWT (a freelancer may have no tenant);
 * employer approval uses the TENANT JWT.
 *
 * Data access is Drizzle only (`buildDatabase(c.env)` per handler). Client-visible
 * rows are selected with explicit snake_case aliases so the `mapCard`/`mapEntry`/
 * `mapInvoice` shapes are byte-identical to the raw-SQL implementation they replace.
 */
import { Hono } from 'hono';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { webAuthMiddleware } from '../middleware/webAuthMiddleware';
import { resolveActiveMinutes, type ResolvableSignal } from '../../application/activity/resolveTime';
import { notify } from '../../application/notifications/notify';
import { isPayoutsConfigured, createPayout } from '../../application/integrations/payments';
import { getActivityLog } from '../../application/activity/activityLog';
import { invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { freelancerStatsCacheKey } from './freelancerRoutes';
import { TenantRole } from '../../domain/shared/types';
import { buildDatabase, type Db } from '../../infrastructure/database/connection';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import {
  activitySignals,
  freelancerEngagements,
  freelancerInvoices,
  tenants,
  timecardEntries,
  timecards,
  users,
} from '../../infrastructure/database/schema';
import type { Env, HonoEnv } from '../../env';

const SIGNAL_SOURCES = ['portal', 'vscode', 'agent', 'meeting', 'system'] as const;
const MAX_BATCH = 100;

/** Shared batch-ingest — used by BOTH the web-JWT portal route and the tenant-JWT
 *  VSIX route so the two capture surfaces stay identical (DRY). Attributes each
 *  signal to an active engagement when one resolves; otherwise stores it for audit.
 *  `defaultTenantId` (VSIX: from the tenant token) backfills a signal's tenantId. */
async function ingestSignals(
  db: Db,
  userId: string,
  list: unknown[],
  defaultSource: string,
  defaultTenantId: number | null,
): Promise<number> {
  const engRows = await db
    .select({
      id: freelancerEngagements.id,
      tenantId: freelancerEngagements.tenantId,
      projectId: freelancerEngagements.projectId,
    })
    .from(freelancerEngagements)
    .where(and(
      eq(freelancerEngagements.freelancerUserId, userId),
      isNull(freelancerEngagements.terminatedAt),
    ));
  const resolveEngagement = (tenantId: number | null, projectId: number | null): string | null => {
    if (tenantId == null) return null;
    const forTenant = engRows.filter((e) => Number(e.tenantId) === Number(tenantId));
    const byProject = forTenant.find((e) => e.projectId != null && Number(e.projectId) === Number(projectId));
    return (byProject ?? forTenant[0])?.id ?? null;
  };
  let ingested = 0;
  for (const raw of list) {
    const s = raw as Record<string, unknown>;
    const source = SIGNAL_SOURCES.includes(s.source as never) ? (s.source as string) : defaultSource;
    const kind = typeof s.kind === 'string' ? s.kind.slice(0, 40) : null;
    if (!kind) continue;
    const tenantId = typeof s.tenantId === 'number' ? s.tenantId : defaultTenantId;
    const projectId = typeof s.projectId === 'number' ? s.projectId : null;
    const engagementId = typeof s.engagementId === 'string' ? s.engagementId : resolveEngagement(tenantId, projectId);
    const ref = typeof s.ref === 'string' ? s.ref.slice(0, 300) : null;
    const weight = typeof s.weight === 'number' ? Math.max(1, Math.round(s.weight)) : 1;
    const duration = typeof s.durationSeconds === 'number' ? Math.max(0, Math.round(s.durationSeconds)) : null;
    const sessionId = typeof s.sessionId === 'string' ? s.sessionId.slice(0, 64) : null;
    const occurredAt = typeof s.occurredAt === 'string' ? s.occurredAt : new Date().toISOString();
    const metadata = s.metadata != null ? JSON.stringify(s.metadata).slice(0, 4000) : null;
    // `activity_signals.id` is a DB bigserial the schema models as a plain bigint PK
    // (no Drizzle default), so it is omitted here and the sequence supplies it.
    await db.insert(activitySignals).values({
      userId,
      tenantId,
      engagementId,
      projectId,
      source,
      kind,
      ref,
      weight,
      durationSeconds: duration,
      metadata,
      sessionId,
      occurredAt: new Date(occurredAt),
    } as typeof activitySignals.$inferInsert);
    ingested++;
  }
  return ingested;
}

/** Recompute a timecard's totals from its entries and persist them. Shared by the
 *  signal resolver AND the manual-entry mutations so the rollup is computed in ONE
 *  place (DRY). amount = billable hours × the card's snapshot rate. */
async function recomputeTimecard(
  db: Db,
  cardId: string,
): Promise<{ totalMinutes: number; billableMinutes: number; amountCents: number }> {
  const [sums] = await db
    .select({
      total: sql<number>`COALESCE(SUM(${timecardEntries.minutes}),0)::int`,
      billable: sql<number>`COALESCE(SUM(${timecardEntries.minutes}) FILTER (WHERE ${timecardEntries.billable}),0)::int`,
    })
    .from(timecardEntries)
    .where(eq(timecardEntries.timecardId, cardId));
  const [card] = await db
    .select({ rateCents: timecards.rateCents })
    .from(timecards)
    .where(eq(timecards.id, cardId));
  const total = Number(sums?.total ?? 0);
  const billable = Number(sums?.billable ?? 0);
  const rate = Number(card?.rateCents ?? 0);
  const amount = Math.round((billable / 60) * rate);
  await db
    .update(timecards)
    .set({ totalMinutes: total, billableMinutes: billable, amountCents: amount, updatedAt: sql`NOW()` })
    .where(eq(timecards.id, cardId));
  return { totalMinutes: total, billableMinutes: billable, amountCents: amount };
}

export function createActivityRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  // ── GET /log — the unified activity / audit timeline (MANAGER+, tenant JWT) ──
  // "Who did what, to what, when" across the whole workforce — team members,
  // external talent / hires, and AI agents — from the canonical activity_log.
  // Version-token cached; keyset-paginated via `beforeId`.
  router.get('/log', authMiddleware, requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const q = c.req.query.bind(c.req);
    const num = (v: string | undefined) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);
    const page = await getActivityLog(c.env as Env, db, tenantId, {
      actorType: q('actorType') || undefined,
      actorRef: q('actorRef') || undefined,
      targetType: q('targetType') || undefined,
      targetId: q('targetId') || undefined,
      verb: q('verb') || undefined,
      projectId: num(q('projectId')),
      beforeId: num(q('beforeId')),
      limit: num(q('limit')),
    });
    return c.json(page);
  });

  // POST /signals — batch-ingest for the signed-in worker (WEB JWT; the portal).
  router.post('/signals', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const body = await c.req.json<{ signals?: unknown[] }>();
    const list = Array.isArray(body.signals) ? body.signals.slice(0, MAX_BATCH) : [];
    if (list.length === 0) return c.json({ ok: true, ingested: 0 });
    const ingested = await ingestSignals(buildDatabase(c.env), userId, list, 'portal', null);
    return c.json({ ok: true, ingested });
  });

  // POST /ingest — batch-ingest from the VSIX (TENANT JWT). Same pipeline; source
  // defaults to 'vscode' and the tenant token backfills tenantId for attribution.
  router.post('/ingest', authMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const tenantId = c.get('tenantId') as number;
    const body = await c.req.json<{ signals?: unknown[] }>();
    const list = Array.isArray(body.signals) ? body.signals.slice(0, MAX_BATCH) : [];
    if (list.length === 0) return c.json({ ok: true, ingested: 0 });
    const ingested = await ingestSignals(buildDatabase(c.env), userId, list, 'vscode', tenantId);
    return c.json({ ok: true, ingested });
  });

  // POST /meeting — log a meeting as PAID time (it's the worker's time). Emits a
  // single 'meeting' span signal whose full duration the resolver credits. Worker
  // (web JWT); attributed to the given engagement.
  router.post('/meeting', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const b = await c.req.json<{ engagementId?: string; occurredAt?: string; durationMinutes?: number; note?: string }>();
    if (!b.engagementId || !b.durationMinutes || b.durationMinutes <= 0) return c.json({ error: 'engagementId and durationMinutes required' }, 400);
    const ingested = await ingestSignals(buildDatabase(c.env), userId, [{
      source: 'meeting', kind: 'meeting', engagementId: b.engagementId,
      durationSeconds: Math.round(b.durationMinutes * 60),
      occurredAt: b.occurredAt, ref: 'meeting', metadata: b.note ? { note: b.note } : undefined,
    }], 'meeting', null);
    return c.json({ ok: true, ingested });
  });

  // GET /today — "what did you do today": signal counts by kind + a resolved
  // active-minutes estimate for the signed-in worker (today, UTC).
  router.get('/today', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const rows = await buildDatabase(c.env)
      .select({
        id: activitySignals.id,
        occurredAt: activitySignals.occurredAt,
        durationSeconds: activitySignals.durationSeconds,
        weight: activitySignals.weight,
        kind: activitySignals.kind,
        source: activitySignals.source,
        engagementId: activitySignals.engagementId,
      })
      .from(activitySignals)
      .where(and(
        eq(activitySignals.userId, userId),
        sql`${activitySignals.occurredAt} >= date_trunc('day', now())`,
      ))
      .orderBy(asc(activitySignals.occurredAt))
      .limit(2000);
    const byKind: Record<string, number> = {};
    for (const r of rows) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
    const resolved = resolveActiveMinutes(rows.map((r): ResolvableSignal => ({ id: r.id, occurredAt: r.occurredAt, durationSeconds: r.durationSeconds, weight: r.weight, kind: r.kind })));
    return c.json({ signalCount: rows.length, minutes: resolved.minutes, byKind });
  });

  return router;
}

/** Client-visible timecard columns, aliased to the snake_case keys `mapCard` reads.
 *  `submitted_at`/`approved_at` go through `sql` so the driver's raw timestamp
 *  STRING is preserved (a plain column reference would decode to a JS Date and
 *  change the JSON the portal receives). `period_start`/`period_end` are already
 *  string-mode `date` columns. */
const cardColumns = {
  id: timecards.id,
  engagement_id: timecards.engagementId,
  tenant_id: timecards.tenantId,
  period_start: timecards.periodStart,
  period_end: timecards.periodEnd,
  status: timecards.status,
  total_minutes: timecards.totalMinutes,
  billable_minutes: timecards.billableMinutes,
  rate_cents: timecards.rateCents,
  currency: timecards.currency,
  amount_cents: timecards.amountCents,
  submitted_at: sql<string | null>`${timecards.submittedAt}`,
  approved_at: sql<string | null>`${timecards.approvedAt}`,
} as const;

/** Client-visible timecard-entry columns, aliased for `mapEntry`. */
const entryColumns = {
  id: timecardEntries.id,
  work_date: timecardEntries.workDate,
  minutes: timecardEntries.minutes,
  source: timecardEntries.source,
  billable: timecardEntries.billable,
  description: timecardEntries.description,
} as const;

/** Client-visible invoice columns, aliased for `mapInvoice`. */
const invoiceColumns = {
  id: freelancerInvoices.id,
  timecard_id: freelancerInvoices.timecardId,
  engagement_id: freelancerInvoices.engagementId,
  tenant_id: freelancerInvoices.tenantId,
  amount_cents: freelancerInvoices.amountCents,
  currency: freelancerInvoices.currency,
  status: freelancerInvoices.status,
  external_ref: freelancerInvoices.externalRef,
  issued_at: sql<string | null>`${freelancerInvoices.issuedAt}`,
  paid_at: sql<string | null>`${freelancerInvoices.paidAt}`,
} as const;

export function createTimecardRoutes(): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  const mapCard = (r: Record<string, unknown>) => ({
    id: r.id,
    engagementId: r.engagement_id,
    tenantId: Number(r.tenant_id),
    tenantName: r.tenant_name ?? null,
    freelancerName: r.freelancer_name ?? null,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    status: r.status,
    totalMinutes: Number(r.total_minutes ?? 0),
    billableMinutes: Number(r.billable_minutes ?? 0),
    rateCents: r.rate_cents == null ? null : Number(r.rate_cents),
    currency: r.currency ?? 'USD',
    amountCents: Number(r.amount_cents ?? 0),
    submittedAt: r.submitted_at ?? null,
    approvedAt: r.approved_at ?? null,
  });

  // POST /resolve — resolve an engagement's signals over [periodStart, periodEnd]
  // into per-day timecard_entries and a DRAFT timecard. Worker-triggered (web JWT);
  // idempotent per (engagement, period). Only the engaged worker may resolve.
  router.post('/resolve', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const b = await c.req.json<{ engagementId?: string; periodStart?: string; periodEnd?: string }>();
    if (!b.engagementId || !b.periodStart || !b.periodEnd) return c.json({ error: 'engagementId, periodStart, periodEnd required' }, 400);
    const engagementId = b.engagementId;
    const periodStart = b.periodStart;
    const periodEnd = b.periodEnd;
    const db = buildDatabase(c.env);
    const [eng] = await db
      .select({
        id: freelancerEngagements.id,
        tenantId: freelancerEngagements.tenantId,
        freelancerUserId: freelancerEngagements.freelancerUserId,
        rateCents: freelancerEngagements.rateCents,
        currency: freelancerEngagements.currency,
      })
      .from(freelancerEngagements)
      .where(and(
        eq(freelancerEngagements.id, engagementId),
        eq(freelancerEngagements.freelancerUserId, userId),
      ));
    if (!eng) return c.json({ error: 'Engagement not found' }, 404);

    const signals = await db
      .select({
        id: activitySignals.id,
        occurredAt: activitySignals.occurredAt,
        durationSeconds: activitySignals.durationSeconds,
        weight: activitySignals.weight,
        kind: activitySignals.kind,
        day: sql<string>`to_char(${activitySignals.occurredAt}, 'YYYY-MM-DD')`,
      })
      .from(activitySignals)
      .where(and(
        eq(activitySignals.engagementId, engagementId),
        sql`${activitySignals.occurredAt} >= ${periodStart}`,
        sql`${activitySignals.occurredAt} < (${periodEnd}::date + 1)`,
      ))
      .orderBy(asc(activitySignals.occurredAt))
      .limit(20000);

    // Group by day and resolve.
    const byDay = new Map<string, typeof signals>();
    for (const s of signals) {
      const arr = byDay.get(s.day) ?? [];
      arr.push(s); byDay.set(s.day, arr);
    }
    // Upsert the draft timecard first so entries can reference it.
    const cardId = crypto.randomUUID();
    const [card] = await db
      .insert(timecards)
      .values({
        id: cardId,
        engagementId,
        userId,
        tenantId: eng.tenantId,
        periodStart,
        periodEnd,
        rateCents: eng.rateCents,
        currency: eng.currency ?? 'USD',
        status: 'draft',
      })
      .onConflictDoUpdate({
        target: [timecards.engagementId, timecards.periodStart, timecards.periodEnd],
        set: { updatedAt: sql`NOW()` },
      })
      .returning({ id: timecards.id, status: timecards.status });
    if (!card) return c.json({ error: 'Failed to create timecard' }, 500);
    if (card.status !== 'draft') return c.json({ error: 'Timecard for this period is already submitted' }, 409);
    const realCardId = card.id;

    // Replace auto entries for this card (idempotent re-resolve).
    await db.delete(timecardEntries).where(and(
      eq(timecardEntries.timecardId, realCardId),
      eq(timecardEntries.source, 'auto'),
    ));
    for (const [day, daySignals] of byDay) {
      const resolved = resolveActiveMinutes(daySignals.map((s): ResolvableSignal => ({ id: s.id, occurredAt: s.occurredAt, durationSeconds: s.durationSeconds, weight: s.weight, kind: s.kind })));
      if (resolved.minutes <= 0) continue;
      await db.insert(timecardEntries).values({
        id: crypto.randomUUID(),
        engagementId,
        userId,
        tenantId: eng.tenantId,
        workDate: day,
        minutes: resolved.minutes,
        source: 'auto',
        billable: true,
        resolvedFrom: JSON.stringify(resolved),
        timecardId: realCardId,
      });
    }
    // Recompute totals over auto + any manual entries already in the period.
    const totals = await recomputeTimecard(db, realCardId);
    return c.json({ id: realCardId, ...totals });
  });

  // GET /mine — worker's timecards (web JWT).
  router.get('/mine', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const rows = await buildDatabase(c.env)
      .select({ ...cardColumns, tenant_name: tenants.name })
      .from(timecards)
      .innerJoin(tenants, eq(tenants.id, timecards.tenantId))
      .where(eq(timecards.userId, userId))
      .orderBy(desc(timecards.periodStart))
      .limit(200);
    return c.json(rows.map(mapCard));
  });

  // GET / — employer's timecards for approval (tenant JWT).
  router.get('/', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const rows = await buildDatabase(c.env)
      .select({ ...cardColumns, freelancer_name: users.displayName })
      .from(timecards)
      .innerJoin(users, eq(users.id, timecards.userId))
      .where(scopedToTenant(timecards, tenantId))
      .orderBy(desc(timecards.periodStart))
      .limit(500);
    return c.json(rows.map(mapCard));
  });

  const mapEntry = (r: Record<string, unknown>) => ({
    id: r.id, workDate: r.work_date, minutes: Number(r.minutes), source: r.source,
    billable: Boolean(r.billable), description: r.description ?? null,
  });

  // GET /:id/entries — the worker's own timecard line items (web JWT).
  router.get('/:id/entries', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const id = c.req.param('id');
    const rows = await buildDatabase(c.env)
      .select(entryColumns)
      .from(timecardEntries)
      .innerJoin(timecards, eq(timecards.id, timecardEntries.timecardId))
      .where(and(eq(timecardEntries.timecardId, id), eq(timecards.userId, userId)))
      .orderBy(asc(timecardEntries.workDate));
    return c.json(rows.map(mapEntry));
  });

  // GET /:id/review — employer approval view: the card + its line items, scoped to
  // the employer's tenant (tenant JWT).
  router.get('/:id/review', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const db = buildDatabase(c.env);
    const [cardRow] = await db
      .select({ ...cardColumns, freelancer_name: users.displayName })
      .from(timecards)
      .innerJoin(users, eq(users.id, timecards.userId))
      .where(scopedToTenant(timecards, tenantId, eq(timecards.id, id)));
    if (!cardRow) return c.json({ error: 'Not found' }, 404);
    const rows = await db
      .select(entryColumns)
      .from(timecardEntries)
      .where(eq(timecardEntries.timecardId, id))
      .orderBy(asc(timecardEntries.workDate));
    return c.json({ card: mapCard(cardRow), entries: rows.map(mapEntry) });
  });

  // POST /:id/entries — worker adds a MANUAL line item to a DRAFT timecard.
  router.post('/:id/entries', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const id = c.req.param('id');
    const b = await c.req.json<{ workDate?: string; minutes?: number; description?: string; billable?: boolean }>();
    const db = buildDatabase(c.env);
    const [card] = await db
      .select({ id: timecards.id, engagementId: timecards.engagementId, tenantId: timecards.tenantId })
      .from(timecards)
      .where(and(eq(timecards.id, id), eq(timecards.userId, userId), eq(timecards.status, 'draft')));
    if (!card) return c.json({ error: 'Not found or not draft' }, 404);
    const minutes = typeof b.minutes === 'number' ? Math.max(0, Math.round(b.minutes)) : 0;
    const workDate = typeof b.workDate === 'string' ? b.workDate.slice(0, 10) : new Date().toISOString().slice(0, 10);
    await db.insert(timecardEntries).values({
      id: crypto.randomUUID(),
      engagementId: card.engagementId,
      userId,
      tenantId: card.tenantId,
      workDate,
      minutes,
      source: 'manual',
      billable: b.billable !== false,
      description: b.description ?? null,
      timecardId: id,
    });
    const totals = await recomputeTimecard(db, id);
    return c.json({ ok: true, ...totals }, 201);
  });

  // PATCH /:id/entries/:entryId — worker edits a line item on a DRAFT timecard
  // (adjust minutes, toggle billable, or annotate).
  router.patch('/:id/entries/:entryId', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const id = c.req.param('id');
    const entryId = c.req.param('entryId');
    const b = await c.req.json<{ minutes?: number; billable?: boolean; description?: string }>();
    const db = buildDatabase(c.env);
    const [card] = await db
      .select({ id: timecards.id })
      .from(timecards)
      .where(and(eq(timecards.id, id), eq(timecards.userId, userId), eq(timecards.status, 'draft')));
    if (!card) return c.json({ error: 'Not found or not draft' }, 404);
    const minutes = typeof b.minutes === 'number' ? Math.max(0, Math.round(b.minutes)) : null;
    const rows = await db
      .update(timecardEntries)
      .set({
        minutes: sql`COALESCE(${minutes}, ${timecardEntries.minutes})`,
        billable: sql`COALESCE(${typeof b.billable === 'boolean' ? b.billable : null}, ${timecardEntries.billable})`,
        description: sql`COALESCE(${b.description ?? null}, ${timecardEntries.description})`,
        updatedAt: sql`NOW()`,
      })
      .where(and(eq(timecardEntries.id, entryId), eq(timecardEntries.timecardId, id)))
      .returning({ id: timecardEntries.id });
    if (rows.length === 0) return c.json({ error: 'Entry not found' }, 404);
    const totals = await recomputeTimecard(db, id);
    return c.json({ ok: true, ...totals });
  });

  // DELETE /:id/entries/:entryId — worker removes a line item from a DRAFT timecard.
  router.delete('/:id/entries/:entryId', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const id = c.req.param('id');
    const entryId = c.req.param('entryId');
    const db = buildDatabase(c.env);
    const [card] = await db
      .select({ id: timecards.id })
      .from(timecards)
      .where(and(eq(timecards.id, id), eq(timecards.userId, userId), eq(timecards.status, 'draft')));
    if (!card) return c.json({ error: 'Not found or not draft' }, 404);
    await db.delete(timecardEntries).where(and(
      eq(timecardEntries.id, entryId),
      eq(timecardEntries.timecardId, id),
    ));
    const totals = await recomputeTimecard(db, id);
    return c.json({ ok: true, ...totals });
  });

  // POST /:id/submit — worker submits a draft timecard for approval (notifies the
  // employer who owns the engagement).
  router.post('/:id/submit', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const id = c.req.param('id');
    const db = buildDatabase(c.env);
    const rows = await db
      .update(timecards)
      .set({ status: 'submitted', submittedAt: sql`NOW()`, updatedAt: sql`NOW()` })
      .where(and(eq(timecards.id, id), eq(timecards.userId, userId), eq(timecards.status, 'draft')))
      .returning({
        id: timecards.id,
        tenantId: timecards.tenantId,
        engagementId: timecards.engagementId,
        billableMinutes: timecards.billableMinutes,
      });
    const card = rows[0];
    if (!card) return c.json({ error: 'Not found or not draft' }, 404);
    const [eng] = await db
      .select({ createdByUserId: freelancerEngagements.createdByUserId })
      .from(freelancerEngagements)
      .where(eq(freelancerEngagements.id, card.engagementId));
    const [me] = await db.select({ displayName: users.displayName }).from(users).where(eq(users.id, userId));
    if (eng?.createdByUserId) {
      await notify(db, c.env, { userId: eng.createdByUserId, tenantId: Number(card.tenantId), kind: 'timecard_submitted', title: `${me?.displayName ?? 'A freelancer'} submitted a timecard`, ref: id });
    }
    return c.json({ ok: true, status: 'submitted' });
  });

  // POST /:id/approve — employer approves a submitted timecard (tenant JWT). This
  // ISSUES an invoice (pending) for the billable amount and notifies the worker.
  router.post('/:id/approve', authMiddleware, requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const actor = c.get('userId') as string;
    const id = c.req.param('id');
    const db = buildDatabase(c.env);
    const rows = await db
      .update(timecards)
      .set({ status: 'approved', approvedAt: sql`NOW()`, approvedByUserId: actor, updatedAt: sql`NOW()` })
      .where(scopedToTenant(timecards, tenantId, eq(timecards.id, id), eq(timecards.status, 'submitted')))
      .returning({
        id: timecards.id,
        engagementId: timecards.engagementId,
        userId: timecards.userId,
        amountCents: timecards.amountCents,
        currency: timecards.currency,
      });
    const card = rows[0];
    if (!card) return c.json({ error: 'Not found or not submitted' }, 404);
    // Issue an invoice (idempotent per timecard).
    await db
      .insert(freelancerInvoices)
      .values({
        id: crypto.randomUUID(),
        timecardId: id,
        engagementId: card.engagementId,
        tenantId,
        freelancerUserId: card.userId,
        amountCents: card.amountCents,
        currency: card.currency ?? 'USD',
        status: 'pending',
      })
      .onConflictDoUpdate({
        target: freelancerInvoices.timecardId,
        set: { amountCents: sql`EXCLUDED.amount_cents`, updatedAt: sql`NOW()` },
      });
    await notify(db, c.env, { userId: card.userId, tenantId, kind: 'timecard_approved', title: 'Your timecard was approved', body: `${card.currency ?? 'USD'} ${((Number(card.amountCents) || 0) / 100).toFixed(2)}`, ref: id });
    return c.json({ ok: true, status: 'approved' });
  });

  // POST /:id/reject — employer rejects, returning it to draft with a reason.
  router.post('/:id/reject', authMiddleware, requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    let reason: string | null = null;
    try { const b = await c.req.json<{ reason?: string }>(); reason = b.reason ?? null; } catch { /* optional */ }
    const db = buildDatabase(c.env);
    const rows = await db
      .update(timecards)
      .set({ status: 'draft', rejectReason: reason, submittedAt: null, updatedAt: sql`NOW()` })
      .where(scopedToTenant(timecards, tenantId, eq(timecards.id, id), eq(timecards.status, 'submitted')))
      .returning({ id: timecards.id, userId: timecards.userId });
    const card = rows[0];
    if (!card) return c.json({ error: 'Not found or not submitted' }, 404);
    await notify(db, c.env, { userId: card.userId, tenantId, kind: 'timecard_rejected', title: 'Your timecard was returned', body: reason, ref: id });
    return c.json({ ok: true, status: 'draft' });
  });

  // GET /invoices — employer's invoices (tenant JWT).
  router.get('/invoices', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const rows = await buildDatabase(c.env)
      .select({ ...invoiceColumns, freelancer_name: users.displayName })
      .from(freelancerInvoices)
      .innerJoin(users, eq(users.id, freelancerInvoices.freelancerUserId))
      .where(scopedToTenant(freelancerInvoices, tenantId))
      .orderBy(desc(freelancerInvoices.issuedAt))
      .limit(500);
    return c.json(rows.map(mapInvoice));
  });

  // GET /invoices/mine — worker's invoices (web JWT).
  router.get('/invoices/mine', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const rows = await buildDatabase(c.env)
      .select({ ...invoiceColumns, tenant_name: tenants.name })
      .from(freelancerInvoices)
      .innerJoin(tenants, eq(tenants.id, freelancerInvoices.tenantId))
      .where(eq(freelancerInvoices.freelancerUserId, userId))
      .orderBy(desc(freelancerInvoices.issuedAt))
      .limit(500);
    return c.json(rows.map(mapInvoice));
  });

  // POST /invoices/:invId/pay — employer settles an invoice. Uses the payout
  // provider when configured; otherwise the caller falls back to /mark-paid.
  router.post('/invoices/:invId/pay', authMiddleware, requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const invId = c.req.param('invId');
    const db = buildDatabase(c.env);
    const [inv] = await db
      .select({
        id: freelancerInvoices.id,
        amountCents: freelancerInvoices.amountCents,
        currency: freelancerInvoices.currency,
        freelancerUserId: freelancerInvoices.freelancerUserId,
      })
      .from(freelancerInvoices)
      .where(scopedToTenant(
        freelancerInvoices,
        tenantId,
        eq(freelancerInvoices.id, invId),
        eq(freelancerInvoices.status, 'pending'),
      ));
    if (!inv) return c.json({ error: 'Not found or already settled' }, 404);
    if (!isPayoutsConfigured(c.env)) return c.json({ error: 'No payout provider configured — use manual mark-paid', code: 'PAYOUTS_NOT_CONFIGURED' }, 409);
    const res = await createPayout(c.env, { invoiceId: invId, amountCents: Number(inv.amountCents), currency: inv.currency, freelancerUserId: inv.freelancerUserId, tenantId });
    if (!res.ok) return c.json({ error: res.error ?? 'Payout failed' }, 502);
    await markInvoicePaid(db, c.env, invId, res.externalRef ?? null);
    return c.json({ ok: true, status: 'paid', externalRef: res.externalRef ?? null });
  });

  // POST /invoices/:invId/mark-paid — employer records a manual/off-platform payment.
  router.post('/invoices/:invId/mark-paid', authMiddleware, requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const invId = c.req.param('invId');
    const db = buildDatabase(c.env);
    const [inv] = await db
      .select({ id: freelancerInvoices.id })
      .from(freelancerInvoices)
      .where(scopedToTenant(
        freelancerInvoices,
        tenantId,
        eq(freelancerInvoices.id, invId),
        eq(freelancerInvoices.status, 'pending'),
      ));
    if (!inv) return c.json({ error: 'Not found or already settled' }, 404);
    await markInvoicePaid(db, c.env, invId, null);
    return c.json({ ok: true, status: 'paid' });
  });

  return router;
}

/** Settle an invoice: mark it + its timecard paid, and notify the worker. Shared by
 *  the provider-payout and manual mark-paid paths (DRY). */
async function markInvoicePaid(db: Db, env: Parameters<typeof notify>[1], invId: string, externalRef: string | null): Promise<void> {
  const rows = await db
    .update(freelancerInvoices)
    .set({ status: 'paid', paidAt: sql`NOW()`, externalRef, updatedAt: sql`NOW()` })
    .where(eq(freelancerInvoices.id, invId))
    .returning({
      timecardId: freelancerInvoices.timecardId,
      tenantId: freelancerInvoices.tenantId,
      freelancerUserId: freelancerInvoices.freelancerUserId,
      amountCents: freelancerInvoices.amountCents,
      currency: freelancerInvoices.currency,
    });
  const inv = rows[0];
  if (!inv) return;
  await db.update(timecards).set({ status: 'paid', updatedAt: sql`NOW()` }).where(eq(timecards.id, inv.timecardId));
  // Lifetime-earnings stat on the worker's for-hire profile just changed.
  await invalidateCached(env as Env, freelancerStatsCacheKey(inv.freelancerUserId));
  await notify(db, env, { userId: inv.freelancerUserId, tenantId: Number(inv.tenantId), kind: 'paid', title: 'You were paid', body: `${inv.currency ?? 'USD'} ${((Number(inv.amountCents) || 0) / 100).toFixed(2)}`, ref: inv.timecardId });
}

const mapInvoice = (r: Record<string, unknown>) => ({
  id: r.id,
  timecardId: r.timecard_id,
  engagementId: r.engagement_id,
  tenantId: Number(r.tenant_id),
  tenantName: r.tenant_name ?? null,
  freelancerName: r.freelancer_name ?? null,
  amountCents: Number(r.amount_cents ?? 0),
  currency: r.currency ?? 'USD',
  status: r.status,
  externalRef: r.external_ref ?? null,
  issuedAt: r.issued_at ?? null,
  paidAt: r.paid_at ?? null,
});
