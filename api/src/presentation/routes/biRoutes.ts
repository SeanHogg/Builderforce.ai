/** Consolidated, tenant-local BI reads — /api/bi/*. */

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import { fetchBurnRate } from '../../application/seams/burnRateService';
import { fetchValidationEngagements } from '../../application/seams/validationEngagementsService';
import type { Env, HonoEnv } from '../../env';
import { runwayReport } from '../../application/finance/runwayReport';
import type { Db } from '../../infrastructure/database/connection';

export function createBiRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  router.get('/burn-rate', async (c) => {
    const tenantId = c.get('tenantId');
    const segmentId = c.get('segmentId') as string;
    const result = await fetchBurnRate(db, { tenantId, segmentId });
    return c.json(result);
  });

  // The CFO's runway and cashflow — observed facts and the founder's declared
  // numbers, side by side and labelled (PRD 19 B1). `?company=` picks whose
  // declared side; the observed side is the tenant's.
  router.get('/runway', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const raw = c.req.query('company');
    const companyId = raw ? Number(raw) : null;
    const report = await runwayReport(
      db,
      c.env as Env,
      tenantId,
      companyId !== null && Number.isFinite(companyId) && companyId > 0 ? Math.floor(companyId) : null,
    );
    return c.json(report);
  });

  // One local read model for validation results, dashboards and collectors.
  router.get('/validation-engagements', async (c) => {
    const tenantId = c.get('tenantId');
    const segmentId = c.get('segmentId') as string;
    const result = await fetchValidationEngagements(db, { tenantId, segmentId });
    return c.json(result);
  });

  return router;
}
