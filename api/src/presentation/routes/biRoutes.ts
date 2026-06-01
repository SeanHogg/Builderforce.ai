/**
 * BI bridge — /api/bi/* (spec 05 §4.1).
 *
 * BuilderForce-internal consumers (cost-per-point, runway-aware sprint caps) read
 * the host's burn/runway for the caller's Segment here. End-user authed; the
 * outbound call to the host uses the per-tenant BI config + token (read:bi.burn).
 * Returns `{ available: false }` when the host BI isn't configured/reachable so
 * the UI falls back to manual burn input.
 */

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import { fetchBurnRate } from '../../application/seams/burnRateService';
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

  return router;
}
