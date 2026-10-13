/**
 * Page review READS (PRD 33 §5.2): the scored key-page list, one page's review and a
 * capture's stored assets. Every read goes through `getOrSetCached` under the site's
 * version token (a capture, a sweep, an action or a render bumps it); assets stream
 * from R2 privately.
 */

import type {
  ReplayPageListDto,
  ReplayPageReviewDto,
  ReplayPrescriptionDto,
} from '@builderforce/interaction-contract';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { NotFoundError, ValidationError } from '../../domain/shared/errors';
import type { ReplayScope } from '../../domain/replay/replayScope';
import {
  afterAssetKey,
  AFTER_ASSETS,
  captureAssetUrl,
  findCapture,
  isAfterAsset,
  isCaptureAsset,
  listCaptures,
  scoreOf,
  streamObject,
  toCaptureDto,
  type CaptureRow,
} from './pageCaptureStore';
import { newestCaptures } from './pageAggregates';
import { pagesToReview } from './pageSelection';
import { loadPrescriptionRow, listPrescriptions } from './prescriptionReads';
import { ReplayReadService } from './ReplayReadService';
import { replayReadKeys } from './replayCacheKeys';

const TTL = { kvTtlSeconds: 300, l1TtlMs: 30_000 };
const OPEN = new Set(['proposed', 'applied', 'measuring']);
const CAPTURES_PER_PAGE = 40;

/** What an open fix is worth for ranking pages: the estimate, else the top of its range. */
export const opportunityOf = (rx: ReplayPrescriptionDto): number =>
  Math.max(0, rx.impact.estimate ?? rx.impact.high ?? 0);

/** The mean total of a set of captures' scores, or null. */
function meanScore(rows: readonly CaptureRow[]): number | null {
  const totals = rows.map((r) => scoreOf(r.score)?.total).filter((t): t is number => typeof t === 'number');
  return totals.length ? Math.round(totals.reduce((a, b) => a + b, 0) / totals.length) : null;
}

/** Pure: the key pages, scored and ranked by the opportunity of their open fixes. */
export function foldPageList(
  paths: readonly string[],
  captures: readonly CaptureRow[],
  prescriptions: readonly ReplayPrescriptionDto[],
): ReplayPageListDto {
  const newest = newestCaptures(captures);
  return paths.map((path) => {
    const devices = newest.get(path) ?? {};
    const open = prescriptions.filter((rx) => rx.pagePath === path && OPEN.has(rx.status)); // already ranked
    const fold = devices.desktop ?? devices.phone;
    return {
      path,
      score: meanScore([devices.desktop, devices.phone].filter((r): r is CaptureRow => !!r)),
      topPrescriptionId: open[0]?.id ?? null,
      foldThumbUrl: fold?.foldScreenshotKey ? captureAssetUrl(fold.siteId, fold.id, 'fold') : null,
      opportunity: Math.round(open.reduce((sum, rx) => sum + opportunityOf(rx), 0) * 10) / 10,
    };
  }).sort((a, b) => b.opportunity - a.opportunity || a.path.localeCompare(b.path));
}

export async function listPages(env: Env, db: Db, scope: ReplayScope): Promise<ReplayPageListDto> {
  const keys = await replayReadKeys(env, scope);
  return getOrSetCached(env, keys.pages(), async () => {
    const paths = await pagesToReview(env, db, scope);
    const [captures, prescriptions] = await Promise.all([
      listCaptures(db, scope.siteId, { paths }),
      listPrescriptions(env, db, scope),
    ]);
    return foldPageList(paths, captures, prescriptions);
  }, TTL);
}

export async function pageReview(env: Env, db: Db, scope: ReplayScope, rawPath: string): Promise<ReplayPageReviewDto> {
  const path = rawPath.trim();
  if (!path.startsWith('/') || path.length > 400) throw new ValidationError('path must be a page path starting with /');
  const keys = await replayReadKeys(env, scope);
  return getOrSetCached(env, keys.pageReview(path), async () => {
    const [captures, prescriptions, releases] = await Promise.all([
      listCaptures(db, scope.siteId, { paths: [path], limit: CAPTURES_PER_PAGE }),
      listPrescriptions(env, db, scope),
      new ReplayReadService(env, db).releases(scope),
    ]);
    const byRelease = new Map<string, CaptureRow[]>();
    for (const c of captures) byRelease.set(c.releaseKey, [...(byRelease.get(c.releaseKey) ?? []), c]);
    const scoreByRelease: ReplayPageReviewDto['scoreByRelease'] = releases
      .filter((r) => byRelease.has(r.releaseKey))
      .map((r) => ({ releaseKey: r.releaseKey, label: r.label ?? `R${r.ordinal}`, score: meanScore(byRelease.get(r.releaseKey)!) }));
    // A capture taken before the site had any release is keyed ''.
    if (byRelease.has('')) scoreByRelease.push({ releaseKey: '', label: null, score: meanScore(byRelease.get('')!) });
    return {
      path,
      captures: captures.map(toCaptureDto),
      prescriptions: prescriptions.filter((rx) => rx.pagePath === path),
      scoreByRelease,
    };
  }, TTL);
}

/**
 * One stored asset of a capture: `screenshot` | `fold` | `rects`, or a fix's after
 * render (`after-desktop` | `after-phone`, with `prescriptionId` — the fix must have
 * been read from this capture). 404 for anything outside the scope.
 */
export async function captureAsset(
  env: Env,
  db: Db,
  scope: ReplayScope,
  captureId: string,
  asset: string,
  prescriptionId: string | null,
): Promise<{ body: ReadableStream; contentType: string; size: number }> {
  const capture = await findCapture(db, scope, captureId);
  if (isCaptureAsset(asset)) {
    const key = asset === 'screenshot' ? capture.screenshotKey : asset === 'fold' ? capture.foldScreenshotKey : capture.rectMapKey;
    return streamObject(env, key, asset);
  }
  if (isAfterAsset(asset)) {
    if (!prescriptionId) throw new ValidationError('prescription is required for an after render');
    const row = await loadPrescriptionRow(db, scope, prescriptionId);
    if (row.captureId !== capture.id) throw new NotFoundError('After render', prescriptionId);
    return streamObject(env, afterAssetKey({ tenantId: scope.tenantId, siteId: scope.siteId, prescriptionId: row.id, device: AFTER_ASSETS[asset] }), asset);
  }
  throw new NotFoundError('Asset', asset);
}
