/**
 * THE canvas graph write — one statement builder, every caller.
 *
 * ── WHY IT WAS EXTRACTED ─────────────────────────────────────────────────────────
 * Saving a board is not one statement, it is seven, and they only mean what they say
 * TOGETHER: clear the edges, clear the objects, re-insert both, bump the revision and
 * the preview, append an event carrying the idempotency key, and write a snapshot at
 * the new revision. Run six of the seven and the board is fine and the history has a
 * hole; run them in the wrong order and a foreign key fails halfway.
 *
 * That sequence was written out twice inside `creationSessionRouteService` — once in
 * `PUT /:id/graph` and once in `POST /:id/commands` — and it is about to be needed a
 * third time by the public `/api/v1` item CRUD, which is exactly the moment a repo
 * decides whether it has a primitive or three copies. A third copy is how the two
 * existing ones came to differ already: the `graph` path writes its snapshot with
 * `onConflictDoNothing` and the `commands` path does not.
 *
 * ── WHY IT BUILDS STATEMENTS INSTEAD OF EXECUTING ────────────────────────────────
 * The atomicity is the caller's, and it has to be: `commands` appends the personal
 * viewport update to the same batch, and `merge`/`branch` fold a graph write into a
 * larger one. A helper that ran its own `db.batch` would force those callers back to
 * two transactions and reintroduce the half-written state the batch exists to prevent.
 * So this returns the statements and the caller decides what they are batched WITH.
 *
 * The ORDER of the returned array is load-bearing and is the reason the array is built
 * here rather than spread by each caller: deletes before inserts (an object row cannot
 * be replaced while an edge points at it), inserts before the revision bump (the event
 * and the snapshot describe a graph that must already exist), and the event last among
 * the bookkeeping because its unique constraints are what serialize two concurrent
 * writers onto the same revision.
 */

import { and, eq } from 'drizzle-orm';
import { isCreationConnectionKind, isCreationObjectKind } from '@builderforce/creation-canvas-contract';
import type { Db } from '../../infrastructure/database/connection';
import {
  creationSessionConnections,
  creationSessionEvents,
  creationSessionMembers,
  creationSessionObjects,
  creationSessionSnapshots,
  creationSessions,
} from '../../infrastructure/database/schema';
/**
 * Only user-visible labels are searchable. Never serialize arbitrary content.
 *
 * It lives beside the writer because it is a property of the ROW being written —
 * `search_text` is a projection of `content` and the two are only ever correct
 * together. It moved here from `creationSessionRouteService`, which still re-exports
 * it so the marketplace listing writer and the existing tests keep their import.
 */
export function creationObjectSearchText(content: unknown): string {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return '';
  const source = content as Record<string, unknown>;
  return ['title', 'subtitle', 'status', 'label']
    .map((key) => typeof source[key] === 'string' ? source[key] as string : '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2_000);
}

export type GraphObjectInput = {
  id: string;
  kind: string;
  resourceType?: string | null;
  resourceId?: string | null;
  resourceRevision?: string | null;
  canvasData?: unknown;
  content?: unknown;
};

export type GraphConnectionInput = {
  id: string;
  sourceObjectId: string;
  targetObjectId: string;
  kind?: string;
  label?: string | null;
  metadata?: unknown;
};

/**
 * The board's card face — what a list, a search result and a tile render without
 * loading the graph. Lives here because it is derived from exactly the objects this
 * module is about to write, and a preview computed from a different array than the
 * one persisted is a tile that shows a board that no longer exists.
 */
export function buildPreview(objects: GraphObjectInput[]) {
  return {
    objectCount: objects.length,
    kinds: [...new Set(objects.map((object) => object.kind))].slice(0, 8),
    objects: objects.slice(0, 12).map((object) => ({
      id: object.id, kind: object.kind,
      x: Number((object.canvasData as { x?: number } | undefined)?.x ?? 0),
      y: Number((object.canvasData as { y?: number } | undefined)?.y ?? 0),
      title: String((object.content as { title?: string } | undefined)?.title ?? object.kind).slice(0, 80),
      status: String((object.content as { status?: string } | undefined)?.status ?? '').slice(0, 48) || undefined,
      resourceType: object.resourceType || undefined,
      resourceId: object.resourceId || undefined,
    })),
  };
}

export interface CreationGraphWrite {
  sessionId: string;
  tenantId: number;
  objects: GraphObjectInput[];
  connections: GraphConnectionInput[];
  /** The revision the board will be AT once these statements commit. */
  revision: number;
  /**
   * Who is writing. `actorType` is 'user' for a session member, 'api' for a
   * `tenant_api_keys` caller on `/api/v1`. `authorUserId` is what lands in the rows'
   * `created_by`/`updated_by` columns and is NULL for a key-authenticated caller —
   * a key is not a person, and stamping one with a borrowed user id is how an audit
   * trail starts naming the wrong actor.
   */
  actorType: 'user' | 'agent' | 'api';
  actorRef: string;
  authorUserId: string | null;
  eventType: string;
  eventPayload: unknown;
  idempotencyKey: string | null;
  /** The BOARD viewport to persist. Pass the existing one to leave it unchanged. */
  viewport: unknown;
  /**
   * The viewport the snapshot records, when it differs from the board's.
   *
   * `POST /:id/commands` is the case: a `viewport.set` command moves the CALLER's
   * camera, which belongs on their `creation_session_members` row and must not
   * scroll the board for everyone else — but a snapshot is a reading of what this
   * writer saw, so it records the camera the write happened under. Defaults to
   * `viewport`, so the ordinary caller never thinks about it.
   */
  snapshotViewport?: unknown;
  /**
   * `PUT /:id/graph` writes its snapshot with ON CONFLICT DO NOTHING because a
   * client that retries the same save lands on the same revision and must not fail;
   * `POST /:id/commands` deliberately lets the conflict raise, because there the
   * collision means a concurrent writer took the revision and the caller has to be
   * told (it is translated into a 409). Preserved as a flag rather than unified,
   * because they are two different answers to the same race and both are correct
   * for their caller.
   */
  snapshotOnConflictDoNothing?: boolean;
}

/**
 * Build the ordered statement list that replaces a board's graph at a new revision.
 * The caller runs them — batched with whatever else must commit atomically alongside.
 */
export function creationGraphStatements(db: Db, write: CreationGraphWrite): unknown[] {
  const { sessionId, tenantId, objects, connections, revision, authorUserId } = write;
  const now = new Date();

  const statements: unknown[] = [
    db.delete(creationSessionConnections).where(eq(creationSessionConnections.sessionId, sessionId)),
    db.delete(creationSessionObjects).where(eq(creationSessionObjects.sessionId, sessionId)),
  ];

  if (objects.length) {
    statements.push(db.insert(creationSessionObjects).values(objects.map((object) => ({
      id: object.id,
      sessionId,
      kind: object.kind.slice(0, 48),
      resourceType: object.resourceType?.slice(0, 64) || null,
      resourceId: object.resourceId?.slice(0, 128) || null,
      resourceRevision: object.resourceRevision?.slice(0, 128) || null,
      canvasData: object.canvasData ?? {},
      content: object.content ?? null,
      searchText: creationObjectSearchText(object.content),
      createdBy: authorUserId,
      updatedBy: authorUserId,
    }))));
  }

  if (connections.length) {
    statements.push(db.insert(creationSessionConnections).values(connections.map((edge) => ({
      id: edge.id,
      sessionId,
      sourceObjectId: edge.sourceObjectId,
      targetObjectId: edge.targetObjectId,
      kind: (edge.kind || 'reference').slice(0, 24),
      label: edge.label?.slice(0, 255) || null,
      metadata: edge.metadata ?? null,
      createdBy: authorUserId,
    }))));
  }

  const snapshot = db.insert(creationSessionSnapshots).values({
    sessionId,
    revision,
    graph: { objects, connections },
    viewport: write.snapshotViewport === undefined ? write.viewport : write.snapshotViewport,
    createdBy: authorUserId,
  });

  statements.push(
    db.update(creationSessions).set({
      canvasRevision: revision,
      viewport: write.viewport,
      updatedBy: authorUserId,
      updatedAt: now,
      lastActivityAt: now,
      preview: buildPreview(objects),
    }).where(and(eq(creationSessions.id, sessionId), eq(creationSessions.tenantId, tenantId))),
    db.insert(creationSessionEvents).values({
      sessionId,
      revision,
      actorType: write.actorType,
      actorRef: write.actorRef,
      eventType: write.eventType,
      payload: write.eventPayload,
      idempotencyKey: write.idempotencyKey,
    }),
    write.snapshotOnConflictDoNothing ? snapshot.onConflictDoNothing() : snapshot,
  );

  return statements;
}

// ---------------------------------------------------------------------------
// Creating a board
// ---------------------------------------------------------------------------

/** One write, with enough about it to say WHICH one failed when the driver
 *  reports only a constraint name — see `describeClaimBatchFailure`. */
export interface PlannedCreationWrite {
  table: string;
  rows: number;
  statement: unknown;
}

export interface NewCreationSession {
  sessionId: string;
  tenantId: number;
  segmentId: string | null;
  title: string;
  objects: GraphObjectInput[];
  connections?: GraphConnectionInput[];
  /** The owner, and the author stamped on every row this writes. */
  authorUserId: string;
  eventType: string;
  eventPayload?: unknown;
  /** The object the creating event is ABOUT, when it is about one. */
  eventObjectId?: string | null;
  idempotencyKey?: string | null;
  /** The board's camera. Defaults to origin. */
  viewport?: unknown;
  /** The owner's own camera, when it differs from the board's (a claim carries one). */
  memberViewport?: unknown;
  /**
   * Extra columns on the `creation_sessions` row — `description`, `folderId`, and
   * the branch lineage a fork records. Deliberately open: they are per-caller
   * FACTS about the new board, not variations on how it is written.
   */
  columns?: Record<string, unknown>;
}

/**
 * The five-statement core every "create a board" path runs, in the one order
 * that works.
 *
 * There were SEVEN hand-written copies of it in `creationSessionRouteService`
 * alone — claim, create, duplicate, branch, from-project, from-build,
 * from-resource — and they had already drifted: `from-project` wrote its session
 * row OUTSIDE the batch (so a failed member insert left a board with no owner),
 * and only two of the seven recorded a `search_text` on the objects they seeded,
 * which is what decides whether a seeded board is findable. Installing a canvas
 * pack from a marketplace template would have been an eighth copy, which is
 * exactly the moment a repo decides whether it has a primitive.
 *
 * Like `creationGraphStatements` it BUILDS statements rather than running them:
 * every caller has extras that must commit in the same batch — the claim row,
 * the project links, the initial timeline message — and a helper that ran its own
 * `db.batch` would force those back into a second transaction.
 *
 * The ORDER is load-bearing: the session row first (everything references it),
 * then the owner (a board with no member is unreachable), then the graph, then
 * the bookkeeping whose unique constraints serialize concurrent writers.
 */
export function newCreationSessionStatements(db: Db, input: NewCreationSession): PlannedCreationWrite[] {
  const { sessionId, tenantId, authorUserId } = input;
  const objects = input.objects;
  const connections = input.connections ?? [];
  const viewport = input.viewport ?? { x: 0, y: 0, zoom: 1 };

  const writes: PlannedCreationWrite[] = [
    {
      table: 'creation_sessions',
      rows: 1,
      statement: db.insert(creationSessions).values({
        id: sessionId,
        tenantId,
        segmentId: input.segmentId,
        title: input.title.slice(0, 255),
        preview: buildPreview(objects),
        createdBy: authorUserId,
        updatedBy: authorUserId,
        canvasRevision: 1,
        viewport,
        ...(input.columns ?? {}),
      }),
    },
    {
      table: 'creation_session_members',
      rows: 1,
      statement: db.insert(creationSessionMembers).values({
        sessionId,
        userId: authorUserId,
        role: 'owner',
        invitedBy: authorUserId,
        ...(input.memberViewport === undefined ? {} : { viewport: input.memberViewport }),
      }),
    },
  ];

  if (objects.length) {
    writes.push({
      table: 'creation_session_objects',
      rows: objects.length,
      statement: db.insert(creationSessionObjects).values(objects.map((object) => ({
        id: object.id,
        sessionId,
        kind: object.kind.slice(0, 48),
        resourceType: object.resourceType?.slice(0, 64) || null,
        resourceId: object.resourceId?.slice(0, 128) || null,
        resourceRevision: object.resourceRevision?.slice(0, 128) || null,
        canvasData: object.canvasData ?? {},
        content: object.content ?? null,
        searchText: creationObjectSearchText(object.content),
        createdBy: authorUserId,
        updatedBy: authorUserId,
      }))),
    });
  }

  if (connections.length) {
    writes.push({
      table: 'creation_session_connections',
      rows: connections.length,
      statement: db.insert(creationSessionConnections).values(connections.map((edge) => ({
        id: edge.id,
        sessionId,
        sourceObjectId: edge.sourceObjectId,
        targetObjectId: edge.targetObjectId,
        kind: (edge.kind || 'reference').slice(0, 24),
        label: edge.label?.slice(0, 255) || null,
        metadata: edge.metadata ?? null,
        createdBy: authorUserId,
      }))),
    });
  }

  writes.push(
    {
      table: 'creation_session_events',
      rows: 1,
      statement: db.insert(creationSessionEvents).values({
        sessionId,
        revision: 1,
        actorType: 'user',
        actorRef: authorUserId,
        eventType: input.eventType,
        ...(input.eventObjectId ? { objectId: input.eventObjectId } : {}),
        payload: input.eventPayload ?? {},
        idempotencyKey: input.idempotencyKey ?? null,
      }),
    },
    {
      table: 'creation_session_snapshots',
      rows: 1,
      statement: db.insert(creationSessionSnapshots).values({
        sessionId,
        revision: 1,
        graph: { objects, connections },
        viewport,
        createdBy: authorUserId,
      }),
    },
  );

  return writes;
}

/**
 * The canonical object/connection id shape. Exported so the public `/api/v1`
 * surface and the in-product routes test the SAME regex — a public endpoint with
 * a looser id pattern than the validator is a 500 waiting for its first caller.
 */
export const CREATION_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Ids are compared the way POSTGRES compares them.
 *
 * `UUID_RE` accepts either case (`/i`), and every uniqueness check below used a
 * case-SENSITIVE `Set` — so `A1B2…` and `a1b2…` passed validation as two
 * distinct objects, and then hit a `uuid` column that considers them the same
 * value. The request died on `duplicate key value violates unique constraint
 * "creation_session_objects_pkey"`, i.e. a 500 for input the validator had
 * already declared valid. A `uuid` is case-insensitive by definition; the
 * validator has to agree with the column it is validating for.
 */
export const uuidKey = (id: string) => id.toLowerCase();

export function validCreationGraph(objects: GraphObjectInput[], connections: GraphConnectionInput[]): string | null {
  if (objects.length > 1_000) return 'A session may contain at most 1,000 objects';
  if (connections.length > 4_000) return 'A session may contain at most 4,000 connections';
  const ids = new Set<string>();
  for (const object of objects) {
    if (!CREATION_UUID_RE.test(object.id)) return `Invalid object id: ${object.id}`;
    if (!isCreationObjectKind(object.kind)) return `Unsupported object kind: ${object.kind || 'missing'}`;
    if (ids.has(uuidKey(object.id))) return `Duplicate object id: ${object.id}`;
    ids.add(uuidKey(object.id));
  }
  const connectionIds = new Set<string>();
  for (const edge of connections) {
    if (!CREATION_UUID_RE.test(edge.id)) return `Invalid connection id: ${edge.id}`;
    if (connectionIds.has(uuidKey(edge.id))) return `Duplicate connection id: ${edge.id}`;
    connectionIds.add(uuidKey(edge.id));
    if (!ids.has(uuidKey(edge.sourceObjectId)) || !ids.has(uuidKey(edge.targetObjectId))) return 'A connection references an object outside this session';
    if (edge.kind && !isCreationConnectionKind(edge.kind)) return `Unsupported connection kind: ${edge.kind}`;
  }
  return null;
}
