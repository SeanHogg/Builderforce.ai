/**
 * THE BOARD REPLICA — read a board's records out of the local-first store, and let the SERVER's
 * version of a board in without journaling it.
 *
 * Reads: one board is its header plus the children that name it (`boardId`), found through
 * secondary indexes so opening a board costs that board and never a walk of every board on the
 * device.
 *
 * Writes from the server (`seedFromServer`, `ingestFromServer`) are not local edits. They land as
 * `imported` / `server-observed` records with a server mapping, WITHOUT a journal event — a journal
 * event would send the server its own data back. A record with a pending local event is skipped (an
 * unsynced edit is never overwritten); a record the server no longer lists, that the server DID once
 * hold and that has no pending edit, is tombstoned locally (also without an event).
 */

import {
  defineRecordIndex,
  selectByIndex,
  type EntityDestination,
  type LocalFirstStore,
  type LocalFirstTransaction,
  type LocalRecord,
} from '@builderforce/local-first';
import {
  boardFromPersistedGraph,
  type CanvasBoard,
  type PersistedCanvasGraph,
  type RejectedCanvasObject,
} from '../../domain/canvasBoard';
import {
  CANVAS_BOARD,
  CANVAS_EDGE,
  CANVAS_MEDIA,
  CANVAS_OBJECT,
  CANVAS_RECORD_SCHEMA_VERSION,
  CANVAS_TIMELINE,
  edgePayloadOf,
  objectPayloadOf,
  persistedConnectionOf,
  persistedObjectOf,
  samePayload,
  timelineRecordId,
  type BoardPayload,
  type EdgePayload,
  type MediaPayload,
  type ObjectPayload,
  type ServerBoardSnapshot,
  type TimelinePayload,
} from './boardRecords';

const OBJECTS_BY_BOARD = defineRecordIndex<ObjectPayload>(CANVAS_OBJECT, 'by-board', (row) => row.payload.boardId);
const EDGES_BY_BOARD = defineRecordIndex<EdgePayload>(CANVAS_EDGE, 'by-board', (row) => row.payload.boardId);
const TIMELINE_BY_BOARD = defineRecordIndex<TimelinePayload>(CANVAS_TIMELINE, 'by-board', (row) => row.payload.boardId);
const MEDIA_BY_BOARD = defineRecordIndex<MediaPayload>(CANVAS_MEDIA, 'by-board', (row) => row.payload.boardId);

export interface BoardChildren {
  objects: LocalRecord<ObjectPayload>[];
  edges: LocalRecord<EdgePayload>[];
  timeline: LocalRecord<TimelinePayload>[];
  media: LocalRecord<MediaPayload>[];
}

const byCreation = (a: LocalRecord, b: LocalRecord): number => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id);

/** A board's LIVE child records, in creation order (z-order for objects). */
export async function childRecordsOf(tx: LocalFirstTransaction, boardId: string): Promise<BoardChildren> {
  const [objects, edges, timeline, media] = await Promise.all([
    selectByIndex(tx, OBJECTS_BY_BOARD, boardId),
    selectByIndex(tx, EDGES_BY_BOARD, boardId),
    selectByIndex(tx, TIMELINE_BY_BOARD, boardId),
    selectByIndex(tx, MEDIA_BY_BOARD, boardId),
  ]);
  return {
    objects: objects.sort(byCreation),
    edges: edges.sort(byCreation),
    timeline: timeline.sort(byCreation),
    media: media.sort(byCreation),
  };
}

export interface BoardReplica {
  boardId: string;
  header: LocalRecord<BoardPayload>;
  destination: EntityDestination;
  board: CanvasBoard;
  /** The persisted form of `board`, for diffing the next commit against. */
  graph: PersistedCanvasGraph;
  rejected: RejectedCanvasObject[];
  timeline: TimelinePayload[];
  media: LocalRecord<MediaPayload>[];
  /** The record version of every object and connection as read: the `baseVersions` of the next `commitBoardDiff`. */
  versions: Record<string, number>;
  /** The `canvasRevision` last reconciled with the server, when this board has one. */
  serverRevision?: number;
}

/** The board as the store holds it, or undefined when there is none (or it was deleted). */
export async function readBoard(store: LocalFirstStore, boardId: string): Promise<BoardReplica | undefined> {
  return store.read(async (tx) => {
    const header = await tx.get<BoardPayload>(CANVAS_BOARD, boardId);
    if (!header || header.deletedAt) return undefined;
    const children = await childRecordsOf(tx, boardId);
    const graph: PersistedCanvasGraph = {
      objects: children.objects.map((row) => persistedObjectOf(row.id, row.payload)),
      connections: children.edges.map((row) => persistedConnectionOf(row.id, row.payload)),
    };
    const { board, rejected } = boardFromPersistedGraph(graph);
    return {
      boardId,
      header,
      destination: header.destination,
      board,
      graph,
      rejected,
      timeline: children.timeline.map((row) => row.payload),
      media: children.media,
      versions: Object.fromEntries([...children.objects, ...children.edges].map((row) => [row.id, row.version])),
      ...(header.payload.serverRevision !== undefined ? { serverRevision: header.payload.serverRevision } : {}),
    };
  });
}

export interface BoardListEntry {
  boardId: string;
  title: string;
  folder?: string;
  updatedAt: string;
  destination: EntityDestination;
}

/** Every live board on this device, newest first — the library's offline list. */
export async function listBoards(store: LocalFirstStore): Promise<BoardListEntry[]> {
  const headers = await store.read((tx) => tx.list<BoardPayload>(CANVAS_BOARD));
  return headers
    .filter((row) => !row.deletedAt)
    .map((row) => ({
      boardId: row.id,
      title: row.payload.title,
      ...(row.payload.folder ? { folder: row.payload.folder } : {}),
      updatedAt: row.updatedAt,
      destination: row.destination,
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** The ids of this board's records (its own and its children's) that have an unsent journal event. */
export async function pendingIdsOf(store: LocalFirstStore, boardId: string): Promise<Set<string>> {
  return store.read(async (tx) => {
    const ids = new Set<string>();
    await tx.scanPending((event) => {
      if (event.deadLetter) return;
      const owner = event.entityType === CANVAS_BOARD ? event.clientEntityId : (event.payload as { boardId?: string } | null)?.boardId;
      if (owner === boardId) ids.add(event.clientEntityId);
    });
    return ids;
  });
}

/** Whether any live pending event belongs to this board. */
export async function hasPendingFor(store: LocalFirstStore, boardId: string): Promise<boolean> {
  return (await pendingIdsOf(store, boardId)).size > 0;
}

export interface IngestResult {
  written: number;
  skippedPending: number;
  removed: number;
}

const SERVER_OBSERVED = { deviceId: 'server', source: 'imported', evidence: 'server-observed' } as const;
const key = (entityType: string, id: string): string => `${entityType}\u0000${id}`;

/**
 * Write the server's board into the store (no journal events). `replaceMissing` is for a COMPLETE
 * snapshot (a reconcile): records the server once held and no longer lists are tombstoned locally.
 */
export async function ingestFromServer(
  store: LocalFirstStore,
  snapshot: ServerBoardSnapshot,
  destination: EntityDestination,
  options: { replaceMissing?: boolean; now?: () => Date } = {},
): Promise<IngestResult> {
  const stamp = (options.now?.() ?? new Date()).toISOString();
  const boardId = snapshot.id;
  return store.transact(async (tx) => {
    const result: IngestResult = { written: 0, skippedPending: 0, removed: 0 };
    const hasPending = new Set<string>();
    await tx.scanPending((event) => {
      if (!event.deadLetter) hasPending.add(key(event.entityType, event.clientEntityId));
    });
    const versionOf = (id: string): number => snapshot.versions?.[id] ?? snapshot.revision;

    /** One server row → one record, unless the device has an unsynced edit of it or deleted it. */
    const ingest = async <T>(entityType: LocalRecord['entityType'], id: string, payload: T, version: number): Promise<void> => {
      if (hasPending.has(key(entityType, id))) {
        result.skippedPending += 1;
        return;
      }
      const existing = await tx.get<T>(entityType, id);
      if (existing?.deletedAt) return;
      await tx.putMapping({ destination, entityType, clientEntityId: id, serverId: id, serverVersion: version });
      if (existing && samePayload(existing.payload, payload)) return;
      const record: LocalRecord<T> = existing
        ? { ...existing, version: existing.version + 1, baseVersion: existing.version, updatedAt: stamp, payload }
        : {
          id,
          entityType,
          schemaVersion: CANVAS_RECORD_SCHEMA_VERSION,
          version: 1,
          destination,
          occurredAt: stamp,
          updatedAt: stamp,
          payload,
          provenance: { ...SERVER_OBSERVED },
        };
      await tx.put(record, existing?.version);
      result.written += 1;
    };

    const header = await tx.get<BoardPayload>(CANVAS_BOARD, boardId);
    const local = header?.payload;
    await ingest<BoardPayload>(CANVAS_BOARD, boardId, {
      ...(local ?? {}),
      title: snapshot.title,
      ...(snapshot.folder !== undefined ? { folder: snapshot.folder } : {}),
      ...(snapshot.mode !== undefined ? { mode: snapshot.mode } : {}),
      serverRevision: snapshot.revision,
    }, versionOf(boardId));

    const live = new Set<string>();
    for (const object of snapshot.graph.objects) {
      live.add(key(CANVAS_OBJECT, object.id));
      await ingest(CANVAS_OBJECT, object.id, objectPayloadOf(boardId, {
        ...object, canvasData: object.canvasData ?? {}, content: object.content ?? {},
      }), versionOf(object.id));
    }
    for (const connection of snapshot.graph.connections) {
      live.add(key(CANVAS_EDGE, connection.id));
      await ingest(CANVAS_EDGE, connection.id, edgePayloadOf(boardId, { ...connection, metadata: connection.metadata ?? {} }), versionOf(connection.id));
    }
    for (const message of snapshot.timeline) {
      const id = timelineRecordId(boardId, message.clientMessageId);
      live.add(key(CANVAS_TIMELINE, id));
      await ingest(CANVAS_TIMELINE, id, { ...message, boardId } satisfies TimelinePayload, snapshot.revision);
    }

    if (options.replaceMissing) {
      const children = await childRecordsOf(tx, boardId);
      for (const row of [...children.objects, ...children.edges]) {
        const listed = live.has(key(row.entityType, row.id));
        if (listed || hasPending.has(key(row.entityType, row.id))) continue;
        // Never held by the server (an unsynced local row) is not a server deletion.
        if (!(await tx.mapping(row.entityType, row.id, destination))) continue;
        await tx.put<ObjectPayload | EdgePayload>({ ...row, version: row.version + 1, baseVersion: row.version, updatedAt: stamp, deletedAt: stamp, provenance: { ...SERVER_OBSERVED } }, row.version);
        result.removed += 1;
      }
    }
    return result;
  });
}

/** First open of a server board with no replica: the whole snapshot, once. */
export function seedFromServer(
  store: LocalFirstStore,
  snapshot: ServerBoardSnapshot,
  destination: EntityDestination,
  options: { now?: () => Date } = {},
): Promise<IngestResult> {
  return ingestFromServer(store, snapshot, destination, options);
}
