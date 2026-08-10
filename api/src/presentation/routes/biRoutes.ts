/** Consolidated, tenant-local BI reads — /api/bi/*. */

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import { fetchBurnRate } from '../../application/seams/burnRateService';
import { fetchValidationEngagements } from '../../application/seams/validationEngagementsService';
import type { HonoEnv } from '../../env';
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

  // One local read model for validation results, dashboards and collectors.
  router.get('/validation-engagements', async (c) => {
    const tenantId = c.get('tenantId');
    const segmentId = c.get('segmentId') as string;
    const result = await fetchValidationEngagements(db, { tenantId, segmentId });
    return c.json(result);
  });

  return router;
}
