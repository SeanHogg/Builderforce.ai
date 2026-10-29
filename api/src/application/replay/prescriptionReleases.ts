/**
 * The hosted-release half of the prescription actions (PRD 33 §5.1.4): the fix's
 * PREVIEW release, Test it (THE A/B engine, `marketing/experimentation.ts`),
 * Publish (the existing pointer move, `restoreSiteRelease`) and Revert.
 *
 * Every step that changes what visitors see is a person's: a test is created as a
 * draft and started by a person; a preview goes live only when a person publishes
 * it; Revert republishes the release that was live before.
 */

import { and, eq, ne, sql } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { abTests, abTestVariants, projectSites, replayPrescriptions, replayIssues, siteReleases } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { ConflictError, NotFoundError, ValidationError } from '../../domain/shared/errors';
import { asJsonRecord } from '../../domain/shared/json';
import {
  LIVE_VARIANT_KEY,
  PRESCRIPTION_TEST_KEY_PREFIX,
  PREVIEW_VARIANT_KEY,
} from '../../domain/replay/abSplit';
import { minimumSampleFor } from '../../domain/replay/prescriptions/impact';
import { decodeActionRef, encodeActionRef } from '../../domain/replay/prescriptions/prescriptionState';
import type { ImpactCohorts } from '../../domain/replay/prescriptions/types';
import { isUuid } from '../../domain/replay/replayScope';
import { createTest, ExperimentError, setVariants, startTest } from '../marketing/experimentation';
import type { ActorIdentity } from '../activity/activityLog';
import { appsDatabaseOf } from '../ide/appsDatabase';
import { HOSTING_APEX } from '../ide/siteHosting';
import { restoreSiteRelease } from '../ide/siteReleases';
import type { SplitVariantPayload } from '../ide/siteAbSplit';
import { bumpReplaySitesVersion, bumpSiteVersion } from './replayCacheKeys';
import { replayTelemetryDb } from './replayDatabase';
import type { PrescriptionRow } from './prescriptionReads';
import { getSite, type ReplaySiteRecord } from './replaySites';

/** The hosted app's project, or a 400 for an external site (its releases are not ours to move). */
export function hostedProjectOf(site: ReplaySiteRecord): number {
  if (site.kind !== 'hosted' || site.projectId === null) {
    throw new ValidationError('Only a Builderforce-hosted app has releases Insights can preview, test, publish or revert');
  }
  return site.projectId;
}

/** The R2 prefix of one release of the project's site. 409 when it was pruned. */
export async function releasePrefix(db: Db, tenantId: number, projectId: number, versionToken: string): Promise<string> {
  const [row] = await appsDatabaseOf(db)
    .select({ r2Prefix: siteReleases.r2Prefix })
    .from(siteReleases)
    .innerJoin(projectSites, eq(projectSites.id, siteReleases.siteId))
    .where(scopedToTenant(siteReleases, tenantId, eq(projectSites.projectId, projectId), eq(siteReleases.versionToken, versionToken)))
    .limit(1);
  if (!row) throw new ConflictError('That preview release is no longer available');
  return row.r2Prefix;
}

/** The release the site is serving now. */
export async function liveVersionToken(db: Db, tenantId: number, projectId: number): Promise<string | null> {
  const [row] = await appsDatabaseOf(db)
    .select({ versionToken: projectSites.versionToken })
    .from(projectSites)
    .where(scopedToTenant(projectSites, tenantId, eq(projectSites.projectId, projectId)))
    .limit(1);
  return row?.versionToken ?? null;
}

/** Point the hosted site at `versionToken` (the existing hosted-release flow). */
export async function moveSiteTo(env: Env, db: Db, site: ReplaySiteRecord, versionToken: string): Promise<void> {
  const projectId = hostedProjectOf(site);
  const result = await restoreSiteRelease(env, db, projectId, site.tenantId, versionToken, HOSTING_APEX);
  if (!result.ok) throw new NotFoundError('Release', versionToken);
}

const asExperimentConflict = (error: unknown): never => {
  if (error instanceof ExperimentError) {
    if (error.status === 409) throw new ConflictError(error.message);
    if (error.status === 404) throw new NotFoundError('Test', error.message);
    throw new ValidationError(error.message);
  }
  throw error;
};

/**
 * Test it: a DRAFT `ab_tests` row splitting live 50/50 against the fix's preview,
 * sized from the finding's own cohorts. Re-running it re-allocates the same draft.
 */
export async function createPrescriptionTest(db: Db, site: ReplaySiteRecord, row: PrescriptionRow, previewRelease: string): Promise<number> {
  const projectId = hostedProjectOf(site);
  const previewPrefix = await releasePrefix(db, site.tenantId, projectId, previewRelease);
  const key = `${PRESCRIPTION_TEST_KEY_PREFIX}${row.id}`;
  const [other] = await db
    .select({ id: abTests.id })
    .from(abTests)
    .innerJoin(abTestVariants, eq(abTestVariants.testId, abTests.id))
    .where(scopedToTenant(abTests, site.tenantId, and(
      eq(abTests.status, 'running'),
      ne(abTests.key, key),
      sql`${abTestVariants.payload}->>'siteId' = ${site.id}`,
    )))
    .limit(1);
  // One split per site keeps "which arm converted" answerable.
  if (other) throw new ConflictError('Another Insights test is already running on this site; conclude it first');

  const basis = asJsonRecord(row.impact).basis as ImpactCohorts | null | undefined;
  const acceptance = asJsonRecord(row.acceptance);
  let testId: number;
  try {
    const test = await createTest(db, site.tenantId, {
      key,
      name: `Insights: ${row.ruleId.replace(/_/g, ' ')}${row.pagePath ? ` on ${row.pagePath}` : ''}`,
      hypothesis: row.prescription,
      primaryMetric: typeof acceptance.metric === 'string' ? acceptance.metric : 'conversion_rate',
      minimumSample: minimumSampleFor(basis ?? null),
    });
    testId = test.id;
  } catch (error) {
    if (!(error instanceof ExperimentError) || error.status !== 409) return asExperimentConflict(error);
    const [existing] = await db.select({ id: abTests.id }).from(abTests)
      .where(scopedToTenant(abTests, site.tenantId, eq(abTests.key, key))).limit(1);
    if (!existing) return asExperimentConflict(error);
    testId = existing.id;
  }

  const shared: SplitVariantPayload = { siteId: site.id, prescriptionId: row.id, success: { smartEvent: null } };
  await setVariants(db, site.tenantId, testId, [
    { key: LIVE_VARIANT_KEY, name: 'Live', isControl: true, trafficPercent: 50, payload: { ...shared } },
    { key: PREVIEW_VARIANT_KEY, name: 'Preview', trafficPercent: 50, payload: { ...shared, versionToken: previewRelease, r2Prefix: previewPrefix } },
  ]).catch(asExperimentConflict);
  return testId;
}

/** Start it (a person's action) and switch the sites Worker's split on. */
export async function startPrescriptionTest(env: Env, db: Db, site: ReplaySiteRecord, testId: number, actor: ActorIdentity): Promise<void> {
  await startTest(db, env, site.tenantId, actor, testId).catch(asExperimentConflict);
  await bumpReplaySitesVersion(env, site.tenantId, site.id);
}

/**
 * Called by the publish route when a person's build is published as a PREVIEW for a
 * prescription (`publishPreviewRelease` + the `prescription` form field): the preview
 * is recorded on the fix (replacing an earlier one) and its issue group moves to
 * `preview`. Only a hosted fix of THIS project in THIS workspace that is still
 * `applied` is touched; returns whether it was recorded.
 */
export async function notePrescriptionPreview(
  env: Env,
  db: Db,
  input: { tenantId: number; projectId: number; prescriptionId: string; versionToken: string },
): Promise<boolean> {
  if (!isUuid(input.prescriptionId)) return false;
  const [row] = await db.select().from(replayPrescriptions).where(eq(replayPrescriptions.id, input.prescriptionId)).limit(1);
  if (!row || row.status !== 'applied' || row.actionKind !== 'fix') return false;
  const site = await getSite(env, db, row.siteId);
  if (!site || site.tenantId !== input.tenantId || site.kind !== 'hosted' || site.projectId !== input.projectId) return false;
  const refs = decodeActionRef(row.actionRef);
  await db
    .update(replayPrescriptions)
    .set({ actionRef: encodeActionRef({ ...refs, previewRelease: input.versionToken }), updatedAt: new Date() })
    .where(and(eq(replayPrescriptions.id, row.id), eq(replayPrescriptions.status, 'applied')));
  const issueId = asJsonRecord(row.finding).issueId;
  if (typeof issueId === 'string' && issueId) {
    await replayTelemetryDb(env, db)
      .update(replayIssues)
      .set({ status: 'preview', updatedAt: new Date() })
      .where(and(eq(replayIssues.tenantId, site.tenantId), eq(replayIssues.siteId, site.id), eq(replayIssues.id, issueId), eq(replayIssues.prescriptionId, row.id)));
  }
  await bumpSiteVersion(env, site.id);
  return true;
}
