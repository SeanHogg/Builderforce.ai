/**
 * Erasing one visitor from Insights (PRD 33 §1.7 "deleting a visitor deletes their
 * recordings", §6 `VISITOR_DATA_ERASERS`).
 *
 * The visitor id is an opaque browser-minted id with no tenant of its own, so the
 * erase is a declared `subject_own_rows` statement: the subject of the data is the
 * id, and it is the only thing deleted. The R2 objects go first (so a failure leaves
 * rows that can be erased again rather than bytes nothing points at), then the AI
 * summaries, then the rows — issue representatives cascade with them.
 *
 * The exact daily rollups are counts with no visitor in them and are not touched.
 */

import { eq, inArray } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { replayRecordings, replayVisitSummaries } from '../../infrastructure/database/schema';
import { acrossTenants } from '../../infrastructure/database/tenantScope';
import { replayTelemetryDb } from './replayDatabase';
import { deleteRecording } from './replayChunkStore';
import { bumpSiteVersion } from './replayCacheKeys';
import { recordingLocation } from './replayRecordingWriter';

/** Delete every kept recording of `visitorId`. Returns recordings removed. */
export async function eraseReplayVisitor(env: Env, db: Db, visitorId: string): Promise<number> {
  const store = replayTelemetryDb(env, db);
  const rows = await store
    .select({
      id: replayRecordings.id,
      tenantId: replayRecordings.tenantId,
      siteId: replayRecordings.siteId,
      startedAt: replayRecordings.startedAt,
    })
    .from(replayRecordings)
    .where(acrossTenants(replayRecordings, 'subject_own_rows', eq(replayRecordings.visitorId, visitorId)));
  if (rows.length === 0) return 0;

  for (const row of rows) await deleteRecording(env, recordingLocation(row));
  const ids = rows.map((row) => row.id);
  await store.delete(replayVisitSummaries).where(inArray(replayVisitSummaries.recordingId, ids));
  await store
    .delete(replayRecordings)
    .where(acrossTenants(replayRecordings, 'subject_own_rows', eq(replayRecordings.visitorId, visitorId)));
  for (const siteId of new Set(rows.map((row) => row.siteId))) await bumpSiteVersion(env, siteId);
  return rows.length;
}
