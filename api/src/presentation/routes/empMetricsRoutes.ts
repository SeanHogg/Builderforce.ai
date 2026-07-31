/**
 * Extended member / EMP metrics routes — an ADDITIONAL router co-mounted under the
 * same `/api/members` prefix as {@link createMemberRoutes} (Hono falls through to
 * this router for the paths memberRoutes doesn't own). Keeping the EMP lenses here
 * leaves the original member routes file untouched.
 *
 * All reads are MANAGER+ and cached read-through against the shared workforce
 * version token (bumped on task/deploy/profile writes), matching /api/members/metrics.
 *
 *   GET  /allocation-health          EMP-12  over-allocation detection
 *   GET  /collaboration              EMP-14  collaboration metrics
 *   GET  /doc-activity               EMP-17  documentation-activity metrics
 *   GET  /labor-cost                 EMP-19  labour-cost attribution
 *   GET  /performer-tiers            EMP-16  high/low-performer tiers
 *   GET  /coaching-notes             EMP-16  list a member's coaching notes
 *   POST /coaching-notes             EMP-16  add a coaching note
 *   DELETE /coaching-notes/:id       EMP-16  remove a coaching note
 *   GET  /initiative-allocation      EMP-13  per-member initiative allocation
 *   GET  /metrics/export             EMP-20  member metrics as CSV | JSON
 */
import { Hono } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { readWorkforceMetricsVersion, computeMemberMetrics } from '../../application/metrics/workforceMetrics';
import { computeAllocationHealth } from '../../application/metrics/allocationHealth';
import { computeCollaborationMetrics } from '../../application/metrics/collaboration';
import { computeDocActivity } from '../../application/metrics/docActivity';
import { computeLaborCost } from '../../application/metrics/laborCost';
import { computePerformerTiers } from '../../application/metrics/performerTiers';
import { computeMemberInitiativeAllocation } from '../../application/metrics/memberInitiativeAlloc';
import { memberMetricsToCsv } from '../../application/metrics/metricsCsv';
import { coachingNotes } from '../../infrastructure/database/schema';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

const MEMBER_KINDS = new Set(['human', 'cloud_agent', 'host_agent']);
const clampDays = (raw: number, def: number, max: number) =>
  Math.min(max, Math.max(1, Number.isFinite(raw) ? raw : def));
const parseDays = (raw: string | undefined, def = 30, max = 180) =>
  clampDays(parseInt(raw ?? String(def), 10), def, max);

const MANAGER = requireRole(TenantRole.MANAGER);

export function createEmpMetricsRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  /** Version-token cached read (busts on task/deploy/profile writes). */
  async function cachedByVersion<T>(c: { env: unknown }, tenantId: number, suffix: string, load: () => Promise<T>): Promise<T> {
    const env = c.env as Env;
    const version = await readWorkforceMetricsVersion(env, tenantId);
    return getOrSetCached(env, `emp:${suffix}:tenant:${tenantId}:v:${version}`, load);
  }

  // ── EMP-12 — over-allocation detection ─────────────────────────────────────
  router.get('/allocation-health', MANAGER, async (c) => {
    const tenantId = c.get('tenantId') as number;
    return c.json(await cachedByVersion(c, tenantId, 'alloc-health', () => computeAllocationHealth(db, tenantId)));
  });

  // ── EMP-14 — collaboration metrics ─────────────────────────────────────────
  router.get('/collaboration', MANAGER, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const days = parseDays(c.req.query('days'), 30, 180);
    return c.json(await cachedByVersion(c, tenantId, `collab:${days}`, () => computeCollaborationMetrics(db, tenantId, days)));
  });

  // ── EMP-17 — documentation-activity metrics ────────────────────────────────
  router.get('/doc-activity', MANAGER, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const days = parseDays(c.req.query('days'), 30, 365);
    return c.json(await cachedByVersion(c, tenantId, `doc-act:${days}`, () => computeDocActivity(db, tenantId, days)));
  });

  // ── EMP-19 — labour-cost attribution ───────────────────────────────────────
  router.get('/labor-cost', MANAGER, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const days = parseDays(c.req.query('days'), 30, 365);
    const projectIdRaw = c.req.query('projectId');
    const projectId = projectIdRaw != null && Number.isFinite(Number(projectIdRaw)) ? Number(projectIdRaw) : undefined;
    return c.json(await cachedByVersion(c, tenantId, `labor:${days}:p:${projectId ?? 'all'}`, () => computeLaborCost(db, tenantId, days, { projectId })));
  });

  // ── EMP-16 — high/low-performer tiers ──────────────────────────────────────
  router.get('/performer-tiers', MANAGER, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const days = parseDays(c.req.query('days'), 30, 180);
    return c.json(await cachedByVersion(c, tenantId, `tiers:${days}`, () => computePerformerTiers(db, tenantId, days)));
  });

  // ── EMP-16 — coaching notes (list / add / delete) ──────────────────────────
  // Notes are managerial + not version-token cached (small, mutated directly).
  router.get('/coaching-notes', MANAGER, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const kind = c.req.query('kind');
    const ref = c.req.query('ref');
    const conds = [eq(coachingNotes.tenantId, tenantId)];
    if (kind && ref) {
      if (!MEMBER_KINDS.has(kind)) return c.json({ error: 'invalid member kind' }, 400);
      conds.push(eq(coachingNotes.memberKind, kind), eq(coachingNotes.memberRef, ref));
    }
    const notes = await db.select().from(coachingNotes).where(and(...conds)).orderBy(desc(coachingNotes.createdAt)).limit(500);
    return c.json({ notes });
  });

  router.post('/coaching-notes', MANAGER, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const authorId = c.get('userId') as string | undefined;
    type NoteBody = { memberKind?: string; memberRef?: string; note?: string };
    const body = await c.req.json<NoteBody>().catch(() => ({} as NoteBody));
    const kind = body.memberKind;
    const ref = body.memberRef;
    const note = (body.note ?? '').trim();
    if (!kind || !MEMBER_KINDS.has(kind) || !ref) return c.json({ error: 'memberKind + memberRef are required' }, 400);
    if (!note) return c.json({ error: 'note is required' }, 400);
    const [row] = await db
      .insert(coachingNotes)
      .values({ tenantId, memberKind: kind, memberRef: ref, note, authorId: authorId ?? null })
      .returning();
    return c.json({ note: row }, 201);
  });

  router.delete('/coaching-notes/:id', MANAGER, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400);
    await db.delete(coachingNotes).where(and(eq(coachingNotes.tenantId, tenantId), eq(coachingNotes.id, id)));
    return c.body(null, 204);
  });

  // ── EMP-13 — per-member initiative allocation ──────────────────────────────
  router.get('/initiative-allocation', MANAGER, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const days = parseDays(c.req.query('days'), 30, 365);
    return c.json(await cachedByVersion(c, tenantId, `init-alloc:${days}`, () => computeMemberInitiativeAllocation(db, tenantId, days)));
  });

  // ── EMP-20 — export member metrics (CSV | JSON) ────────────────────────────
  // A download / point-in-time snapshot: not cached (mirrors the compliance export).
  router.get('/metrics/export', MANAGER, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const days = parseDays(c.req.query('days'), 30, 180);
    const format = c.req.query('format') === 'json' ? 'json' : 'csv';
    const members = await computeMemberMetrics(db, tenantId, days);
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === 'json') {
      return c.json({ generatedAt: new Date().toISOString(), windowDays: days, members });
    }
    return new Response(memberMetricsToCsv(members), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="member-metrics-${days}d-${stamp}.csv"`,
      },
    });
  });

  return router;
}
