/**
 * May this site KEEP recordings? — the one entitlement function (PRD 33 §6 "one
 * entitlement function", §3.3 step 4).
 *
 * Clause 1 (S1): the workspace holds the Insights licence — the `sessionReplay`
 * feature, granted by the `session-replay` capability install (`heldCapabilities`),
 * resolved through the same feature gate the routes use.
 *
 * Clause 2 (S4d, §5.3.1): a project with a live realization is recorded without an
 * install. That rule is not built yet, so it is a DEPENDENCY rather than a branch:
 * S4d passes `isProofSite` and nothing here changes shape.
 *
 * Rollups do not consult this — events of every session count (§3.3 step 3); only
 * keeping a recording, which is what costs a unit, does.
 */

import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { tenantHasFeature } from '../tenant/featureEntitlements';
import type { ReplaySiteRecord } from './replaySites';

export interface ReplayEntitlementDeps {
  /** S4d: true when the site is a project with a live realization (§5.3.1). */
  isProofSite?: (env: Env, db: Db, site: ReplaySiteRecord) => Promise<boolean>;
}

export async function replayEntitledForSite(
  env: Env,
  db: Db,
  site: ReplaySiteRecord,
  deps: ReplayEntitlementDeps = {},
): Promise<boolean> {
  // No user: a machine decision, so the superadmin dimension never applies (D17 —
  // no unmetered back door).
  if (await tenantHasFeature(env, site.tenantId, null, 'sessionReplay')) return true;
  if (deps.isProofSite) return deps.isProofSite(env, db, site);
  return false;
}
