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
 * over (and resets to 0) automatically at the month boundary.
 */

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import { buildConsumptionSnapshot } from '../../application/consumption/meters';
import { utcMonthStart, utcNextMonthStart } from '../../application/llm/tokenUsage';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';

export function createConsumptionRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware); // any signed-in member — intentionally NO requireRole gate

  // ── GET /api/consumption ────────────────────────────────────────────────
  router.get('/', async (c) => {
    const tenantId = c.get('tenantId') as number;

    const monthStart = utcMonthStart();
    const monthEnd = utcNextMonthStart();
    const monthKey = monthStart.toISOString().slice(0, 7); // YYYY-MM

    const payload = await getOrSetCached(
      c.env as Env,
      `consumption-meter:v2:${tenantId}:${monthKey}`,
      () => buildConsumptionSnapshot(db, tenantId, monthStart, monthEnd),
      { kvTtlSeconds: 60, l1TtlMs: 30_000 },
    );

    return c.json(payload);
  });

  return router;
}
