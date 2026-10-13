/**
 * What a NEW RELEASE sets off for the page review (PRD 33 §5.2, §5.1.5):
 *
 *   onReleasesFirstSeen   ingest saw a release for the first time → queue its key
 *                         pages' captures, and start measuring every fix a person
 *                         applied by hand (`action_ref = 'manual'`): that release is
 *                         the one that shipped it (`p=<release>`, status `measuring`)
 *   noteComposerPublish   a hosted canvas app published → its `apply-in-composer`
 *                         fixes (`action_ref = 'composer'`) are measured on the
 *                         release the publish made (`p=<versionToken>`)
 * Their verdict is `prescriptionReleaseEffect.viaReleaseEffect`.
 *
 * Every hook is best-effort: a release or a publish never fails because of Insights.
 */

import { and, eq } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { replayPrescriptions } from '../../infrastructure/database/schema';
import { EMPTY_REFS, encodeActionRef } from '../../domain/replay/prescriptions/prescriptionState';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { queueReleaseCaptures } from './pageCapture';
import { COMPOSER_ACTION_REF, MANUAL_ACTION_REF } from './prescriptionPageActions';
import { bumpSiteVersion } from './replayCacheKeys';
import { getSite, listSitesForTenant, type ReplaySiteRecord } from './replaySites';

const SOURCE = 'application/replay/prescriptionReleaseHooks.ts';

export interface FirstSeenRelease {
  siteId: string;
  tenantId: number;
  releaseKey: string;
}

/** Move the site's pending hand-applied fixes (`pending` marker) onto the release that shipped them. */
export async function startReleaseMeasurement(
  env: Env,
  db: Db,
  site: ReplaySiteRecord,
  pending: typeof MANUAL_ACTION_REF | typeof COMPOSER_ACTION_REF,
  releaseKey: string,
  now: Date = new Date(),
): Promise<number> {
  const actionRef = encodeActionRef({ ...EMPTY_REFS, previewRelease: releaseKey });
  // A release key the ref column cannot carry is left pending rather than measured blind.
  if (!actionRef) return 0;
  const moved = await db
    .update(replayPrescriptions)
    .set({ actionRef, status: 'measuring', updatedAt: now })
    .where(and(
      eq(replayPrescriptions.siteId, site.id),
      eq(replayPrescriptions.status, 'applied'),
      eq(replayPrescriptions.actionRef, pending),
    ))
    .returning({ id: replayPrescriptions.id });
  if (moved.length > 0) await bumpSiteVersion(env, site.id);
  return moved.length;
}

/** Ingest's first sight of releases. Never throws. */
export async function onReleasesFirstSeen(env: Env, db: Db, releases: readonly FirstSeenRelease[], now: Date = new Date()): Promise<void> {
  for (const release of releases) {
    try {
      const site = await getSite(env, db, release.siteId);
      if (!site || site.tenantId !== release.tenantId || site.status !== 'active') continue;
      await startReleaseMeasurement(env, db, site, MANUAL_ACTION_REF, release.releaseKey, now);
      await queueReleaseCaptures(env, db, site, release.releaseKey, now);
    } catch (error) {
      reportCaughtError(error, { source: SOURCE, operation: 'onReleasesFirstSeen', context: { siteId: release.siteId } });
    }
  }
}

/** A hosted app published `versionToken` (the canvas publish). Never throws. */
export async function noteComposerPublish(env: Env, db: Db, input: { tenantId: number; projectId: number; versionToken: string }): Promise<void> {
  try {
    const site = (await listSitesForTenant(env, db, input.tenantId)).find((s) => s.kind === 'hosted' && s.projectId === input.projectId);
    if (!site) return;
    await startReleaseMeasurement(env, db, site, COMPOSER_ACTION_REF, input.versionToken);
  } catch (error) {
    reportCaughtError(error, { source: SOURCE, operation: 'noteComposerPublish', context: { projectId: input.projectId } });
  }
}
