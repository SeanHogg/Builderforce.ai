/**
 * Consumption meter route — /api/consumption
 *
 * The ALL-USERS counterpart to /api/dashboard/usage. Where the dashboard usage
 * breakdown is MANAGER+ and detailed, this endpoint is open to ANY tenant-scoped
 * JWT (no role gate) and returns the uniform multi-meter snapshot the sidebar
 * widget needs: month-to-date usage vs the plan allowance for EACH metered
 * resource (AI tokens, data ingestion, …).
 *
 * It delegates to the shared {@link buildConsumptionSnapshot} framework, which
 * reuses the same accountants + plan resolvers the gateway / ingestion gates use,
 * so the "X% used" a member SEES equals the cap that gets ENFORCED — one system.
 *
 * Cached read-through (60s): an aggregate scan over append-heavy ledgers that
 * doesn't need to be to-the-second. Keyed by tenant + calendar month so it rolls
 * over (and resets to 0) automatically at the month boundary — AND by whether the
 * caller is an unlimited superadmin operator, since that changes every limit in
 * the payload. Two entries per tenant at most, so members still share one scan;
 * keying by user instead would multiply the cache for no benefit.
 */

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import { getConsumptionSnapshot } from '../../application/consumption/meters';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

export function createConsumptionRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware); // any signed-in member — intentionally NO requireRole gate

  // ── GET /api/consumption ────────────────────────────────────────────────
  router.get('/', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string | undefined;
    return c.json(await getConsumptionSnapshot(db, c.env as Env, tenantId, userId ?? null));
  });

  return router;
}
