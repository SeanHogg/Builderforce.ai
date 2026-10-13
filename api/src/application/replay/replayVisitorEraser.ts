/**
 * Erasing one visitor from Insights (PRD 33 §1.7 "deleting a visitor deletes their
 * recordings", §6 `VISITOR_DATA_ERASERS`).
 *
 * ALWAYS scoped (D17). A visitor id is an opaque browser-minted id, and the same
 * id can turn up on several customers' sites; each customer is the controller of
 * its own visitors' data, so an erase reaches only the scope it is given:
 *
 *   - a member's erase (`DELETE /api/replay/visitors/:visitorId?site=`) passes the
 *     `{ tenantId, siteId }` it read the visitor on;
 *   - the operator's erase (the admin guest-session drawer, through
 *     `VISITOR_DATA_ERASERS`) passes the Builderforce workspace(s) the operator is a
 *     member of (`operatorWorkspaces.ts`) — never every tenant.
 *
 * The R2 objects go first (so a failure leaves rows that can be erased again rather
 * than bytes nothing points at), then the AI summaries, then the rows — issue
 * representatives cascade with them. The exact daily rollups are counts with no
 * visitor in them and are not touched.
 */

import { and, eq, inArray } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { replayRecordings, replayVisitSummaries } from '../../infrastructure/database/schema';
import type { ReplayScope } from '../../domain/replay/replayScope';
import { replayTelemetryDb } from './replayDatabase';
import { deleteRecording } from './replayChunkStore';
import { bumpSiteVersion } from './replayCacheKeys';
import { recordingLocation } from './replayRecordingWriter';

/** One site of one workspace, or every site of the listed workspaces. */
export type ReplayEraseScope = ReplayScope | { tenantIds: readonly number[] };

/** Delete every kept recording of `visitorId` inside `scope`. Returns recordings removed. */
export async function eraseReplayVisitor(env: Env, db: Db, visitorId: string, scope: ReplayEraseScope): Promise<number> {
  if ('tenantIds' in scope && scope.tenantIds.length === 0) return 0;
  const owned = 'tenantIds' in scope
    ? and(inArray(replayRecordings.tenantId, [...scope.tenantIds]), eq(replayRecordings.visitorId, visitorId))
    : and(eq(replayRecordings.tenantId, scope.tenantId), eq(replayRecordings.siteId, scope.siteId), eq(replayRecordings.visitorId, visitorId));
  const store = replayTelemetryDb(env, db);
  const rows = await store
    .select({
      id: replayRecordings.id,
      tenantId: replayRecordings.tenantId,
      siteId: replayRecordings.siteId,
      startedAt: replayRecordings.startedAt,
    })
    .from(replayRecordings)
    .where(owned);
  if (rows.length === 0) return 0;

  for (const row of rows) await deleteRecording(env, recordingLocation(row));
  const ids = rows.map((row) => row.id);
  await store.delete(replayVisitSummaries).where(inArray(replayVisitSummaries.recordingId, ids));
  // By the ids just read, still inside the scope: a recording that arrived since is
  // erased by the next request, never one outside the scope.
  await store.delete(replayRecordings).where(and(owned, inArray(replayRecordings.id, ids)));
  for (const siteId of new Set(rows.map((row) => row.siteId))) await bumpSiteVersion(env, siteId);
  return rows.length;
}
