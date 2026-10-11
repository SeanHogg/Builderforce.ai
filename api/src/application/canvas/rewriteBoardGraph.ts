/**
 * REWRITE ONE BOARD'S GRAPH — from the server, as a consequence of something else.
 *
 * ── WHY IT WAS EXTRACTED ─────────────────────────────────────────────────────
 * `placeCanvasObject` was the first server write ABOUT SOMETHING ELSE (conversion
 * leaving a project card behind). Ceremony minutes are the second: a meeting ends,
 * its minutes are written, and the stand-up card that convened it has to show what
 * came of it. Both need the same seven moves — read the board at its revision, read
 * the whole graph (because `creationGraphStatements` replaces it), decide what
 * changes, write at revision+1, treat a lost revision race as "not written" rather
 * than an error, report anything else, and tell the open board through
 * `canvas.changed`. Written twice, the two copies would disagree about the race the
 * way the `graph` and `commands` routes once did about the snapshot conflict.
 *
 * So the read / write / race / broadcast is here, once, and each caller supplies
 * only the DECISION: a function from the current graph to the next one (or to
 * "nothing to do", which writes nothing and bumps no revision — the property that
 * makes every caller idempotent on a re-run).
 *
 * ── WHY IT IS SAFE UNDER AN OPEN BOARD ───────────────────────────────────────
 * See `placeCanvasObject`: the unique revision constraint on `creation_session_events`
 * arbitrates, a client at the older revision is refused with a 409 by every write
 * route, and the broadcast reaches the open board through `AdoptRemoteBoard` — the
 * door a collaborator's edit comes through, including its refusal to overwrite
 * unsaved local work.
 */

import { eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import {
  creationSessionConnections,
  creationSessionObjects,
  creationSessions,
} from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { broadcastRoom, creationSessionRoomName } from '../../infrastructure/relay/broadcastRoom';
import {
  creationGraphStatements,
  isCreationEventWriteConflict,
  type GraphConnectionInput,
  type GraphObjectInput,
} from '../creation/creationGraphWriter';
import { reportCaughtError } from '../observability/caughtErrorReporter';

/** A board's graph in the writer's own input shape. */
export interface BoardGraph {
  objects: GraphObjectInput[];
  connections: GraphConnectionInput[];
}

/**
 * Who the write is attributed to. `userId` lands in `created_by`/`updated_by` and is
 * null for a write no person made (minutes written by the meeting-notes agent) — the
 * same rule `creationGraphStatements` documents for an API key.
 */
export interface BoardRewriteActor {
  type: 'user' | 'agent';
  ref: string;
  userId: string | null;
}

/** What the caller's decision returns: the next graph, or "leave it as it is". */
export type BoardGraphEdit<T> =
  | { graph: BoardGraph; eventPayload?: Record<string, unknown>; result: T }
  | { unchanged: T };

export interface RewriteBoardGraphInput<T> {
  sessionId: string;
  tenantId: number;
  actor: BoardRewriteActor;
  /** Event type appended to the board's timeline, e.g. `'canvas.project_placed'`. */
  eventType: string;
  /** Names the write in an error report. */
  operation: string;
  edit: (graph: BoardGraph) => BoardGraphEdit<T>;
}

export type RewriteBoardGraphOutcome<T> =
  /** The board is not readable in this tenant (deleted underneath the caller). */
  | { status: 'missing' }
  /** The decision said nothing changes — no write, no revision bump. */
  | { status: 'unchanged'; revision: number; result: T }
  | { status: 'written'; revision: number; result: T }
  /** A concurrent writer took the revision, or the write failed (and was reported). */
  | { status: 'conflict'; revision: number; result: T };

/** Read a stored board into the writer's input shape. */
async function loadBoardGraph(db: Db, sessionId: string): Promise<BoardGraph> {
  const [storedObjects, storedConnections] = await Promise.all([
    db.select().from(creationSessionObjects).where(eq(creationSessionObjects.sessionId, sessionId)),
    db.select().from(creationSessionConnections).where(eq(creationSessionConnections.sessionId, sessionId)),
  ]);
  return {
    objects: storedObjects.map((object) => ({
      id: object.id, kind: object.kind, resourceType: object.resourceType, resourceId: object.resourceId,
      resourceRevision: object.resourceRevision, canvasData: object.canvasData, content: object.content,
    })),
    connections: storedConnections.map((edge) => ({
      id: edge.id, sourceObjectId: edge.sourceObjectId, targetObjectId: edge.targetObjectId,
      kind: edge.kind, label: edge.label, metadata: edge.metadata,
    })),
  };
}

/** Rewrite one board at revision+1, or report why nothing was written. Never throws
 *  for a lost race or a write failure — the caller's primary work has already happened. */
export async function rewriteBoardGraph<T>(
  db: Db,
  env: Env,
  input: RewriteBoardGraphInput<T>,
): Promise<RewriteBoardGraphOutcome<T>> {
  const [session] = await db
    .select({
      id: creationSessions.id,
      revision: creationSessions.canvasRevision,
      viewport: creationSessions.viewport,
    })
    .from(creationSessions)
    .where(scopedToTenant(creationSessions, input.tenantId, eq(creationSessions.id, input.sessionId)))
    .limit(1);
  if (!session) return { status: 'missing' };

  const decision = input.edit(await loadBoardGraph(db, session.id));
  if ('unchanged' in decision) return { status: 'unchanged', revision: session.revision, result: decision.unchanged };

  const revision = session.revision + 1;
  try {
    await db.batch(creationGraphStatements(db, {
      sessionId: session.id,
      tenantId: input.tenantId,
      objects: decision.graph.objects,
      connections: decision.graph.connections,
      revision,
      actorType: input.actor.type,
      actorRef: input.actor.ref,
      authorUserId: input.actor.userId,
      eventType: input.eventType,
      eventPayload: decision.eventPayload ?? {},
      // No key: this is not a client retry, it is a consequence written once. The
      // revision constraint is the guard, and losing it is a correct outcome.
      idempotencyKey: null,
      viewport: session.viewport,
      // The loss must SURFACE here so it can be reported as "not written" rather
      // than silently recorded as a success that never happened.
      snapshotOnConflictDoNothing: false,
    }) as unknown as Parameters<typeof db.batch>[0]);
  } catch (error) {
    if (!isCreationEventWriteConflict(error)) {
      reportCaughtError(error, { source: 'application/canvas/rewriteBoardGraph.ts', operation: input.operation });
    }
    return { status: 'conflict', revision: session.revision, result: decision.result };
  }

  // The open board hears about it through the same door a collaborator's edit
  // arrives by, so nobody has to reload to see what their own action produced.
  await broadcastRoom(
    env.SESSION_ROOM,
    creationSessionRoomName(input.tenantId, session.id),
    JSON.stringify({ type: 'canvas.changed', revision }),
  );

  return { status: 'written', revision, result: decision.result };
}
