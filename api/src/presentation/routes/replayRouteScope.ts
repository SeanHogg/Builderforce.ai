/**
 * The guards every `/api/replay/*` data router shares (PRD 33 §3, D17): the Insights
 * feature gate and the `?site=` scope. One copy, so the reads, the heatmap and the
 * export routers cannot disagree about who may read which site.
 *
 * Attached PER ROUTE (never `router.use('*')`): several routers share the
 * `/api/replay` prefix, and a blanket guard on one would wrap paths it does not own.
 */
import type { Context, MiddlewareHandler } from 'hono';
import type { HonoEnv } from '../../env';
import { requestDb } from '../../application/shared/dbHandle';
import { getSite, getSiteForTenant } from '../../application/replay/replaySites';
import { isProofSite } from '../../application/realization/proofSite';
import type { ReplayScope } from '../../domain/replay/replayScope';
import { ValidationError } from '../../domain/shared/errors';
import { requireFeature } from '../middleware/featureGate';
import { optionalTenantId, requireTenantId } from '../middleware/tenantContext';

/**
 * 403 `capability_required` unless the workspace holds Insights — or the `?site=` it
 * reads is its own live proof site (D12, §5.3.1): a proof is recorded with no install,
 * so its founder can watch the visitors it is graded on. Same clause as
 * `replayEntitledForSite`, read through the same cached `isProofSite`.
 */
export const insightsGate: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const gate = await requireFeature(c, 'sessionReplay');
  if (gate && !(await readsOwnProofSite(c))) return gate;
  await next();
};

async function readsOwnProofSite(c: Context<HonoEnv>): Promise<boolean> {
  const tenantId = optionalTenantId(c);
  const siteId = c.req.query('site');
  if (tenantId == null || !siteId) return false;
  const db = requestDb(c);
  const site = await getSite(c.env, db, siteId);
  return !!site && site.tenantId === tenantId && isProofSite(c.env, db, site);
}

/** The caller's scope for `?site=`: 400 when absent, 403 when not this workspace's. */
export async function replayScopeOf(c: Context<HonoEnv>): Promise<ReplayScope> {
  const tenantId = requireTenantId(c);
  const siteId = c.req.query('site');
  if (!siteId) throw new ValidationError('site is required');
  const site = await getSiteForTenant(c.env, requestDb(c), tenantId, siteId);
  return { tenantId, siteId: site.id };
}

/** A numeric query value, or undefined when absent or not a number. */
export const optionalNumber = (raw: string | undefined): number | undefined => {
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
};
