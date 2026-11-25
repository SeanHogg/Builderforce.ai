/**
 * THE BOARD RECORD VOCABULARY — what a canvas board is as local-first records, with no I/O.
 *
 * A board is not one blob. It is five record types (studio-local-first design §1): the session row
 * (`canvas-board`), one record per object, one per connection, one per transcript message and one
 * per media manifest. Per-object records are what make an edit a small journal event, let two
 * devices edit different cards without a conflict, and let compaction collapse superseded updates
 * object by object.
 *
 * Everything here is a type, a constant or a pure function over ids and payloads: the shapes, the
 * id rules, the event-key rule and the one place a payload is split into what SYNCS and what stays on
 * this device (the viewport and the last server revision are this device's own).
 */

import { stableEntityId, isLocalId, type LocalRecord } from '@builderforce/local-first';
import type { ChatMode } from '@/lib/brain';
import type {
  PersistableCanvasConnection,
  PersistableCanvasGraph,
  PersistableCanvasObject,
  PersistedCanvasGraph,
} from '../../domain/canvasBoard';

export const CANVAS_BOARD = 'canvas-board' as const;
export const CANVAS_OBJECT = 'canvas-object' as const;
export const CANVAS_EDGE = 'canvas-edge' as const;
export const CANVAS_TIMELINE = 'canvas-timeline' as const;
export const CANVAS_MEDIA = 'canvas-media' as const;

/** The child types: each carries `boardId` and takes its destination from the board. */
export const CANVAS_CHILD_TYPES = [CANVAS_OBJECT, CANVAS_EDGE, CANVAS_TIMELINE, CANVAS_MEDIA] as const;
export type CanvasChildType = (typeof CANVAS_CHILD_TYPES)[number];

/** All five record types are `schemaVersion: 1`. */
export const CANVAS_RECORD_SCHEMA_VERSION = 1;

export interface BoardViewport { x: number; y: number; zoom: number }

/**
 * The session row. `viewport` and `serverRevision` are THIS DEVICE's: the viewport is never merged
 * between devices, and `serverRevision` is the `canvasRevision` the replica was last reconciled
 * with. Neither is sent (`syncedBoardPayload`), and a write that changes only them is not journaled.
 */
export interface BoardPayload {
  title: string;
  folder?: string;
  mode?: ChatMode;
  initialPrompt?: string;
  branchParentId?: string;
  viewport?: BoardViewport;
  serverRevision?: number;
  /** The role the server last gave THIS person on the board: kept so a viewer who opens it offline cannot edit. This device's own; never sent. */
  role?: 'viewer' | 'commenter' | 'editor' | 'runner' | 'owner';
}

export type SyncedBoardPayload = Omit<BoardPayload, 'viewport' | 'serverRevision' | 'role'>;

/** One persisted node (`persistedGraphFromBoard`) plus the board it is on. */
export type ObjectPayload = PersistableCanvasObject & { boardId: string };

export interface EdgePayload {
  boardId: string;
  source: string;
  target: string;
  kind: string;
  data: { label: string | null; metadata: Record<string, unknown> };
}

export type TimelineRole = 'user' | 'assistant' | 'system';

export interface TimelinePayload {
  boardId: string;
  clientMessageId: string;
  role: TimelineRole;
  body: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export type MediaStatus = 'local' | 'uploading' | 'uploaded' | 'failed';

/** A blob's manifest. The BYTES are in the `BlobStore`, never in the record. */
export interface MediaPayload {
  boardId: string;
  objectId?: string;
  mimeType: string;
  bytes: number;
  sha256: string;
  name: string;
  status: MediaStatus;
  storageKey?: string;
  /** Upload attempts so far — this device's bookkeeping, not synced. */
  attempts?: number;
  /** ISO time before which a failed upload is not tried again — this device's bookkeeping, not synced. */
  nextAttemptAt?: string;
}

export type SyncedMediaPayload = Omit<MediaPayload, 'attempts' | 'nextAttemptAt'>;

export type BoardRecord = LocalRecord<BoardPayload>;

/** The server's board as the reconcile port hands it over (REST today, the pull projector later). */
export interface ServerBoardSnapshot {
  id: string;
  title: string;
  folder?: string;
  mode?: ChatMode;
  /** `canvasRevision`. */
  revision: number;
  graph: PersistedCanvasGraph;
  timeline: ReadonlyArray<Omit<TimelinePayload, 'boardId'>>;
  /** Per-record server versions, when the source knows them; the revision stands in otherwise. */
  versions?: Readonly<Record<string, number>>;
}

/** The journal's logical-write name, `<entityType>:<id>:v<version>` (the work-management convention). */
export const eventKey = (entityType: string, id: string, version: number): string => `${entityType}:${id}:v${version}`;

/** The key every child event waits on: a board's creating write, whatever local version it was made at. */
export const boardCreateKey = (boardId: string): string => eventKey(CANVAS_BOARD, boardId, 1);

export const timelineRecordId = (boardId: string, clientMessageId: string): string =>
  stableEntityId(`canvas-timeline:${boardId}:${clientMessageId}`);

/** A record id the sync envelope accepts: a UUID kept as is, anything else made deterministic. */
export const syncableId = (scope: string, id: string): string => (isLocalId(id) ? id : stableEntityId(`${scope}:${id}`));

/** What an object's `url` says when its bytes are only on this device. */
export const MEDIA_URL_PREFIX = 'media:';
export const mediaUrl = (mediaId: string): string => `${MEDIA_URL_PREFIX}${mediaId}`;

const MEDIA_REF = /media:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/g;

/** The media ids a payload refers to, by `media:<id>` anywhere in it. */
export function mediaIdsIn(payload: unknown): string[] {
  const found = new Set<string>();
  for (const match of JSON.stringify(payload ?? null).matchAll(MEDIA_REF)) found.add(match[1]!);
  return [...found];
}

/** What leaves the device: the board without this device's own fields. */
export function syncedBoardPayload(payload: BoardPayload): SyncedBoardPayload {
  const { viewport: _viewport, serverRevision: _serverRevision, role: _role, ...synced } = payload;
  return synced;
}

export function syncedMediaPayload(payload: MediaPayload): SyncedMediaPayload {
  const { attempts: _attempts, nextAttemptAt: _nextAttemptAt, ...synced } = payload;
  return synced;
}

export const objectPayloadOf = (boardId: string, object: PersistableCanvasObject): ObjectPayload => ({ ...object, boardId });

export function edgePayloadOf(boardId: string, connection: PersistableCanvasConnection): EdgePayload {
  return {
    boardId,
    source: connection.sourceObjectId,
    target: connection.targetObjectId,
    kind: connection.kind ?? 'reference',
    data: { label: connection.label ?? null, metadata: connection.metadata },
  };
}

/** The persisted object a record holds (the inverse of `objectPayloadOf`, for the anti-corruption boundary). */
export function persistedObjectOf(id: string, payload: ObjectPayload): PersistableCanvasObject {
  const { boardId: _boardId, ...object } = payload;
  return { ...object, id };
}

export function persistedConnectionOf(id: string, payload: EdgePayload): PersistableCanvasConnection {
  return {
    id,
    sourceObjectId: payload.source,
    targetObjectId: payload.target,
    kind: payload.kind,
    label: payload.data.label,
    metadata: payload.data.metadata,
  };
}

/** What changed between two persisted graphs, by id: the objects and connections to write and to delete. */
export interface GraphDiff {
  upsertObjects: PersistableCanvasObject[];
  deleteObjectIds: string[];
  upsertConnections: PersistableCanvasConnection[];
  deleteConnectionIds: string[];
}

/** JSON with object keys sorted: two payloads that differ only in key order are the same payload. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, child: unknown) =>
    child && typeof child === 'object' && !Array.isArray(child)
      ? Object.fromEntries(Object.entries(child as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : child);
}

export const samePayload = (a: unknown, b: unknown): boolean => canonicalJson(a) === canonicalJson(b);

/** A payload without the fields the upload queue rewrites (`url`, `storageKey`) — everything else a person edited. */
function withoutMediaUrls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutMediaUrls);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => key !== 'url' && key !== 'storageKey').map(([key, child]) => [key, withoutMediaUrls(child)]));
}

/**
 * Whether two payloads differ ONLY in where their media lives. The upload queue rewrites
 * `media:<id>` to the uploaded url (a journaled edit); a tab that still holds the old reference has
 * not edited anything the person could disagree about, so that is a merge, not a conflict.
 */
export const sameExceptMediaUrls = (a: unknown, b: unknown): boolean => canonicalJson(withoutMediaUrls(a)) === canonicalJson(withoutMediaUrls(b));

const same = samePayload;

/** The per-object signature diff of design §3: only the changed, added and removed rows. */
export function diffGraphs(
  prev: Pick<PersistableCanvasGraph, 'objects' | 'connections'>,
  next: Pick<PersistableCanvasGraph, 'objects' | 'connections'>,
): GraphDiff {
  const before = new Map(prev.objects.map((object) => [object.id, object]));
  const beforeEdges = new Map(prev.connections.map((connection) => [connection.id, connection]));
  const nextIds = new Set(next.objects.map((object) => object.id));
  const nextEdgeIds = new Set(next.connections.map((connection) => connection.id));
  return {
    upsertObjects: next.objects.filter((object) => !same(before.get(object.id), object)),
    deleteObjectIds: prev.objects.filter((object) => !nextIds.has(object.id)).map((object) => object.id),
    upsertConnections: next.connections.filter((connection) => !same(beforeEdges.get(connection.id), connection)),
    deleteConnectionIds: prev.connections.filter((connection) => !nextEdgeIds.has(connection.id)).map((connection) => connection.id),
  };
}

/**
 * `value` with every `media:<id>` string replaced by the uploaded URL, and `storageKey` set beside it —
 * the rewrite the upload queue journals once the bytes are on the server.
 */
export function rewriteMediaRefs<T>(value: T, mediaId: string, uploaded: { url: string; storageKey: string }): T {
  const ref = mediaUrl(mediaId);
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node === null || typeof node !== 'object') return node;
    const entries = Object.entries(node as Record<string, unknown>);
    const holdsRef = entries.some(([, child]) => child === ref);
    const rewritten = Object.fromEntries(entries.map(([key, child]) => [key, child === ref ? uploaded.url : walk(child)]));
    return holdsRef ? { ...rewritten, storageKey: uploaded.storageKey } : rewritten;
  };
  return walk(value) as T;
}

/**
 * The board id a legacy `local-<uuid>` route id becomes: the uuid itself, or a deterministic id when
 * the suffix is not one. The legacy import and the route's URL swap name the same board by this one rule.
 */
export const legacyBoardId = (localId: string): string => {
  const suffix = localId.startsWith('local-') ? localId.slice('local-'.length) : localId;
  return isLocalId(suffix) ? suffix : stableEntityId(`canvas-legacy:${localId}`);
};

/** The legacy import's marker name for one board (`canvas-legacy-import:<localId>`). */
export const legacyImportMark = (localId: string): string => `canvas-legacy-import:${localId}`;
