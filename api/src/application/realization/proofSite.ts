/**
 * Proof sites are recorded without an install (PRD 33 D12, §5.3.1).
 *
 * `isProofSite` is the S4d clause of THE entitlement function
 * (`replayEntitledForSite`): a hosted site whose project carries a LIVE proof —
 * built, published, declaring a `ProofMeasure` and not yet graded. Requiring a
 * measure is deliberate: a measured proof is graded at its window's end, so the
 * free recording ends with the question it was answering; a proof with no measure
 * would never be graded by visitors and would turn "prove it" into an unmetered
 * back door to Insights for a whole app. One cached lookup per site.
 *
 * `ensureProofReplaySite` gives a published proof its hosted `replay_sites` row
 * (idempotent; an existing site — even one a person switched off — is left as is).
 */

import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { realizations } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { proofSiteKey } from '../replay/replayCacheKeys';
import { createHostedSite, projectSiteDto } from '../replay/replaySiteAdmin';
import type { ReplaySiteRecord } from '../replay/replaySites';
import { reportCaughtError } from '../observability/caughtErrorReporter';

const SOURCE = 'application/realization/proofSite.ts';
const TTL = { kvTtlSeconds: 600, l1TtlMs: 60_000 };

/** A project with a live, measured, ungraded proof. */
export async function projectHasLiveProof(db: Db, tenantId: number, projectId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: realizations.id })
    .from(realizations)
    .where(scopedToTenant(realizations, tenantId, and(
      eq(realizations.projectId, projectId),
      eq(realizations.status, 'built'),
      isNotNull(realizations.liveUrl),
      isNotNull(realizations.measure),
      isNull(realizations.verdict),
    )))
    .limit(1);
  return !!row;
}

/** The `isProofSite` dependency of `replayEntitledForSite`. */
export async function isProofSite(env: Env, db: Db, site: ReplaySiteRecord): Promise<boolean> {
  if (site.kind !== 'hosted' || site.projectId === null) return false;
  const projectId = site.projectId;
  return getOrSetCached(env, proofSiteKey(site.id), () => projectHasLiveProof(db, site.tenantId, projectId), TTL);
}

/**
 * After a proof is published: make sure its project has a hosted Insights site, and
 * drop the cached "is this a proof site" answer so the next config request sees it.
 * Never throws — recording is a measurement, and it must not fail a build.
 */
export async function ensureProofReplaySite(
  env: Env,
  db: Db,
  input: { tenantId: number; projectId: number; userId: string | null },
): Promise<string | null> {
  try {
    const existing = await projectSiteDto(env, db, input.tenantId, input.projectId);
    const site = existing ?? await createHostedSite(db, env, {
      tenantId: input.tenantId,
      projectId: input.projectId,
      userId: input.userId ?? '',
    });
    await invalidateCached(env, proofSiteKey(site.id));
    return site.id;
  } catch (error) {
    reportCaughtError(error, { source: SOURCE, operation: 'ensureProofReplaySite', context: { projectId: input.projectId } });
    return null;
  }
}
