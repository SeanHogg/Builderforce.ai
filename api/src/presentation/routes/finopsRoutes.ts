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
 *   GET   /soc/controls            controls register + coverage (cached)         [manager]
 *   POST  /soc/controls            create a control (seeds defaults on first write)[manager]
 *   PATCH /soc/controls/:id        update a control assertion                     [manager]
 *   GET   /soc/coverage            @deprecated alias of GET /soc/controls          [manager]
 *   GET   /audit-report            assembled period report (cached)              [manager]
 *   GET   /audit-report/export     download as csv|json + log the run (not cached)[manager]  → auditReportRunRoutes
 *   GET   /audit-report/runs       recent audit-report runs (cached)             [manager]  → auditReportRunRoutes
 */

import { Hono, type Context } from 'hono';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import { scope } from './segmentTrackerRoutes';
import { getOrSetCached, getCacheVersion, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { financeVersionKey, allocationVersionKey } from '../../application/insights/versionKeys';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { rdTaxCreditConfig } from '../../infrastructure/database/schema';
import {
  computeRdTaxCredit,
  getRdTaxCreditConfig,
  DEFAULT_BLENDED_LABOR_RATE_USD,
} from '../../application/finops/rdTaxCredit';
import {
  addSocControl,
  DEFAULT_SOC_CONTROLS,
  normalizeSocStatus,
  readControlCoverage,
  updateSocControl,
  type SocControlPatch,
} from '../../application/finops/socControls';
import { legacyAliasNotice } from '../middleware/legacyAlias';
import { assembleAuditReport } from '../../application/finops/auditReport';
import { createAuditReportRunRoutes } from './auditReportRunRoutes';
import { daysParam, periodParam } from './queryParams';
import { parseOptionalBody, zJsonObject } from './requestBody';

const SHORT_TTL = { kvTtlSeconds: 60, l1TtlMs: 15_000 };



function rdConfigCacheKey(tenantId: number): string {
  return `finops:rdtax:t:${tenantId}`;
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
    const body = await parseOptionalBody(c, zJsonObject);

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
    const period = periodParam(c.req.query('period'), now);
    const days = daysParam(c.req.query('days'), 30);
    const env = c.env as Env;
    const key = `${rdConfigCacheKey(tenantId)}:report:p:${period}:d:${days}`;
    return c.json(await getOrSetCached(env, key, () => computeRdTaxCredit(db, tenantId, period, days), SHORT_TTL));
  });

  // ── SOC 1 Type II controls ─────────────────────────────────────────────────
  // SOC 1 (financial-reporting controls, `finops_soc_controls`) lives here; SOC 2 Trust
  // Services (`soc_controls`, segment-scoped, with evidence) is /api/governance/soc2 —
  // two registers, two tables, never one surface. See finops-soc-controls-collision.

  const socControls = async (c: Context<HonoEnv>) => c.json(await readControlCoverage(c.env as Env, db, scope(c).tenantId));
  router.get('/soc/controls', requireRole(TenantRole.MANAGER), socControls);
  // `/soc/coverage` ran the same computation as `/soc/controls` (uncached there):
  // it is now the same cached handler, kept for older callers.
  router.get('/soc/coverage', requireRole(TenantRole.MANAGER), legacyAliasNotice('/api/finops/soc/controls'), socControls);

  router.post('/soc/controls', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId } = scope(c);
    const body = await parseOptionalBody(c, zJsonObject);
    const controlRef = typeof body.controlRef === 'string' && body.controlRef.trim() ? body.controlRef.trim() : null;
    const objective = typeof body.objective === 'string' && body.objective.trim() ? body.objective.trim() : null;
    const control = controlRef && objective
      ? {
          controlRef,
          objective,
          category: typeof body.category === 'string' && body.category.trim() ? body.category.trim() : 'general',
          status: normalizeSocStatus(body.status),
          owner: typeof body.owner === 'string' ? body.owner : null,
          note: typeof body.note === 'string' ? body.note : '',
        }
      : null;
    return c.json(await addSocControl(c.env as Env, db, tenantId, control), 201);
  });

  router.patch('/soc/controls/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId } = scope(c);
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'invalid control id' }, 400);
    const body = await parseOptionalBody(c, zJsonObject);

    const patch: SocControlPatch = {};
    if (body.status !== undefined) patch.status = normalizeSocStatus(body.status);
    if (typeof body.owner === 'string') patch.owner = body.owner;
    if (typeof body.note === 'string') patch.note = body.note;
    if (typeof body.objective === 'string' && body.objective.trim()) patch.objective = body.objective.trim();
    if (typeof body.category === 'string' && body.category.trim()) patch.category = body.category.trim();
    if (body.lastReviewed === true) patch.lastReviewed = new Date();
    else if (typeof body.lastReviewed === 'string') {
      const d = new Date(body.lastReviewed);
      if (!Number.isNaN(d.getTime())) patch.lastReviewed = d;
    }

    const coverage = await updateSocControl(c.env as Env, db, tenantId, id, patch);
    if (!coverage) return c.json({ error: 'control not found' }, 404);
    return c.json(coverage);
  });

  // ── Audit-Ready Reports ────────────────────────────────────────────────────

  router.get('/audit-report', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId, segmentId } = scope(c);
    const now = Date.now();
    const period = periodParam(c.req.query('period'), now);
    const env = c.env as Env;
    // Served through the canonical read-through cache. It recomputes finance +
    // allocation + R&D + SOC + compliance rollups per request, so beyond the short
    // TTL (hot-write source tables) we fold in the finance + allocation version
    // tokens — bumped on every budget / allocation-goal write — so a structural
    // edit refreshes the report immediately instead of waiting out the TTL.
    const [finVer, allocVer] = await Promise.all([
      getCacheVersion(env, financeVersionKey(tenantId)),
      getCacheVersion(env, allocationVersionKey(tenantId)),
    ]);
    const key = `finops:audit:t:${tenantId}:s:${segmentId}:p:${period}:fv:${finVer}:av:${allocVer}`;
    return c.json(await getOrSetCached(env, key, () => assembleAuditReport(db, tenantId, segmentId, period), SHORT_TTL));
  });

  // Export (uncached point-in-time snapshot, logged to audit_report_runs) + the run log.
  router.route('/audit-report', createAuditReportRunRoutes(db));

  return router;
}

// Re-exported for any caller that wants the seed list / default rate.
export { DEFAULT_SOC_CONTROLS, DEFAULT_BLENDED_LABOR_RATE_USD };
