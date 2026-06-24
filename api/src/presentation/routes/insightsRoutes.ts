/**
 * Role-insight lenses — /api/insights/*
 *
 * The rollup-only views that make the `insights.*` RBAC gates live. Every lens
 * reads collectors that already exist (no new collection) and is:
 *   - server-gated by role (mirrors the client CAPABILITIES map — manager for the
 *     exec lenses, developer for delivery/DORA),
 *   - cached: the underlying tables are hot-write (every run / call / tool / deploy)
 *     so a short TTL keeps figures fresh without version-bumping the metering path;
 *     the one structural input (budgets) carries a version token bumped on write.
 *
 *   GET /engineering   LENS #1 — AI effectiveness (run_model_outcomes)   [manager]
 *   GET /dora          LENS #2 — DORA four-keys (deployment_events)      [developer]
 *   GET /finance       LENS #3 — FinOps (llm_usage_log + budgets)        [manager]
 *   GET /compliance    LENS #6 — audit summary (tool_audit_events)       [manager]
 *   GET /compliance/export?format=csv|json — evidence pack download      [manager]
 *   …/budgets          FinOps budget CRUD (generic tracker, manager-gated writes)
 */

import { Hono } from 'hono';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import { mountTrackers, scope } from './segmentTrackerRoutes';
import { getOrSetCached, getCacheVersion } from '../../infrastructure/cache/readThroughCache';
import { budgets } from '../../infrastructure/database/schema';
import { computeEngineeringInsights } from '../../application/insights/engineeringInsights';
import { computeDora } from '../../application/metrics/workforceMetrics';
import { computeFinanceInsights } from '../../application/insights/financeInsights';
import { computeComplianceSummary, buildEvidencePack, evidencePackToCsv } from '../../application/insights/complianceInsights';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

const SHORT_TTL = { kvTtlSeconds: 60, l1TtlMs: 15_000 };

/** Clamp a `?days=` window to a sane range (default 30). */
function parseDays(raw: string | undefined, def = 30): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 && n <= 365 ? Math.floor(n) : def;
}

/** Current calendar month 'YYYY-MM' (UTC) when no `?period=` given. */
function currentPeriodMonth(now: number): string {
  const d = new Date(now);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function parsePeriod(raw: string | undefined, now: number): string {
  return raw && /^\d{4}-\d{2}$/.test(raw) ? raw : currentPeriodMonth(now);
}

export function financeVersionKey(tenantId: number): string {
  return `insights-finance-version:tenant:${tenantId}`;
}

export function createInsightsRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // LENS #1 — AI effectiveness (manager)
  router.get('/engineering', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId } = scope(c);
    const days = parseDays(c.req.query('days'));
    const env = c.env as Env;
    const key = `insights:eng:t:${tenantId}:d:${days}`;
    return c.json(await getOrSetCached(env, key, () => computeEngineeringInsights(db, tenantId, days), SHORT_TTL));
  });

  // LENS #2 — DORA (developer+; reuses the shared DORA rollup)
  router.get('/dora', requireRole(TenantRole.DEVELOPER), async (c) => {
    const { tenantId } = scope(c);
    const days = parseDays(c.req.query('days'));
    const env = c.env as Env;
    const key = `insights:dora:t:${tenantId}:d:${days}`;
    return c.json(await getOrSetCached(env, key, () => computeDora(db, tenantId, days), SHORT_TTL));
  });

  // LENS #3 — FinOps (manager). Budget writes bump the finance version token.
  router.get('/finance', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId, segmentId } = scope(c);
    const now = Date.now();
    const period = parsePeriod(c.req.query('period'), now);
    const env = c.env as Env;
    const ver = await getCacheVersion(env, financeVersionKey(tenantId));
    const key = `insights:fin:t:${tenantId}:s:${segmentId}:p:${period}:v:${ver}`;
    return c.json(await getOrSetCached(env, key, () => computeFinanceInsights(db, tenantId, segmentId, period, now), SHORT_TTL));
  });

  // LENS #6 — compliance summary (manager)
  router.get('/compliance', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId } = scope(c);
    const days = parseDays(c.req.query('days'));
    const env = c.env as Env;
    const key = `insights:comp:t:${tenantId}:d:${days}`;
    return c.json(await getOrSetCached(env, key, () => computeComplianceSummary(db, tenantId, days), SHORT_TTL));
  });

  // LENS #6 — evidence-pack export (manager). Not cached: it's a download, and the
  // bounded query is a deliberate point-in-time snapshot for an audit request.
  router.get('/compliance/export', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId } = scope(c);
    const days = parseDays(c.req.query('days'), 90);
    const format = c.req.query('format') === 'json' ? 'json' : 'csv';
    const rows = await buildEvidencePack(db, tenantId, days);
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === 'json') {
      return c.json({ generatedAt: new Date().toISOString(), windowDays: days, rows });
    }
    return new Response(evidencePackToCsv(rows), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="evidence-pack-${stamp}.csv"`,
      },
    });
  });

  // FinOps budget CRUD (generic tracker; writes manager-gated + bump finance version).
  mountTrackers(router, db, [
    {
      path: '/budgets',
      table: budgets,
      opts: {
        fields: ['scopeKind', 'projectId', 'initiativeId', 'periodMonth', 'limitUsd', 'notes'],
        required: ['periodMonth'],
        bumpVersionKeys: (t) => [financeVersionKey(t)],
      },
    },
  ]);

  return router;
}
