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
 */
import { Hono } from 'hono';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { webAuthMiddleware } from '../middleware/webAuthMiddleware';
import { resolveActiveMinutes, type ResolvableSignal } from '../../application/activity/resolveTime';
import { notify } from '../../application/notifications/notify';
import { isPayoutsConfigured, createPayout } from '../../application/integrations/payments';
import { getActivityLog } from '../../application/activity/activityLog';
import { invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { freelancerStatsCacheKey } from './freelancerRoutes';
import { TenantRole } from '../../domain/shared/types';
import type { Db } from '../../infrastructure/database/connection';
import type { Env, HonoEnv } from '../../env';

const SIGNAL_SOURCES = ['portal', 'vscode', 'agent', 'meeting', 'system'] as const;
const MAX_BATCH = 100;

/** Shared batch-ingest — used by BOTH the web-JWT portal route and the tenant-JWT
 *  VSIX route so the two capture surfaces stay identical (DRY). Attributes each
 *  signal to an active engagement when one resolves; otherwise stores it for audit.
 *  `defaultTenantId` (VSIX: from the tenant token) backfills a signal's tenantId. */
async function ingestSignals(
  // The concrete type `neon(url)` returns — its defaults are <false, false>. Using
  // `ReturnType<typeof neon>` instead widens to <boolean, boolean>, which an actual
  // call is NOT assignable to (the params sit in a contravariant transaction position).
  sql: NeonQueryFunction<false, false>,
  userId: string,
  list: unknown[],
  defaultSource: string,
  defaultTenantId: number | null,
): Promise<number> {
  const engRows = await sql`
    SELECT id, tenant_id, project_id FROM freelancer_engagements
    WHERE freelancer_user_id = ${userId} AND terminated_at IS NULL
  ` as unknown as { id: string; tenant_id: number; project_id: number | null }[];
  const resolveEngagement = (tenantId: number | null, projectId: number | null): string | null => {
    if (tenantId == null) return null;
    const forTenant = engRows.filter((e) => Number(e.tenant_id) === Number(tenantId));
    const byProject = forTenant.find((e) => e.project_id != null && Number(e.project_id) === Number(projectId));
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
    await sql`
      INSERT INTO activity_signals (user_id, tenant_id, engagement_id, project_id, source, kind, ref, weight, duration_seconds, metadata, session_id, occurred_at)
      VALUES (${userId}, ${tenantId}, ${engagementId}, ${projectId}, ${source}, ${kind}, ${ref}, ${weight}, ${duration}, ${metadata}, ${sessionId}, ${occurredAt})
    `;
    ingested++;
  }
  return ingested;
}

/** Recompute a timecard's totals from its entries and persist them. Shared by the
 *  signal resolver AND the manual-entry mutations so the rollup is computed in ONE
 *  place (DRY). amount = billable hours × the card's snapshot rate. */
async function recomputeTimecard(
  sql: NeonQueryFunction<false, false>,
  cardId: string,
): Promise<{ totalMinutes: number; billableMinutes: number; amountCents: number }> {
  const [sums] = await sql`
    SELECT COALESCE(SUM(minutes),0)::int AS total,
           COALESCE(SUM(minutes) FILTER (WHERE billable),0)::int AS billable
    FROM timecard_entries WHERE timecard_id = ${cardId}
  `;
  const [card] = await sql`SELECT rate_cents FROM timecards WHERE id = ${cardId}`;
  const total = Number(sums?.total ?? 0);
  const billable = Number(sums?.billable ?? 0);
  const rate = Number(card?.rate_cents ?? 0);
  const amount = Math.round((billable / 60) * rate);
  await sql`
    UPDATE timecards SET total_minutes = ${total}, billable_minutes = ${billable},
      amount_cents = ${amount}, updated_at = NOW()
    WHERE id = ${cardId}
  `;
  return { totalMinutes: total, billableMinutes: billable, amountCents: amount };
}

export function createActivityRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  const sql = (env: HonoEnv['Bindings']) => neon(env.NEON_DATABASE_URL);

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
    const ingested = await ingestSignals(sql(c.env), userId, list, 'portal', null);
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
    const ingested = await ingestSignals(sql(c.env), userId, list, 'vscode', tenantId);
    return c.json({ ok: true, ingested });
  });

  // POST /meeting — log a meeting as PAID time (it's the worker's time). Emits a
  // single 'meeting' span signal whose full duration the resolver credits. Worker
  // (web JWT); attributed to the given engagement.
  router.post('/meeting', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const b = await c.req.json<{ engagementId?: string; occurredAt?: string; durationMinutes?: number; note?: string }>();
    if (!b.engagementId || !b.durationMinutes || b.durationMinutes <= 0) return c.json({ error: 'engagementId and durationMinutes required' }, 400);
    const ingested = await ingestSignals(sql(c.env), userId, [{
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
    const rows = await sql(c.env)`
      SELECT id, occurred_at, duration_seconds, weight, kind, source, engagement_id
      FROM activity_signals
      WHERE user_id = ${userId} AND occurred_at >= date_trunc('day', now())
      ORDER BY occurred_at ASC LIMIT 2000
    ` as unknown as { id: number; occurred_at: string; duration_seconds: number | null; weight: number; kind: string; source: string; engagement_id: string | null }[];
    const byKind: Record<string, number> = {};
    for (const r of rows) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
    const resolved = resolveActiveMinutes(rows.map((r): ResolvableSignal => ({ id: r.id, occurredAt: r.occurred_at, durationSeconds: r.duration_seconds, weight: r.weight, kind: r.kind })));
    return c.json({ signalCount: rows.length, minutes: resolved.minutes, byKind });
  });

  return router;
}

export function createTimecardRoutes(): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  const sql = (env: HonoEnv['Bindings']) => neon(env.NEON_DATABASE_URL);

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
    const [eng] = await sql(c.env)`
      SELECT id, tenant_id, freelancer_user_id, rate_cents, currency FROM freelancer_engagements
      WHERE id = ${b.engagementId} AND freelancer_user_id = ${userId}
    `;
    if (!eng) return c.json({ error: 'Engagement not found' }, 404);

    const signals = await sql(c.env)`
      SELECT id, occurred_at, duration_seconds, weight, kind, to_char(occurred_at, 'YYYY-MM-DD') AS day
      FROM activity_signals
      WHERE engagement_id = ${b.engagementId}
        AND occurred_at >= ${b.periodStart} AND occurred_at < (${b.periodEnd}::date + 1)
      ORDER BY occurred_at ASC LIMIT 20000
    ` as unknown as { id: number; occurred_at: string; duration_seconds: number | null; weight: number; kind: string; day: string }[];

    // Group by day and resolve.
    const byDay = new Map<string, typeof signals>();
    for (const s of signals) {
      const arr = byDay.get(s.day) ?? [];
      arr.push(s); byDay.set(s.day, arr);
    }
    // Upsert the draft timecard first so entries can reference it.
    const cardId = crypto.randomUUID();
    const [card] = await sql(c.env)`
      INSERT INTO timecards (id, engagement_id, user_id, tenant_id, period_start, period_end, rate_cents, currency, status)
      VALUES (${cardId}, ${b.engagementId}, ${userId}, ${eng.tenant_id}, ${b.periodStart}, ${b.periodEnd}, ${eng.rate_cents}, ${eng.currency ?? 'USD'}, 'draft')
      ON CONFLICT (engagement_id, period_start, period_end) DO UPDATE SET updated_at = NOW()
      RETURNING id, status
    `;
    if (!card) return c.json({ error: 'Failed to create timecard' }, 500);
    if (card.status !== 'draft') return c.json({ error: 'Timecard for this period is already submitted' }, 409);
    const realCardId = card.id as string;

    // Replace auto entries for this card (idempotent re-resolve).
    await sql(c.env)`DELETE FROM timecard_entries WHERE timecard_id = ${realCardId} AND source = 'auto'`;
    for (const [day, daySignals] of byDay) {
      const resolved = resolveActiveMinutes(daySignals.map((s): ResolvableSignal => ({ id: s.id, occurredAt: s.occurred_at, durationSeconds: s.duration_seconds, weight: s.weight, kind: s.kind })));
      if (resolved.minutes <= 0) continue;
      await sql(c.env)`
        INSERT INTO timecard_entries (id, engagement_id, user_id, tenant_id, work_date, minutes, source, billable, resolved_from, timecard_id)
        VALUES (${crypto.randomUUID()}, ${b.engagementId}, ${userId}, ${eng.tenant_id}, ${day}, ${resolved.minutes}, 'auto', true, ${JSON.stringify(resolved)}, ${realCardId})
      `;
    }
    // Recompute totals over auto + any manual entries already in the period.
    const totals = await recomputeTimecard(sql(c.env), realCardId);
    return c.json({ id: realCardId, ...totals });
  });

  // GET /mine — worker's timecards (web JWT).
  router.get('/mine', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const rows = await sql(c.env)`
      SELECT tc.*, t.name AS tenant_name FROM timecards tc JOIN tenants t ON t.id = tc.tenant_id
      WHERE tc.user_id = ${userId} ORDER BY tc.period_start DESC LIMIT 200
    ` as unknown as Record<string, unknown>[];
    return c.json(rows.map(mapCard));
  });

  // GET / — employer's timecards for approval (tenant JWT).
  router.get('/', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const rows = await sql(c.env)`
      SELECT tc.*, u.display_name AS freelancer_name FROM timecards tc JOIN users u ON u.id = tc.user_id
      WHERE tc.tenant_id = ${tenantId} ORDER BY tc.period_start DESC LIMIT 500
    ` as unknown as Record<string, unknown>[];
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
    const rows = await sql(c.env)`
      SELECT te.* FROM timecard_entries te JOIN timecards tc ON tc.id = te.timecard_id
      WHERE te.timecard_id = ${id} AND tc.user_id = ${userId}
      ORDER BY te.work_date ASC
    ` as unknown as Record<string, unknown>[];
    return c.json(rows.map(mapEntry));
  });

  // GET /:id/review — employer approval view: the card + its line items, scoped to
  // the employer's tenant (tenant JWT).
  router.get('/:id/review', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const [cardRow] = await sql(c.env)`
      SELECT tc.*, u.display_name AS freelancer_name FROM timecards tc JOIN users u ON u.id = tc.user_id
      WHERE tc.id = ${id} AND tc.tenant_id = ${tenantId}
    `;
    if (!cardRow) return c.json({ error: 'Not found' }, 404);
    const rows = await sql(c.env)`
      SELECT * FROM timecard_entries WHERE timecard_id = ${id} ORDER BY work_date ASC
    ` as unknown as Record<string, unknown>[];
    return c.json({ card: mapCard(cardRow), entries: rows.map(mapEntry) });
  });

  // POST /:id/entries — worker adds a MANUAL line item to a DRAFT timecard.
  router.post('/:id/entries', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const id = c.req.param('id');
    const b = await c.req.json<{ workDate?: string; minutes?: number; description?: string; billable?: boolean }>();
    const [card] = await sql(c.env)`SELECT id, engagement_id, tenant_id FROM timecards WHERE id = ${id} AND user_id = ${userId} AND status = 'draft'`;
    if (!card) return c.json({ error: 'Not found or not draft' }, 404);
    const minutes = typeof b.minutes === 'number' ? Math.max(0, Math.round(b.minutes)) : 0;
    const workDate = typeof b.workDate === 'string' ? b.workDate.slice(0, 10) : new Date().toISOString().slice(0, 10);
    await sql(c.env)`
      INSERT INTO timecard_entries (id, engagement_id, user_id, tenant_id, work_date, minutes, source, billable, description, timecard_id)
      VALUES (${crypto.randomUUID()}, ${card.engagement_id}, ${userId}, ${card.tenant_id}, ${workDate}, ${minutes}, 'manual', ${b.billable !== false}, ${b.description ?? null}, ${id})
    `;
    const totals = await recomputeTimecard(sql(c.env), id);
    return c.json({ ok: true, ...totals }, 201);
  });

  // PATCH /:id/entries/:entryId — worker edits a line item on a DRAFT timecard
  // (adjust minutes, toggle billable, or annotate).
  router.patch('/:id/entries/:entryId', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const id = c.req.param('id');
    const entryId = c.req.param('entryId');
    const b = await c.req.json<{ minutes?: number; billable?: boolean; description?: string }>();
    const [card] = await sql(c.env)`SELECT id FROM timecards WHERE id = ${id} AND user_id = ${userId} AND status = 'draft'`;
    if (!card) return c.json({ error: 'Not found or not draft' }, 404);
    const minutes = typeof b.minutes === 'number' ? Math.max(0, Math.round(b.minutes)) : null;
    const rows = await sql(c.env)`
      UPDATE timecard_entries SET
        minutes = COALESCE(${minutes}, minutes),
        billable = COALESCE(${typeof b.billable === 'boolean' ? b.billable : null}, billable),
        description = COALESCE(${b.description ?? null}, description),
        updated_at = NOW()
      WHERE id = ${entryId} AND timecard_id = ${id} RETURNING id
    `;
    if (rows.length === 0) return c.json({ error: 'Entry not found' }, 404);
    const totals = await recomputeTimecard(sql(c.env), id);
    return c.json({ ok: true, ...totals });
  });

  // DELETE /:id/entries/:entryId — worker removes a line item from a DRAFT timecard.
  router.delete('/:id/entries/:entryId', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const id = c.req.param('id');
    const entryId = c.req.param('entryId');
    const [card] = await sql(c.env)`SELECT id FROM timecards WHERE id = ${id} AND user_id = ${userId} AND status = 'draft'`;
    if (!card) return c.json({ error: 'Not found or not draft' }, 404);
    await sql(c.env)`DELETE FROM timecard_entries WHERE id = ${entryId} AND timecard_id = ${id}`;
    const totals = await recomputeTimecard(sql(c.env), id);
    return c.json({ ok: true, ...totals });
  });

  // POST /:id/submit — worker submits a draft timecard for approval (notifies the
  // employer who owns the engagement).
  router.post('/:id/submit', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const id = c.req.param('id');
    const rows = await sql(c.env)`
      UPDATE timecards SET status = 'submitted', submitted_at = NOW(), updated_at = NOW()
      WHERE id = ${id} AND user_id = ${userId} AND status = 'draft' RETURNING id, tenant_id, engagement_id, billable_minutes
    `;
    const card = rows[0];
    if (!card) return c.json({ error: 'Not found or not draft' }, 404);
    const [eng] = await sql(c.env)`SELECT created_by_user_id FROM freelancer_engagements WHERE id = ${card.engagement_id}`;
    const [me] = await sql(c.env)`SELECT display_name FROM users WHERE id = ${userId}`;
    if (eng?.created_by_user_id) {
      await notify(sql(c.env), c.env, { userId: eng.created_by_user_id as string, tenantId: Number(card.tenant_id), kind: 'timecard_submitted', title: `${(me?.display_name as string) ?? 'A freelancer'} submitted a timecard`, ref: id });
    }
    return c.json({ ok: true, status: 'submitted' });
  });

  // POST /:id/approve — employer approves a submitted timecard (tenant JWT). This
  // ISSUES an invoice (pending) for the billable amount and notifies the worker.
  router.post('/:id/approve', authMiddleware, requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const actor = c.get('userId') as string;
    const id = c.req.param('id');
    const rows = await sql(c.env)`
      UPDATE timecards SET status = 'approved', approved_at = NOW(), approved_by_user_id = ${actor}, updated_at = NOW()
      WHERE id = ${id} AND tenant_id = ${tenantId} AND status = 'submitted'
      RETURNING id, engagement_id, user_id, amount_cents, currency
    `;
    const card = rows[0];
    if (!card) return c.json({ error: 'Not found or not submitted' }, 404);
    // Issue an invoice (idempotent per timecard).
    await sql(c.env)`
      INSERT INTO freelancer_invoices (id, timecard_id, engagement_id, tenant_id, freelancer_user_id, amount_cents, currency, status)
      VALUES (${crypto.randomUUID()}, ${id}, ${card.engagement_id}, ${tenantId}, ${card.user_id}, ${card.amount_cents}, ${card.currency ?? 'USD'}, 'pending')
      ON CONFLICT (timecard_id) DO UPDATE SET amount_cents = EXCLUDED.amount_cents, updated_at = NOW()
    `;
    await notify(sql(c.env), c.env, { userId: card.user_id as string, tenantId, kind: 'timecard_approved', title: 'Your timecard was approved', body: `${card.currency ?? 'USD'} ${((Number(card.amount_cents) || 0) / 100).toFixed(2)}`, ref: id });
    return c.json({ ok: true, status: 'approved' });
  });

  // POST /:id/reject — employer rejects, returning it to draft with a reason.
  router.post('/:id/reject', authMiddleware, requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    let reason: string | null = null;
    try { const b = await c.req.json<{ reason?: string }>(); reason = b.reason ?? null; } catch { /* optional */ }
    const rows = await sql(c.env)`
      UPDATE timecards SET status = 'draft', reject_reason = ${reason}, submitted_at = NULL, updated_at = NOW()
      WHERE id = ${id} AND tenant_id = ${tenantId} AND status = 'submitted' RETURNING id, user_id
    `;
    const card = rows[0];
    if (!card) return c.json({ error: 'Not found or not submitted' }, 404);
    await notify(sql(c.env), c.env, { userId: card.user_id as string, tenantId, kind: 'timecard_rejected', title: 'Your timecard was returned', body: reason, ref: id });
    return c.json({ ok: true, status: 'draft' });
  });

  // GET /invoices — employer's invoices (tenant JWT).
  router.get('/invoices', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const rows = await sql(c.env)`
      SELECT i.*, u.display_name AS freelancer_name FROM freelancer_invoices i JOIN users u ON u.id = i.freelancer_user_id
      WHERE i.tenant_id = ${tenantId} ORDER BY i.issued_at DESC LIMIT 500
    ` as unknown as Record<string, unknown>[];
    return c.json(rows.map(mapInvoice));
  });

  // GET /invoices/mine — worker's invoices (web JWT).
  router.get('/invoices/mine', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const rows = await sql(c.env)`
      SELECT i.*, t.name AS tenant_name FROM freelancer_invoices i JOIN tenants t ON t.id = i.tenant_id
      WHERE i.freelancer_user_id = ${userId} ORDER BY i.issued_at DESC LIMIT 500
    ` as unknown as Record<string, unknown>[];
    return c.json(rows.map(mapInvoice));
  });

  // POST /invoices/:invId/pay — employer settles an invoice. Uses the payout
  // provider when configured; otherwise the caller falls back to /mark-paid.
  router.post('/invoices/:invId/pay', authMiddleware, requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const invId = c.req.param('invId');
    const [inv] = await sql(c.env)`SELECT * FROM freelancer_invoices WHERE id = ${invId} AND tenant_id = ${tenantId} AND status = 'pending'`;
    if (!inv) return c.json({ error: 'Not found or already settled' }, 404);
    if (!isPayoutsConfigured(c.env)) return c.json({ error: 'No payout provider configured — use manual mark-paid', code: 'PAYOUTS_NOT_CONFIGURED' }, 409);
    const res = await createPayout(c.env, { invoiceId: invId, amountCents: Number(inv.amount_cents), currency: inv.currency as string, freelancerUserId: inv.freelancer_user_id as string, tenantId });
    if (!res.ok) return c.json({ error: res.error ?? 'Payout failed' }, 502);
    await markInvoicePaid(sql(c.env), c.env, invId, res.externalRef ?? null);
    return c.json({ ok: true, status: 'paid', externalRef: res.externalRef ?? null });
  });

  // POST /invoices/:invId/mark-paid — employer records a manual/off-platform payment.
  router.post('/invoices/:invId/mark-paid', authMiddleware, requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const invId = c.req.param('invId');
    const [inv] = await sql(c.env)`SELECT id FROM freelancer_invoices WHERE id = ${invId} AND tenant_id = ${tenantId} AND status = 'pending'`;
    if (!inv) return c.json({ error: 'Not found or already settled' }, 404);
    await markInvoicePaid(sql(c.env), c.env, invId, null);
    return c.json({ ok: true, status: 'paid' });
  });

  return router;
}

/** Settle an invoice: mark it + its timecard paid, and notify the worker. Shared by
 *  the provider-payout and manual mark-paid paths (DRY). */
async function markInvoicePaid(sql: NeonQueryFunction<false, false>, env: Parameters<typeof notify>[1], invId: string, externalRef: string | null): Promise<void> {
  const rows = await sql`
    UPDATE freelancer_invoices SET status = 'paid', paid_at = NOW(), external_ref = ${externalRef}, updated_at = NOW()
    WHERE id = ${invId} RETURNING timecard_id, tenant_id, freelancer_user_id, amount_cents, currency
  `;
  const inv = rows[0];
  if (!inv) return;
  await sql`UPDATE timecards SET status = 'paid', updated_at = NOW() WHERE id = ${inv.timecard_id}`;
  // Lifetime-earnings stat on the worker's for-hire profile just changed.
  await invalidateCached(env as Env, freelancerStatsCacheKey(inv.freelancer_user_id as string));
  await notify(sql, env, { userId: inv.freelancer_user_id as string, tenantId: Number(inv.tenant_id), kind: 'paid', title: 'You were paid', body: `${inv.currency ?? 'USD'} ${((Number(inv.amount_cents) || 0) / 100).toFixed(2)}`, ref: inv.timecard_id as string });
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
