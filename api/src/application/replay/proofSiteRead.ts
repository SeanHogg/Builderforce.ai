/**
 * Does this workspace read its OWN live proof site? — the second clause of the
 * Insights read gate (PRD 33 D12, §5.3.1): a proof is recorded with no install, so its
 * founder can watch the visitors it is graded on. Same clause as
 * `replayEntitledForSite`, read through the same cached `isProofSite`.
 *
 * Its own module so the route gate (`insightsGate`) depends on one application port,
 * never on the site and realization reads behind it.
 */

import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { isProofSite } from '../realization/proofSite';
import { getSite } from './replaySites';

export async function readsOwnProofSite(env: Env, db: Db, tenantId: number, siteId: string): Promise<boolean> {
  const site = await getSite(env, db, siteId);
  return !!site && site.tenantId === tenantId && isProofSite(env, db, site);
}
