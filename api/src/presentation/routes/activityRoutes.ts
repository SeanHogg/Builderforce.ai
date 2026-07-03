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
import { neon } from '@neondatabase/serverless';
import { authMiddleware } from '../middleware/authMiddleware';
import { webAuthMiddleware } from '../middleware/webAuthMiddleware';
import { resolveActiveMinutes, type ResolvableSignal } from '../../application/activity/resolveTime';
import type { HonoEnv } from '../../env';

const SIGNAL_SOURCES = ['portal', 'vscode', 'agent', 'meeting', 'system'] as const;
const MAX_BATCH = 100;

/** Shared batch-ingest — used by BOTH the web-JWT portal route and the tenant-JWT
 *  VSIX route so the two capture surfaces stay identical (DRY). Attributes each
 *  signal to an active engagement when one resolves; otherwise stores it for audit.
 *  `defaultTenantId` (VSIX: from the tenant token) backfills a signal's tenantId. */
async function ingestSignals(
  sql: ReturnType<typeof neon>,
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

export function createActivityRoutes(): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  const sql = (env: HonoEnv['Bindings']) => neon(env.NEON_DATABASE_URL);

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
    let total = 0;
    for (const [day, daySignals] of byDay) {
      const resolved = resolveActiveMinutes(daySignals.map((s): ResolvableSignal => ({ id: s.id, occurredAt: s.occurred_at, durationSeconds: s.duration_seconds, weight: s.weight, kind: s.kind })));
      if (resolved.minutes <= 0) continue;
      total += resolved.minutes;
      await sql(c.env)`
        INSERT INTO timecard_entries (id, engagement_id, user_id, tenant_id, work_date, minutes, source, billable, resolved_from, timecard_id)
        VALUES (${crypto.randomUUID()}, ${b.engagementId}, ${userId}, ${eng.tenant_id}, ${day}, ${resolved.minutes}, 'auto', true, ${JSON.stringify(resolved)}, ${realCardId})
      `;
    }
    // Include any manual entries already in the period.
    const [sums] = await sql(c.env)`
      SELECT COALESCE(SUM(minutes),0)::int AS total, COALESCE(SUM(minutes) FILTER (WHERE billable),0)::int AS billable
      FROM timecard_entries WHERE timecard_id = ${realCardId}
    `;
    const totalMin = Number(sums?.total ?? total);
    const billableMin = Number(sums?.billable ?? total);
    const rate = Number(eng.rate_cents ?? 0);
    await sql(c.env)`
      UPDATE timecards SET total_minutes = ${totalMin}, billable_minutes = ${billableMin},
        amount_cents = ${Math.round((billableMin / 60) * rate)}, updated_at = NOW()
      WHERE id = ${realCardId}
    `;
    return c.json({ id: realCardId, totalMinutes: totalMin, billableMinutes: billableMin });
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

  // GET /:id/entries — the line items on one timecard (worker or employer).
  router.get('/:id/entries', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const id = c.req.param('id');
    const rows = await sql(c.env)`
      SELECT te.* FROM timecard_entries te JOIN timecards tc ON tc.id = te.timecard_id
      WHERE te.timecard_id = ${id} AND tc.user_id = ${userId}
      ORDER BY te.work_date ASC
    ` as unknown as Record<string, unknown>[];
    return c.json(rows.map((r) => ({ id: r.id, workDate: r.work_date, minutes: Number(r.minutes), source: r.source, billable: Boolean(r.billable), description: r.description ?? null })));
  });

  // POST /:id/submit — worker submits a draft timecard for approval.
  router.post('/:id/submit', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const id = c.req.param('id');
    const rows = await sql(c.env)`
      UPDATE timecards SET status = 'submitted', submitted_at = NOW(), updated_at = NOW()
      WHERE id = ${id} AND user_id = ${userId} AND status = 'draft' RETURNING id
    `;
    if (rows.length === 0) return c.json({ error: 'Not found or not draft' }, 404);
    return c.json({ ok: true, status: 'submitted' });
  });

  // POST /:id/approve — employer approves a submitted timecard (tenant JWT).
  router.post('/:id/approve', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const actor = c.get('userId') as string;
    const id = c.req.param('id');
    const rows = await sql(c.env)`
      UPDATE timecards SET status = 'approved', approved_at = NOW(), approved_by_user_id = ${actor}, updated_at = NOW()
      WHERE id = ${id} AND tenant_id = ${tenantId} AND status = 'submitted' RETURNING id
    `;
    if (rows.length === 0) return c.json({ error: 'Not found or not submitted' }, 404);
    return c.json({ ok: true, status: 'approved' });
  });

  // POST /:id/reject — employer rejects, returning it to draft with a reason.
  router.post('/:id/reject', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    let reason: string | null = null;
    try { const b = await c.req.json<{ reason?: string }>(); reason = b.reason ?? null; } catch { /* optional */ }
    const rows = await sql(c.env)`
      UPDATE timecards SET status = 'draft', reject_reason = ${reason}, submitted_at = NULL, updated_at = NOW()
      WHERE id = ${id} AND tenant_id = ${tenantId} AND status = 'submitted' RETURNING id
    `;
    if (rows.length === 0) return c.json({ error: 'Not found or not submitted' }, 404);
    return c.json({ ok: true, status: 'draft' });
  });

  return router;
}
