/**
 * Page-review capture retention (PRD 33 §6 "Privacy", D3) — the R2 prefix sweep and
 * row purge for `replay/pages/t<tenant>/<site>/…` (`siteCapturePrefix`).
 *
 * A capture is the page as the runner saw it, never a visitor's data, but it is still
 * the site's content and it must not outlive the site's own window: a capture (row and
 * screenshots, fold, rect map, after renders) lives for the site's `retentionDays` or
 * {@link CAPTURE_MIN_RETENTION_DAYS}, whichever is longer — long enough to compare a
 * page across the releases a fix is measured on. A site that no longer exists keeps
 * nothing: its rows went with it (`ON DELETE CASCADE`), so its objects are deleted
 * whole on the next pass.
 *
 * Run by the daily Insights retention pass (`replayRetention.runReplayRetention`).
 */

import { and, inArray, isNotNull, lt } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { replayPageCaptures, replaySites } from '../../infrastructure/database/schema';
import { acrossTenants } from '../../infrastructure/database/tenantScope';
import { DAY_MS } from '../../domain/shared/time';
import { listPrefixes } from './replayChunkStore';
import { PAGE_CAPTURE_PREFIX, siteCapturePrefix } from './pageCaptureStore';
import { siteSettings } from './replaySites';

/** Captures are kept at least this long (the comparison window of a page review). */
export const CAPTURE_MIN_RETENTION_DAYS = 90;

const SITE_BATCH = 500;
const DELETE_BATCH = 1_000;

/** A site's capture window in days: its retention or the minimum, whichever is longer. */
export const captureRetentionDays = (siteRetentionDays: number): number => Math.max(siteRetentionDays, CAPTURE_MIN_RETENTION_DAYS);

interface SiteWindow {
  tenantId: number;
  days: number;
}

/** Delete every object under `prefix` uploaded before `cutoff` (all of them when `cutoff` is null). */
async function deleteObjectsBefore(store: R2Bucket, prefix: string, cutoff: Date | null): Promise<number> {
  const doomed: string[] = [];
  let cursor: string | undefined;
  do {
    const listed = await store.list({ prefix, cursor });
    for (const object of listed.objects) {
      if (cutoff === null || object.uploaded.getTime() < cutoff.getTime()) doomed.push(object.key);
    }
    cursor = listed.truncated ? (listed as { cursor?: string }).cursor : undefined;
  } while (cursor);
  for (let i = 0; i < doomed.length; i += DELETE_BATCH) await store.delete(doomed.slice(i, i + DELETE_BATCH));
  return doomed.length;
}

/**
 * Delete captures past their site's window: the rows (a prescription's `capture_id`
 * is set null by the FK) and the R2 objects, plus every object of a site that no
 * longer exists. Returns rows and objects removed.
 */
export async function purgeExpiredCaptures(env: Env, db: Db, now: Date): Promise<{ rows: number; objects: number }> {
  const sites = await db
    .select({ id: replaySites.id, tenantId: replaySites.tenantId, settings: replaySites.settings })
    .from(replaySites)
    // Retention is a platform policy applied to every workspace's sites.
    .where(acrossTenants(replaySites, 'scheduled_sweep', isNotNull(replaySites.id)));
  const windows = new Map<string, SiteWindow>();
  const byDays = new Map<number, string[]>();
  for (const site of sites) {
    const days = captureRetentionDays(siteSettings(site.settings).retentionDays);
    windows.set(site.id, { tenantId: site.tenantId, days });
    const ids = byDays.get(days) ?? [];
    ids.push(site.id);
    byDays.set(days, ids);
  }

  let rows = 0;
  for (const [days, siteIds] of byDays) {
    const cutoff = new Date(now.getTime() - days * DAY_MS);
    for (let i = 0; i < siteIds.length; i += SITE_BATCH) {
      const removed = await db
        .delete(replayPageCaptures)
        .where(and(inArray(replayPageCaptures.siteId, siteIds.slice(i, i + SITE_BATCH)), lt(replayPageCaptures.capturedAt, cutoff)))
        .returning({ id: replayPageCaptures.id });
      rows += removed.length;
    }
  }

  const store = env.UPLOADS;
  if (!store) return { rows, objects: 0 };
  let objects = 0;
  // Known sites: their own prefix, object by object against the site's window.
  for (const [siteId, window] of windows) {
    objects += await deleteObjectsBefore(store, siteCapturePrefix(window.tenantId, siteId), new Date(now.getTime() - window.days * DAY_MS));
  }
  // Sites that no longer exist: everything under their prefix.
  for (const tenantPrefix of await listPrefixes(store, PAGE_CAPTURE_PREFIX)) {
    if (!/\/t\d+\/$/.test(tenantPrefix)) continue;
    for (const sitePrefix of await listPrefixes(store, tenantPrefix)) {
      const siteId = sitePrefix.slice(tenantPrefix.length, -1);
      if (!windows.has(siteId)) objects += await deleteObjectsBefore(store, sitePrefix, null);
    }
  }
  return { rows, objects };
}
