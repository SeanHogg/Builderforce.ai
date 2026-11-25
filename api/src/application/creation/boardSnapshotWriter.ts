/**
 * The board's history snapshot, written ONCE per board after a batch of per-edit writes.
 *
 * `boardEditWriter` moves the board one revision per edit and deliberately writes no
 * snapshot (it holds the whole graph). This writes it from the committed rows: the
 * graph at the board's CURRENT revision, plus the card face (`preview`) the board list
 * renders. The snapshot is `ON CONFLICT DO NOTHING`, so a second writer, a retry or a
 * replay of the same revision is a no-op, like the whole-graph route's.
 *
 * It runs after the push chunk's transaction has committed (the importers register it
 * with `afterCommit`), on the request's own connection, so it only ever sees a graph
 * that is true. `boardSnapshotScheduler` collapses the many edits of one chunk into one
 * snapshot per board.
 */

import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import {
  creationSessionConnections,
  creationSessionObjects,
  creationSessionSnapshots,
  creationSessions,
} from '../../infrastructure/database/schema';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { buildPreview, type GraphConnectionInput, type GraphObjectInput } from './creationGraphWriter';

export async function writeBoardSnapshot(db: Db, tenantId: number, sessionId: string): Promise<void> {
  const [session] = await db
    .select({ revision: creationSessions.canvasRevision, viewport: creationSessions.viewport })
    .from(creationSessions)
    .where(and(eq(creationSessions.id, sessionId), eq(creationSessions.tenantId, tenantId)))
    .limit(1);
  if (!session) return;
  const [objectRows, connectionRows] = await Promise.all([
    db.select().from(creationSessionObjects).where(eq(creationSessionObjects.sessionId, sessionId)),
    db.select().from(creationSessionConnections).where(eq(creationSessionConnections.sessionId, sessionId)),
  ]);
  const objects: GraphObjectInput[] = objectRows.map((row) => ({
    id: row.id,
    kind: row.kind,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    resourceRevision: row.resourceRevision,
    canvasData: row.canvasData,
    content: row.content,
  }));
  const connections: GraphConnectionInput[] = connectionRows.map((row) => ({
    id: row.id,
    sourceObjectId: row.sourceObjectId,
    targetObjectId: row.targetObjectId,
    kind: row.kind,
    label: row.label,
    metadata: row.metadata,
  }));
  await db.insert(creationSessionSnapshots).values({
    sessionId,
    revision: Number(session.revision),
    graph: { objects, connections },
    viewport: session.viewport,
    createdBy: null,
  }).onConflictDoNothing();
  await db.update(creationSessions)
    .set({ preview: buildPreview(objects) })
    .where(and(eq(creationSessions.id, sessionId), eq(creationSessions.tenantId, tenantId)));
}

/** The deferred snapshot write an importer hands to `ctx.afterCommit`. */
export type BoardSnapshotEffect = () => Promise<void>;

/**
 * `schedule(tenantId, sessionId)` returns the effect to register after an edit. Every edit
 * of a chunk registers one; the effects of one chunk start in the same tick, so the first
 * claims the board and the rest see it in flight and do nothing — one snapshot per board
 * per chunk, written from the chunk's final state. The claim is released when the write
 * ends, so the next chunk's edits snapshot again. A failed write is reported, never thrown:
 * the edits are committed, and the snapshot is rebuilt by the next edit's effect.
 */
export function boardSnapshotScheduler(db: Db): (tenantId: number, sessionId: string) => BoardSnapshotEffect {
  const inFlight = new Set<string>();
  return (tenantId, sessionId) => async () => {
    const key = `${tenantId}:${sessionId}`;
    if (inFlight.has(key)) return;
    inFlight.add(key);
    try {
      await writeBoardSnapshot(db, tenantId, sessionId);
    } catch (error) {
      reportCaughtError(error, {
        source: 'application/creation/boardSnapshotWriter.ts',
        operation: 'writeBoardSnapshot',
        context: { tenantId, sessionId },
      });
    } finally {
      inFlight.delete(key);
    }
  };
}
