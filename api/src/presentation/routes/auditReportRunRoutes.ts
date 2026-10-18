/**
 * Audit-report export + run log — mounted under /api/finops/audit-report.
 *
 *   GET /audit-report/export   download the report as csv|json|xlsx (NOT cached)
 *                              and log the run — export source              [manager]
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
import { listAuditReportRuns } from '../../application/finops/auditReportRuns';
import { auditReportExportSource } from '../../application/finops/auditReportExport';
import { exportSourceHandler } from './exportSourceRoute';
import { limitParam } from './queryParams';

export function createAuditReportRunRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  // A registered export source (also at /api/exports/sources/finops.audit-report);
  // loading it records the run.
  router.get('/export', exportSourceHandler(auditReportExportSource, db));

  router.get('/runs', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId } = scope(c);
    const runs = await listAuditReportRuns(db, c.env as Env, tenantId, { limit: limitParam(c.req.query('limit'), 20, 100) });
    return c.json({ runs });
  });

  return router;
}
