/**
 * PUT ONE OBJECT ON A BOARD — from the server, for a board somebody may be
 * looking at right now.
 *
 * ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────
 * Every server-side write to a canvas graph so far has belonged to a REQUEST
 * ABOUT THAT GRAPH: `PUT /:id/graph`, `POST /:id/commands`, template apply and
 * the public `/api/v1` item CRUD all arrive with the caller's `If-Match`, so
 * each of them can hand `creationGraphStatements` a revision it already proved.
 *
 * Conversion is the first write that is ABOUT SOMETHING ELSE. "Make this a
 * project" claims an identity and an address; the card it should leave behind on
 * the board is a consequence, not the request. There was nowhere to express
 * that, so conversion left no trace on the board at all — and a board that had
 * just become a project looked project-less to every reader that resolves
 * through the graph: `POST /projects/:projectId/open` could not find it (a
 * person who converted and then opened their project landed on a NEW EMPTY
 * BOARD), and the canvas's own `ensureCanvasProject` provisioned a SECOND
 * project on the next publish, shipping the site to an address the creator never
 * chose.
 *
 * ── WHY IT IS SAFE TO WRITE UNDER AN OPEN BOARD ──────────────────────────────
 * The revision is read here and written at +1, and the two constraints that
 * serialize canvas writers (`uq_creation_events_revision` /
 * `uq_creation_events_idempotency`) do the arbitration: a client that saves in
 * the same instant either wins — and this returns `placed: false`, having
 * changed nothing — or loses and is told to re-read. It cannot half-apply, and
 * it cannot clobber, because a client at the older revision is refused with a
 * 409 by every write route. The `canvas.changed` broadcast then reaches the open
 * board, which adopts the newer graph through `AdoptRemoteBoard` — the same door
 * a collaborator's edit comes through, including its refusal to overwrite
 * unsaved local work.
 *
 * ── WHY IT IS BEST-EFFORT ────────────────────────────────────────────────────
 * A caller reaches for this because the object is a CONSEQUENCE. Conversion
 * must not fail because a card could not be drawn — the project, the link and
 * the address are already correct and the person is waiting — so a lost race
 * and a write failure both return rather than throw, exactly as the address
 * reservation in `convertSessionToApp` does, and for the same reason.
 *
 * ── WHY IT IS IDEMPOTENT ON THE RESOURCE, NOT THE OBJECT ID ──────────────────
 * The caller mints a fresh object id every time, so an id check would place a
 * second card on every retry. What must be unique is the RESOURCE the card
 * points at: one board shows one project once.
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

/** How far left of the board's own content a new container card is dropped. */
const CONTAINER_GUTTER = 380;
/** Where a card goes on a board that has nothing to sit beside. */
const EMPTY_BOARD_ORIGIN = { x: 160, y: 120 };
const CARD_SIZE = { w: 320, h: 220 };

export interface PlaceCanvasObjectInput {
  sessionId: string;
  tenantId: number;
  /** Stamped into `created_by`/`updated_by` and named as the event's actor. */
  userId: string;
  /** The object kind, e.g. `'project'`. */
  kind: string;
  /** What the card points at. Both halves required — this is the idempotency key. */
  resourceType: string;
  resourceId: string;
  /** The card's rendered content, e.g. `{ kind: 'project', title }`. */
  content: Record<string, unknown>;
  /** Event type appended to the board's timeline, e.g. `'canvas.project_placed'`. */
  eventType: string;
  eventPayload?: Record<string, unknown>;
}

export interface PlacedCanvasObject {
  objectId: string;
  /** The board's revision after this call — unchanged when `placed` is false. */
  revision: number;
  /** False when the card was already there, or when a concurrent writer won. */
  placed: boolean;
}

/**
 * Where a container card goes on a board that already has content.
 *
 * Left of everything, level with the top-most object, so the edge a caller draws
 * next reads container → thing. Exported because it is the SAME convention the
 * canvas applies when it places a project card client-side, and two placements
 * that disagree is how the one board ends up with a card in the sea.
 */
export function containerCardPosition(
  objects: readonly { canvasData?: unknown }[],
): { x: number; y: number } {
  const points = objects
    .map((object) => (object.canvasData ?? {}) as { x?: unknown; y?: unknown })
    .map((data) => ({ x: Number(data.x), y: Number(data.y) }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (!points.length) return { ...EMPTY_BOARD_ORIGIN };
  return {
    x: Math.min(...points.map((point) => point.x)) - CONTAINER_GUTTER,
    y: Math.min(...points.map((point) => point.y)),
  };
}

/**
 * Place one object on a board at revision+1, or report why nothing happened.
 *
 * Null means the board is not readable in this tenant — the caller's own
 * existence checks have already run, so this is the race where it was deleted
 * underneath them, not an error worth raising.
 */
export async function placeCanvasObject(
  db: Db,
  env: Env,
  input: PlaceCanvasObjectInput,
): Promise<PlacedCanvasObject | null> {
  const [session] = await db
    .select({
      id: creationSessions.id,
      revision: creationSessions.canvasRevision,
      viewport: creationSessions.viewport,
    })
    .from(creationSessions)
    .where(scopedToTenant(creationSessions, input.tenantId, eq(creationSessions.id, input.sessionId)))
    .limit(1);
  if (!session) return null;

  // The whole graph, because `creationGraphStatements` replaces it — the price of
  // having ONE writer instead of an append that drifts from it. Paid once in a
  // board's life, on an action a person is already waiting on.
  const [storedObjects, storedConnections] = await Promise.all([
    db.select().from(creationSessionObjects).where(eq(creationSessionObjects.sessionId, session.id)),
    db.select().from(creationSessionConnections).where(eq(creationSessionConnections.sessionId, session.id)),
  ]);

  const existing = storedObjects.find((object) =>
    object.resourceType === input.resourceType && object.resourceId === input.resourceId);
  if (existing) return { objectId: existing.id, revision: session.revision, placed: false };

  const objectId = crypto.randomUUID();
  const placed: GraphObjectInput = {
    id: objectId,
    kind: input.kind,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    canvasData: { ...containerCardPosition(storedObjects), ...CARD_SIZE },
    content: input.content,
  };
  const objects: GraphObjectInput[] = [
    ...storedObjects.map((object) => ({
      id: object.id, kind: object.kind, resourceType: object.resourceType, resourceId: object.resourceId,
      resourceRevision: object.resourceRevision, canvasData: object.canvasData, content: object.content,
    })),
    placed,
  ];
  const connections: GraphConnectionInput[] = storedConnections.map((edge) => ({
    id: edge.id, sourceObjectId: edge.sourceObjectId, targetObjectId: edge.targetObjectId,
    kind: edge.kind, label: edge.label, metadata: edge.metadata,
  }));

  const revision = session.revision + 1;
  try {
    await db.batch(creationGraphStatements(db, {
      sessionId: session.id,
      tenantId: input.tenantId,
      objects,
      connections,
      revision,
      actorType: 'user',
      actorRef: input.userId,
      authorUserId: input.userId,
      eventType: input.eventType,
      eventPayload: { ...(input.eventPayload ?? {}), objectId },
      // No key: this is not a client retry, it is a consequence written once. The
      // revision constraint is the guard, and losing it is a correct outcome.
      idempotencyKey: null,
      viewport: session.viewport,
      // The loss must SURFACE here so it can be reported as "not placed" rather
      // than silently recorded as a success that never happened.
      snapshotOnConflictDoNothing: false,
    }) as unknown as Parameters<typeof db.batch>[0]);
  } catch (error) {
    // A concurrent writer took this revision. The caller's primary work already
    // committed and the person is waiting on it, so this reports rather than
    // raises — and says so, because a card that silently never appeared is
    // indistinguishable from one that was never meant to.
    if (!isCreationEventWriteConflict(error)) {
      reportCaughtError(error, {
        source: 'application/canvas/placeCanvasObject.ts',
        operation: `place:${input.kind}:${input.resourceType}:${input.resourceId}`,
      });
    }
    return { objectId, revision: session.revision, placed: false };
  }

  // The open board hears about it through the same door a collaborator's edit
  // arrives by, so nobody has to reload to see what their own action produced.
  await broadcastRoom(
    env.SESSION_ROOM,
    creationSessionRoomName(input.tenantId, session.id),
    JSON.stringify({ type: 'canvas.changed', revision }),
  );

  return { objectId, revision, placed: true };
}
