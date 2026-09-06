/**
 * Audit-report export + run log — mounted under /api/finops/audit-report.
 *
 *   GET /audit-report/export   download the report as csv|json (NOT cached) and
 *                              log the run                                    [manager]
 *   GET /audit-report/runs     the tenant's recent runs, newest first (cached) [manager]
 *
 * The export is the one honest logging moment: a deliberate point-in-time
 * snapshot an auditor takes away. The cached `GET /audit-report` (finopsRoutes)
 * must not log — it would only ever record cache misses.
 */

import { Hono } from 'hono';
import { requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import { scope } from './segmentTrackerRoutes';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { assembleAuditReport, auditReportToCsv } from '../../application/finops/auditReport';
import { listAuditReportRuns, recordAuditReportRun } from '../../application/finops/auditReportRuns';
import { limitParam, periodParam } from './queryParams';

export function createAuditReportRunRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.get('/export', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId, segmentId } = scope(c);
    const period = periodParam(c.req.query('period'), Date.now());
    const format = c.req.query('format') === 'json' ? 'json' : 'csv';
    const report = await assembleAuditReport(db, tenantId, segmentId, period);
    await recordAuditReportRun(db, c.env as Env, {
      tenantId, periodMonth: period, generatedBy: c.get('userId') ?? null, report, format,
    });
    if (format === 'json') return c.json(report);
    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(auditReportToCsv(report), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="audit-report-${period}-${stamp}.csv"`,
      },
    });
  });

  router.get('/runs', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId } = scope(c);
    const runs = await listAuditReportRuns(db, c.env as Env, tenantId, { limit: limitParam(c.req.query('limit'), 20, 100) });
    return c.json({ runs });
  });

  return router;
}
