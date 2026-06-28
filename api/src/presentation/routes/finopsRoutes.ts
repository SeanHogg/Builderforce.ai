/**
 * DevFinOps — /api/finops/*
 *
 * The completion of three marketing capabilities (R&D Tax Credits, SOC 1 Type II,
 * Audit-Ready Reports). Software-capitalization / investment-allocation already
 * ride the allocation lens, so this layer adds only what is missing — each leg
 * reuses an existing engine (allocation effort/cost, finance, compliance trail).
 *
 *   GET   /rd-tax/config            QRE definition (qualified categories + rate)   [manager]
 *   PATCH /rd-tax/config            upsert QRE definition                          [manager]
 *   GET   /rd-tax                   QRE rollup (computeRdTaxCredit, cached)        [manager]
 *   GET   /soc/controls            controls register (seeded defaults if empty)   [manager]
 *   POST  /soc/controls            create a control (seeds defaults on first write)[manager]
 *   PATCH /soc/controls/:id        update a control assertion                     [manager]
 *   GET   /soc/coverage            control-coverage summary (cached)              [manager]
 *   GET   /audit-report            assembled period report (cached)              [manager]
 *   GET   /audit-report/export     download the report as csv|json (not cached)   [manager]
 */

import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import { scope } from './segmentTrackerRoutes';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { rdTaxCreditConfig, socControls } from '../../application/finops/finopsTables';
import {
  computeRdTaxCredit,
  getRdTaxCreditConfig,
  DEFAULT_BLENDED_LABOR_RATE_USD,
} from '../../application/finops/rdTaxCredit';
import {
  computeControlCoverage,
  DEFAULT_SOC_CONTROLS,
  type SocControlStatus,
} from '../../application/finops/socControls';
import { assembleAuditReport, auditReportToCsv } from '../../application/finops/auditReport';

const SHORT_TTL = { kvTtlSeconds: 60, l1TtlMs: 15_000 };

/** Clamp a `?days=` window (default 30, 1..365). */
function parseDays(raw: string | undefined, def = 30): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 && n <= 365 ? Math.floor(n) : def;
}

function currentPeriodMonth(now: number): string {
  const d = new Date(now);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function parsePeriod(raw: string | undefined, now: number): string {
  return raw && /^\d{4}-\d{2}$/.test(raw) ? raw : currentPeriodMonth(now);
}

function rdConfigCacheKey(tenantId: number): string {
  return `finops:rdtax:t:${tenantId}`;
}
function socCoverageCacheKey(tenantId: number): string {
  return `finops:soc:t:${tenantId}`;
}

/** Normalize an asserted control status, defaulting to 'gap'. */
function normStatus(s: unknown): SocControlStatus {
  return s === 'implemented' || s === 'partial' || s === 'gap' ? s : 'gap';
}

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean);
}

export function createFinopsRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // ── R&D Tax Credits ────────────────────────────────────────────────────────

  router.get('/rd-tax/config', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId } = scope(c);
    return c.json(await getRdTaxCreditConfig(db, tenantId));
  });

  router.patch('/rd-tax/config', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId } = scope(c);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

    const current = await getRdTaxCreditConfig(db, tenantId);
    const qualifiedCategories = asStringArray(body.qualifiedCategories) ?? current.qualifiedCategories;
    const qualifiedActionTypes = asStringArray(body.qualifiedActionTypes) ?? current.qualifiedActionTypes;
    const rawRate = Number(body.blendedLaborRateUsd);
    const blendedLaborRateUsd = Number.isFinite(rawRate) && rawRate > 0 ? rawRate : current.blendedLaborRateUsd;

    await db
      .insert(rdTaxCreditConfig)
      .values({ tenantId, qualifiedCategories, qualifiedActionTypes, blendedLaborRateUsd, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: rdTaxCreditConfig.tenantId,
        set: { qualifiedCategories, qualifiedActionTypes, blendedLaborRateUsd, updatedAt: new Date() },
      });

    await invalidateCached(c.env as Env, rdConfigCacheKey(tenantId));
    return c.json({ qualifiedCategories, qualifiedActionTypes, blendedLaborRateUsd });
  });

  router.get('/rd-tax', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId } = scope(c);
    const now = Date.now();
    const period = parsePeriod(c.req.query('period'), now);
    const days = parseDays(c.req.query('days'));
    const env = c.env as Env;
    const key = `${rdConfigCacheKey(tenantId)}:report:p:${period}:d:${days}`;
    return c.json(await getOrSetCached(env, key, () => computeRdTaxCredit(db, tenantId, period, days), SHORT_TTL));
  });

  // ── SOC 1 Type II controls ─────────────────────────────────────────────────

  router.get('/soc/controls', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId } = scope(c);
    return c.json(await computeControlCoverage(db, tenantId));
  });

  router.get('/soc/coverage', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId } = scope(c);
    const env = c.env as Env;
    return c.json(await getOrSetCached(env, socCoverageCacheKey(tenantId), () => computeControlCoverage(db, tenantId), SHORT_TTL));
  });

  // Create a control. On the first write for a tenant that still shows seeded
  // defaults, persist the default register first so the table becomes authoritative.
  router.post('/soc/controls', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId } = scope(c);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

    const existing = await db
      .select({ id: socControls.id })
      .from(socControls)
      .where(eq(socControls.tenantId, tenantId))
      .limit(1);
    if (existing.length === 0) {
      await db.insert(socControls).values(
        DEFAULT_SOC_CONTROLS.map((d) => ({
          tenantId,
          controlRef: d.controlRef,
          objective: d.objective,
          category: d.category,
          status: 'gap' as const,
        })),
      ).onConflictDoNothing();
    }

    const controlRef = typeof body.controlRef === 'string' && body.controlRef.trim() ? body.controlRef.trim() : null;
    const objective = typeof body.objective === 'string' && body.objective.trim() ? body.objective.trim() : null;
    if (controlRef && objective) {
      const category = typeof body.category === 'string' && body.category.trim() ? body.category.trim() : 'general';
      await db
        .insert(socControls)
        .values({
          tenantId,
          controlRef,
          objective,
          category,
          status: normStatus(body.status),
          owner: typeof body.owner === 'string' ? body.owner : null,
          note: typeof body.note === 'string' ? body.note : '',
        })
        .onConflictDoNothing();
    }

    await invalidateCached(c.env as Env, socCoverageCacheKey(tenantId));
    return c.json(await computeControlCoverage(db, tenantId), 201);
  });

  router.patch('/soc/controls/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId } = scope(c);
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'invalid control id' }, 400);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (body.status !== undefined) set.status = normStatus(body.status);
    if (typeof body.owner === 'string') set.owner = body.owner;
    if (typeof body.note === 'string') set.note = body.note;
    if (typeof body.objective === 'string' && body.objective.trim()) set.objective = body.objective.trim();
    if (typeof body.category === 'string' && body.category.trim()) set.category = body.category.trim();
    if (body.lastReviewed === true) set.lastReviewed = new Date();
    else if (typeof body.lastReviewed === 'string') {
      const d = new Date(body.lastReviewed);
      if (!Number.isNaN(d.getTime())) set.lastReviewed = d;
    }

    const updated = await db
      .update(socControls)
      .set(set)
      .where(and(eq(socControls.id, id), eq(socControls.tenantId, tenantId)))
      .returning({ id: socControls.id });
    if (updated.length === 0) return c.json({ error: 'control not found' }, 404);

    await invalidateCached(c.env as Env, socCoverageCacheKey(tenantId));
    return c.json(await computeControlCoverage(db, tenantId));
  });

  // ── Audit-Ready Reports ────────────────────────────────────────────────────

  router.get('/audit-report', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId, segmentId } = scope(c);
    const now = Date.now();
    const period = parsePeriod(c.req.query('period'), now);
    const env = c.env as Env;
    const key = `finops:audit:t:${tenantId}:s:${segmentId}:p:${period}`;
    return c.json(await getOrSetCached(env, key, () => assembleAuditReport(db, tenantId, segmentId, period), SHORT_TTL));
  });

  // Export — not cached: a deliberate point-in-time snapshot for an auditor, like
  // the compliance evidence-pack export.
  router.get('/audit-report/export', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId, segmentId } = scope(c);
    const now = Date.now();
    const period = parsePeriod(c.req.query('period'), now);
    const format = c.req.query('format') === 'json' ? 'json' : 'csv';
    const report = await assembleAuditReport(db, tenantId, segmentId, period);
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === 'json') {
      return c.json(report);
    }
    return new Response(auditReportToCsv(report), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="audit-report-${period}-${stamp}.csv"`,
      },
    });
  });

  return router;
}

// Re-exported for any caller that wants the seed list / default rate.
export { DEFAULT_SOC_CONTROLS, DEFAULT_BLENDED_LABOR_RATE_USD };
