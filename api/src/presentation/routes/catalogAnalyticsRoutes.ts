/**
 * Catalog adoption analytics — /api/catalog-analytics
 *
 * The over-time companion to the catalog counter strip (CatalogInsightsBar). One
 * endpoint per catalog kind returns a daily installs/usage series + top-N adopted
 * items, so Skills / Personas / Prompts each get the "insights everywhere"
 * treatment from the timestamped adoption rows they already capture.
 *
 *   GET /skills?window=      adoption trend for skill artifacts        [member]
 *   GET /personas?window=    adoption trend for persona artifacts      [member]
 *   GET /prompts?window=     adoption trend for prompt-library entries [member]
 *
 * Tenant-scoped (JWT). Short TTL over hot adoption tables, with a version token
 * (bumped by recordCatalogAdoption on each live event) folded into the key so a
 * fresh install/use refreshes immediately.
 */

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import { getOrSetCached, getCacheVersion } from '../../infrastructure/cache/readThroughCache';
import {
  computeCatalogAnalytics,
  toCatalogKind,
  catalogAnalyticsVersionKey,
} from '../../application/insights/catalogAnalytics';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

const SHORT_TTL = { kvTtlSeconds: 60, l1TtlMs: 15_000 };

/** Clamp `?window=` (days) to 1..365, default 30. */
function parseWindow(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 && n <= 365 ? Math.floor(n) : 30;
}

export function createCatalogAnalyticsRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  router.get('/:kind', async (c) => {
    const kind = toCatalogKind(c.req.param('kind'));
    if (!kind) return c.json({ error: 'kind must be skills | personas | prompts' }, 400);

    const tenantId = c.get('tenantId') as number;
    const windowDays = parseWindow(c.req.query('window'));
    const env = c.env as Env;

    const ver = await getCacheVersion(env, catalogAnalyticsVersionKey(tenantId));
    const key = `catalog-analytics:t:${tenantId}:k:${kind}:w:${windowDays}:v:${ver}`;
    return c.json(await getOrSetCached(env, key, () => computeCatalogAnalytics(db, tenantId, kind, windowDays), SHORT_TTL));
  });

  return router;
}
