/**
 * EMP finops lens — additional router mounted on /api/finops.
 *
 * Kept in a NEW module (mounted alongside createFinopsRoutes on the shared prefix)
 * so the existing finops routes are untouched:
 *
 *   GET /rd-reconciliation?fy=   derived (QRE) vs reported (manual quarterly) R&D
 *                                spend side-by-side with variance            [manager, cached]
 */

import { Hono } from 'hono';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import { scope } from './segmentTrackerRoutes';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { getCacheVersion } from '../../infrastructure/cache/readThroughCache';
import { rdFinancialsVersionKey } from '../../application/insights/versionKeys';
import { reconcileRd } from '../../application/finops/rdReconciliation';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

const SHORT_TTL = { kvTtlSeconds: 60, l1TtlMs: 15_000 };

/** Parse `?fy=` → 4-digit fiscal year, default current UTC year. */
function parseFiscalYear(raw: string | undefined, now: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : new Date(now).getUTCFullYear();
}

export function createEmpFinopsRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // Derived-vs-reported R&D reconciliation. Cached on a short TTL with the R&D
  // financials version token folded in, so a manual quarterly-fact edit refreshes it.
  router.get('/rd-reconciliation', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId } = scope(c);
    const env = c.env as Env;
    const fy = parseFiscalYear(c.req.query('fy'), Date.now());
    const ver = await getCacheVersion(env, rdFinancialsVersionKey(tenantId));
    const key = `finops:rdrecon:t:${tenantId}:fy:${fy}:v:${ver}`;
    return c.json(await getOrSetCached(env, key, () => reconcileRd(db, tenantId, fy), SHORT_TTL));
  });

  return router;
}
