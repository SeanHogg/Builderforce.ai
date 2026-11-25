/**
 * TEST KIT for the board library: a real IndexedDB-backed store over `fake-indexeddb`, a boards
 * factory, and a fake of the server's `/api/sync/v1/push` (and of the REST read the reconcile uses).
 *
 * The fake mirrors the rules the library relies on, nothing more: receipts keyed by the wire event id
 * (a replay is a `duplicate`), a child held `dependency_pending` until its board and dependencies are
 * accepted, a per-entity version bumped on every accepted write, `conflict` when an update's
 * `baseVersion` is behind (and for any edit of a tombstone: delete wins), and a `canvas_revision` per
 * board that counts every accepted write. It is not the server; the real importers are `api/`'s.
 */

import { createIndexedDbLocalFirstStore, type IndexedDbLocalFirstStore } from '@builderforce/local-first/indexed-db';
import type { EntityDestination, HttpSyncFetch, JournalEvent } from '@builderforce/local-first';
import type { CanvasBoard } from '../../domain/canvasBoard';
import type { CanvasObject } from '../../domain/canvasObject';
import { createBlobStore, type BlobStore } from './blobStore';
import type { BoardWriteContext } from './boardCommit';
import {
  CANVAS_BOARD,
  CANVAS_EDGE,
  CANVAS_OBJECT,
  CANVAS_TIMELINE,
  persistedConnectionOf,
  persistedObjectOf,
  type BoardPayload,
  type EdgePayload,
  type ObjectPayload,
  type ServerBoardSnapshot,
  type TimelinePayload,
} from './boardRecords';

export const ACCOUNT = {
  kind: 'bound', platformInstance: 'https://builderforce.example', accountId: 'account-1', tenantId: 'tenant-1',
} as const satisfies EntityDestination;

export const AT = '2026-11-24T12:00:00.000Z';

let counter = 0;
/** A UUID-shaped id that is stable per call order within a run (the sync envelope wants UUIDs). */
export const uuid = (): string => {
  counter += 1;
  return `00000000-0000-4000-8000-${counter.toString(16).padStart(12, '0')}`;
};

export function openTestStore(indexedDB: IDBFactory, dbName: string, ownerId = 'device-a', extra: { busyTimeoutMs?: number } = {}): IndexedDbLocalFirstStore {
  return createIndexedDbLocalFirstStore({ indexedDB, dbName, partition: 'test', ownerId, locks: null, ...extra });
}

export const testContext = (store: IndexedDbLocalFirstStore, deviceId = 'device-a'): BoardWriteContext => ({ store, deviceId, now: () => new Date(AT) });

export function openTestBlobs(indexedDB: IDBFactory, dbName: string): BlobStore {
  // `crypto.subtle` is not in every test host; a hash only has to be stable here.
  return createBlobStore({ indexedDB, dbName, opfs: null, estimate: async () => undefined, hash: async (data) => `sha:${data.byteLength}` });
}

export const sticky = (id: string, x: number, title = 'Note'): CanvasObject => ({
  id, type: 'creation', position: { x, y: 0 }, data: { kind: 'sticky', title },
});

export const boardOf = (nodes: CanvasObject[], edges: CanvasBoard['edges'] = []): CanvasBoard => ({ nodes, edges });

export const link = (id: string, source: string, target: string): CanvasBoard['edges'][number] => ({ id, source, target, type: 'smoothstep', data: { connectionKind: 'reference' } });

interface Entity { entityType: string; id: string; version: number; payload: unknown; deleted: boolean }

export interface FakeBoardServer {
  fetch: HttpSyncFetch;
  /** Push requests that reached the server (a refused or offline one is not counted). */
  pushes: JournalEvent[][];
  attempts: number;
  /** What the next requests do, in order: fail with a status (and `Retry-After`) before succeeding. */
  failWith: Array<{ status: number; retryAfter?: string }>;
  offline: boolean;
  /** Holds every push until released — to observe concurrency. */
  gate?: Promise<void>;
  inFlight: number;
  maxInFlight: number;
  entity(type: string, id: string): Entity | undefined;
  revision(boardId: string): number;
  /** The REST view of a board (what the reconcile source reads). */
  snapshot(boardId: string): ServerBoardSnapshot;
  /** A collaborator edits an object on the server (a room/poll delivery, a Brain write). */
  collaboratorEdit(boardId: string, objectId: string, patch: Partial<ObjectPayload['content']>): void;
  collaboratorDeleteObject(boardId: string, objectId: string): void;
  collaboratorAddObject(boardId: string, object: ObjectPayload): void;
}

export function createFakeBoardServer(): FakeBoardServer {
  const entities = new Map<string, Entity>();
  const revisions = new Map<string, number>();
  const receipts = new Map<string, { status: string; serverVersion?: number; detail?: string }>();
  const accepted = new Set<string>();
  const key = (type: string, id: string): string => `${type}\u0000${id}`;
  const boardOfEvent = (event: JournalEvent): string => event.entityType === CANVAS_BOARD ? event.clientEntityId : (event.payload as { boardId: string }).boardId;
  const bump = (boardId: string): void => { revisions.set(boardId, (revisions.get(boardId) ?? 0) + 1); };

  function apply(event: JournalEvent): { status: string; serverVersion?: number; detail?: string } {
    const seen = receipts.get(event.eventId);
    if (seen) return { ...seen, status: 'duplicate' };
    if (event.dependsOn.some((id) => !accepted.has(id))) return { status: 'dependency_pending', detail: 'dependency_unresolved' };
    const existing = entities.get(key(event.entityType, event.clientEntityId));
    if (event.entityType !== CANVAS_BOARD && !entities.get(key(CANVAS_BOARD, boardOfEvent(event)))) return { status: 'dependency_pending', detail: 'canvas_board_unresolved' };
    if (event.operation === 'create') {
      if (existing) return { status: 'conflict', detail: 'entity_already_imported' };
      entities.set(key(event.entityType, event.clientEntityId), { entityType: event.entityType, id: event.clientEntityId, version: 1, payload: event.payload, deleted: false });
      bump(boardOfEvent(event));
      return { status: 'accepted', serverVersion: 1 };
    }
    if (!existing) return { status: 'rejected', detail: 'entity_not_imported' };
    // Delete wins: an edit of a tombstone is never applied, and there is no timestamp tie-break.
    if (existing.deleted) return { status: 'conflict', detail: 'entity_deleted' };
    if (event.baseVersion !== undefined && event.baseVersion < existing.version) return { status: 'conflict', detail: 'base_version_behind' };
    existing.version += 1;
    existing.payload = event.payload;
    existing.deleted = event.operation === 'delete';
    bump(boardOfEvent(event));
    return { status: 'accepted', serverVersion: existing.version };
  }

  const server: FakeBoardServer = {
    pushes: [], attempts: 0, failWith: [], offline: false, inFlight: 0, maxInFlight: 0,
    fetch: async (_url, init) => {
      server.attempts += 1;
      if (server.offline) throw new TypeError('Failed to fetch');
      const failure = server.failWith.shift();
      if (failure) {
        return {
          ok: false, status: failure.status, json: async () => ({ error: 'unavailable' }),
          headers: { get: (name: string) => (name.toLowerCase() === 'retry-after' ? failure.retryAfter ?? null : null) },
        };
      }
      server.inFlight += 1;
      server.maxInFlight = Math.max(server.maxInFlight, server.inFlight);
      try {
        if (server.gate) await server.gate;
        const batch = JSON.parse(init.body) as { events: JournalEvent[] };
        server.pushes.push(batch.events);
        const out = batch.events.map((event) => {
          const result = apply(event);
          receipts.set(event.eventId, result);
          if (result.status === 'accepted' || result.status === 'duplicate') accepted.add(event.eventId);
          return { eventId: event.eventId, receivedAt: AT, serverId: event.clientEntityId, ...result };
        });
        return { ok: true, status: 200, json: async () => ({ receipts: out }), headers: { get: () => null } };
      } finally {
        server.inFlight -= 1;
      }
    },
    entity: (type, id) => entities.get(key(type, id)),
    revision: (boardId) => revisions.get(boardId) ?? 0,
    snapshot(boardId) {
      const live = (type: string): Entity[] => [...entities.values()].filter((row) => row.entityType === type && !row.deleted && (row.payload as { boardId?: string }).boardId === boardId);
      const board = entities.get(key(CANVAS_BOARD, boardId))!;
      const header = board.payload as BoardPayload;
      return {
        id: boardId,
        title: header.title,
        ...(header.folder ? { folder: header.folder } : {}),
        revision: revisions.get(boardId) ?? 0,
        graph: {
          objects: live(CANVAS_OBJECT).map((row) => persistedObjectOf(row.id, row.payload as ObjectPayload)),
          connections: live(CANVAS_EDGE).map((row) => persistedConnectionOf(row.id, row.payload as EdgePayload)),
        },
        timeline: live(CANVAS_TIMELINE).map((row) => { const { boardId: _b, ...message } = row.payload as TimelinePayload; return message; }),
        versions: Object.fromEntries([...entities.values()].map((row) => [row.id, row.version])),
      };
    },
    collaboratorEdit(boardId, objectId, patch) {
      const row = entities.get(key(CANVAS_OBJECT, objectId))!;
      const payload = row.payload as ObjectPayload;
      row.payload = { ...payload, content: { ...payload.content, ...patch } };
      row.version += 1;
      bump(boardId);
    },
    collaboratorDeleteObject(boardId, objectId) {
      const row = entities.get(key(CANVAS_OBJECT, objectId))!;
      row.deleted = true;
      row.version += 1;
      bump(boardId);
    },
    collaboratorAddObject(boardId, object) {
      entities.set(key(CANVAS_OBJECT, object.id), { entityType: CANVAS_OBJECT, id: object.id, version: 1, payload: object, deleted: false });
      bump(boardId);
    },
  };
  return server;
}
