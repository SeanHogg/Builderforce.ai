/**
 * Insights retention (PRD 33 D3, §6 "Privacy").
 *
 * Three windows, three owners:
 *   • the daily ROLLUPS keep 13 months — plain age windows, declared in
 *     `maintenance/sweptTables.ts` like every other log table;
 *   • a kept RECORDING lives for its site's `retentionDays` (30 by default, at most
 *     90) — a per-site window, so it cannot be a registry row: it is this module's
 *     {@link purgeExpiredRecordings}, run by the daily retention purge, plus the R2
 *     day-prefix sweep for its bytes (the registry's 90-day entry is the backstop for
 *     rows whose site no longer exists);
 *   • an MP4 EXPORT (row and file) lives seven days — `purgeExpiredExports`;
 *   • LIVE presence older than five minutes is purged by ingest itself (once a minute
 *     per site, piggybacked on the cache-version gate) and by the daily sweep.
 */

import { and, eq, inArray, isNotNull, lt } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { replayLive, replayRecordings, replaySites } from '../../infrastructure/database/schema';
import { acrossTenants } from '../../infrastructure/database/tenantScope';
import { DAY_MS, MINUTE_MS } from '../../domain/shared/time';
import type { ReplayScope } from '../../domain/replay/replayScope';
import { replayTelemetryDb } from './replayDatabase';
import { deleteOlderThan } from './replayChunkStore';
import { purgeExpiredExports } from './replayExportStore';
import { MAX_RETENTION_DAYS, siteSettings } from './replaySites';

/** Presence older than this is not "live". */
export const LIVE_TTL_MS = 5 * MINUTE_MS;
/** Daily rollups keep 13 months (D3). */
export const ROLLUP_RETENTION_DAYS = 400;

const SITE_BATCH = 500;

/** Delete presence rows older than five minutes — one site's, or every site's. */
export async function purgeStaleLive(env: Env | undefined, db: Db, now: Date, scope?: ReplayScope): Promise<void> {
  const cutoff = new Date(now.getTime() - LIVE_TTL_MS);
  const store = replayTelemetryDb(env, db);
  if (scope) {
    await store.delete(replayLive).where(and(
      eq(replayLive.tenantId, scope.tenantId),
      eq(replayLive.siteId, scope.siteId),
      lt(replayLive.lastSeenAt, cutoff),
    ));
    return;
  }
  await store.delete(replayLive).where(acrossTenants(replayLive, 'scheduled_sweep', lt(replayLive.lastSeenAt, cutoff)));
}

/** Every site's retention window in days, grouped: days → site ids. */
async function retentionGroups(db: Db): Promise<{ bySite: Map<string, number>; byDays: Map<number, string[]> }> {
  const rows = await db
    .select({ id: replaySites.id, settings: replaySites.settings })
    .from(replaySites)
    // Retention is a platform policy applied to every workspace's sites.
    .where(acrossTenants(replaySites, 'scheduled_sweep', isNotNull(replaySites.id)));
  const bySite = new Map<string, number>();
  const byDays = new Map<number, string[]>();
  for (const row of rows) {
    const days = siteSettings(row.settings).retentionDays;
    bySite.set(row.id, days);
    const ids = byDays.get(days) ?? [];
    ids.push(row.id);
    byDays.set(days, ids);
  }
  return { bySite, byDays };
}

/**
 * Delete recordings past their site's window — the rows (summaries and issue
 * representatives cascade with them) and the R2 day-prefixes holding their bytes.
 * Returns rows and objects removed.
 */
export async function purgeExpiredRecordings(env: Env, db: Db, now: Date): Promise<{ rows: number; objects: number }> {
  const { bySite, byDays } = await retentionGroups(db);
  const store = replayTelemetryDb(env, db);
  let rows = 0;
  for (const [days, siteIds] of byDays) {
    const cutoff = new Date(now.getTime() - days * DAY_MS);
    for (let i = 0; i < siteIds.length; i += SITE_BATCH) {
      const removed = await store
        .delete(replayRecordings)
        .where(acrossTenants(
          replayRecordings,
          'scheduled_sweep',
          inArray(replayRecordings.siteId, siteIds.slice(i, i + SITE_BATCH)),
          lt(replayRecordings.startedAt, cutoff),
        ))
        .returning({ id: replayRecordings.id });
      rows += removed.length;
    }
  }
  // A site that no longer exists keeps nothing past the longest window.
  const objects = await deleteOlderThan(env, (_tenantId, siteId) =>
    new Date(now.getTime() - (bySite.get(siteId) ?? MAX_RETENTION_DAYS) * DAY_MS));
  return { rows, objects };
}

/** The daily retention pass for Insights: recordings + their bytes, MP4 exports, then stale presence. */
export async function runReplayRetention(env: Env, db: Db, now: Date): Promise<void> {
  await purgeExpiredRecordings(env, db, now);
  await purgeExpiredExports(env, db, now);
  await purgeStaleLive(env, db, now);
}
