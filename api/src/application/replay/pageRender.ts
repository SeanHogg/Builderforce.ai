/**
 * The AFTER render of a page-review fix (PRD 33 §5.2 "Render") — THE runner's
 * `page_render_after` job: load the captured page at both sizes, apply the fix's
 * validated patch with the page kit's `applyVisualPatch`, screenshot, upload.
 *
 *   requestRender      queue the job for one fix with a renderable patch
 *   storeRenderAsset   the runner uploads one device's screenshot (its token names the fix)
 *   recordRender       the runner reports which devices it rendered → `visual.afterScreenshotUrls`
 *
 * Nothing here touches the live site: the patch only ever runs inside the runner's
 * sandboxed browser.
 */

import { and, eq } from 'drizzle-orm';
import { REPLAY_PAGE_KIT_GLOBAL, type ReplayCaptureDevice } from '@builderforce/interaction-contract';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { replayPrescriptions } from '../../infrastructure/database/schema';
import { NotFoundError, UnauthorizedError } from '../../domain/shared/errors';
import { dispatchQaRunnerJob, qaRunnerProvisioned } from '../qa/dispatchQaRunner';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { loadRecorderManifest } from './ReplayConfigService';
import { CAPTURE_VIEWPORTS, pageKitUrl, siteOrigin } from './pageCapture';
import { afterAssetKey, afterUploadLimits, captureAssetUrl, putObject } from './pageCaptureStore';
import { hasRenderableOps, visualOf } from './pageVisual';
import { mintRenderToken, PAGE_RUNNER_PREFIX, type RenderClaims } from './pageRunnerTokens';
import { bumpSiteVersion } from './replayCacheKeys';
import type { PrescriptionRow } from './prescriptionReads';
import { getSite, type ReplaySiteRecord } from './replaySites';

const SOURCE = 'application/replay/pageRender.ts';
export const PAGE_RENDER_JOB = 'page_render_after';

/** Queue the after-render of one fix. False when it cannot run (no runner, kit, origin or patch). Never throws. */
export async function requestRender(env: Env, db: Db, site: ReplaySiteRecord, row: Pick<PrescriptionRow, 'id' | 'pagePath' | 'visual'>, now: Date = new Date()): Promise<boolean> {
  try {
    const visual = visualOf(row.visual);
    if (!hasRenderableOps(visual) || !row.pagePath || !qaRunnerProvisioned(env)) return false;
    const kit = pageKitUrl(await loadRecorderManifest(env));
    const origin = kit ? await siteOrigin(env, db, site) : null;
    if (!kit || !origin) return false;
    const base = (env.INTERNAL_API_BASE_URL ?? 'https://api.builderforce.ai').replace(/\/$/, '');
    return await dispatchQaRunnerJob(env, {
      kind: PAGE_RENDER_JOB,
      jobId: row.id,
      payload: {
        renderToken: await mintRenderToken(env, { tenantId: site.tenantId, siteId: site.id, prescriptionId: row.id }, now),
        prescriptionId: row.id,
        url: `${origin}${row.pagePath}`,
        patch: visual.patch,
        origin,
        viewports: CAPTURE_VIEWPORTS,
        renderUrl: `${base}${PAGE_RUNNER_PREFIX}/render/${encodeURIComponent(row.id)}`,
        pageKitUrl: kit,
        pageKitGlobal: REPLAY_PAGE_KIT_GLOBAL,
      },
    });
  } catch (error) {
    reportCaughtError(error, { source: SOURCE, operation: 'requestRender', context: { siteId: site.id } });
    return false;
  }
}

async function rowFor(env: Env, db: Db, claims: RenderClaims): Promise<{ row: PrescriptionRow; site: ReplaySiteRecord }> {
  const site = await getSite(env, db, claims.sid);
  if (!site || site.tenantId !== claims.xt) throw new UnauthorizedError('The render token names a site outside its workspace');
  const [row] = await db
    .select()
    .from(replayPrescriptions)
    .where(and(eq(replayPrescriptions.siteId, site.id), eq(replayPrescriptions.id, claims.pid)))
    .limit(1);
  if (!row) throw new NotFoundError('Prescription', claims.pid);
  return { row, site };
}

/** One device's after screenshot (`image/jpeg`). */
export async function storeRenderAsset(
  env: Env,
  db: Db,
  claims: RenderClaims,
  device: ReplayCaptureDevice,
  input: { contentType: string | undefined; body: ArrayBuffer },
): Promise<void> {
  const { site } = await rowFor(env, db, claims);
  await putObject(env, afterAssetKey({ tenantId: site.tenantId, siteId: site.id, prescriptionId: claims.pid, device }), {
    contentType: input.contentType,
    body: input.body,
    ...afterUploadLimits,
  });
}

/** The runner rendered `devices`: point the visual's after URLs at them. */
export async function recordRender(env: Env, db: Db, claims: RenderClaims, devices: readonly ReplayCaptureDevice[]): Promise<{ updated: boolean }> {
  const { row, site } = await rowFor(env, db, claims);
  const visual = visualOf(row.visual);
  if (!visual || !row.captureId || devices.length === 0) return { updated: false };
  const urls = { ...visual.afterScreenshotUrls };
  for (const device of devices) {
    urls[device] = `${captureAssetUrl(site.id, row.captureId, device === 'phone' ? 'after-phone' : 'after-desktop')}&prescription=${encodeURIComponent(row.id)}`;
  }
  await db
    .update(replayPrescriptions)
    .set({ visual: { ...visual, afterScreenshotUrls: urls }, updatedAt: new Date() })
    .where(and(eq(replayPrescriptions.siteId, site.id), eq(replayPrescriptions.id, row.id)));
  await bumpSiteVersion(env, site.id);
  return { updated: true };
}
