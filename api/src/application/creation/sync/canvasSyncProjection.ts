/**
 * Server-originated Canvas changes in the sync PULL projection (WC-G009).
 *
 * A device's own edits reach `sync_records` / `sync_changes` through the push importers. Edits that
 * come from anywhere else — the board's HTTP routes, another member, an agent's commands, a template
 * apply, a server-side merge — wrote only the Canvas tables, so a pull never carried them and Studio
 * reconciles over REST instead. This projects a board's committed rows into the same records, in the
 * same payload shape the importers store, so `BoardReconcileSource` can move to pull once the live
 * checks (backfill, shared and revoked boards) have passed.
 *
 * It is a RECONCILER, not a per-write hook: it reads the board's current rows, compares each with
 * the projected record's payload hash, and writes only what differs (a new record, a changed one, a
 * tombstone for a row that is gone). That one function is also the backfill, and it makes a push
 * (which already projected the row) a no-op rather than a double write.
 *
 * - `canvas-media` is pushed only from devices (the bytes live on the device), so it is not projected.
 * - `canvas-timeline` is not projected: a timeline row's id is a bigserial and its client message id
 *   is free text, neither of which fits the UUID record key. Studio keeps reading the transcript over REST.
 * - Read access is NOT decided here: pull filters every Canvas record by board membership
 *   (`SyncPullRepository`), so a record projected for a board is invisible to people who are not on it.
 */

import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { destinationKey, isLocalId, type EntityDestination } from '@builderforce/local-first';
import type { Db } from '../../../infrastructure/database/connection';
import { inTransaction } from '../../../infrastructure/database/connection';
import {
  creationSessionConnections,
  creationSessionObjects,
  creationSessions,
} from '../../../infrastructure/database/schema';
import { syncChanges, syncRecords } from '../../../infrastructure/database/schema/sync';
import { scopedToTenant } from '../../../infrastructure/database/tenantScope';
import { CLIENT_REPORTED_EVIDENCE } from '../../../domain/sync/occurredAtGate';
import { hashSyncPayload } from '../../../domain/sync/syncProtocol';
import { reportCaughtError } from '../../observability/caughtErrorReporter';

/** The device id a server-originated Canvas record is attributed to (no client pushed it). */
export const SERVER_CANVAS_DEVICE_ID = 'server-canvas';
/** The Canvas record contract's schema version (the one the importers and the device write). */
export const CANVAS_PROJECTION_SCHEMA_VERSION = 1;

export type ProjectedCanvasType = 'canvas-board' | 'canvas-object' | 'canvas-edge';
const BOARD_CHILD_TYPES: readonly ProjectedCanvasType[] = ['canvas-object', 'canvas-edge'];

export interface CanvasProjectionScope {
  tenantId: number;
  /** The workspace destination the device's Canvas records are written under (`{ kind: 'bound', tenantId }`). */
  destination: Extract<EntityDestination, { kind: 'bound' }>;
}

export function canvasProjectionScope(tenantId: number): CanvasProjectionScope {
  return { tenantId, destination: { kind: 'bound', tenantId: String(tenantId) } };
}

/** One record the board's rows say should exist. A `deleted` one is a tombstone. */
export interface DesiredCanvasRecord {
  entityType: ProjectedCanvasType;
  clientEntityId: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
  deleted: boolean;
}

/** What `sync_records` already holds for one of those records. */
export interface ProjectedCanvasRecord {
  entityType: string;
  clientEntityId: string;
  version: number;
  destinationKey: string;
  payloadHash: string;
  payload: unknown;
  deletedAt: Date | null;
}

export interface CanvasProjectionChange extends DesiredCanvasRecord {
  operation: 'create' | 'update' | 'delete';
  version: number;
}

type SessionRow = Pick<typeof creationSessions.$inferSelect, 'id' | 'title' | 'mode' | 'status' | 'updatedAt'>;
type ObjectRow = typeof creationSessionObjects.$inferSelect;
type EdgeRow = typeof creationSessionConnections.$inferSelect;

// The mappers produce exactly the canonical payloads the push importers store (importSyncedCanvas*),
// so a record a device pushed and one projected from the same row hash identically.

export function boardPayload(row: Pick<SessionRow, 'title' | 'mode'>): Record<string, unknown> {
  return { title: row.title, mode: row.mode };
}

export function objectPayload(row: ObjectRow): Record<string, unknown> {
  return {
    boardId: row.sessionId,
    kind: row.kind,
    resourceType: row.resourceType ?? null,
    resourceId: row.resourceId ?? null,
    resourceRevision: row.resourceRevision ?? null,
    canvasData: row.canvasData,
    content: row.content ?? null,
  };
}

export function edgePayload(row: EdgeRow): Record<string, unknown> {
  return {
    boardId: row.sessionId,
    source: row.sourceObjectId,
    target: row.targetObjectId,
    kind: row.kind,
    label: row.label ?? null,
    metadata: row.metadata ?? null,
  };
}

/** The records a board's current rows should project to. A deleted board is a tombstone; its children go with it. */
export function desiredBoardRecords(session: SessionRow, objects: readonly ObjectRow[], edges: readonly EdgeRow[]): DesiredCanvasRecord[] {
  const gone = session.status === 'deleted';
  const board: DesiredCanvasRecord = {
    entityType: 'canvas-board', clientEntityId: session.id, payload: boardPayload(session), occurredAt: session.updatedAt, deleted: gone,
  };
  if (gone) return [board];
  return [
    board,
    ...objects.map((row): DesiredCanvasRecord => ({ entityType: 'canvas-object', clientEntityId: row.id, payload: objectPayload(row), occurredAt: row.updatedAt, deleted: false })),
    ...edges.map((row): DesiredCanvasRecord => ({ entityType: 'canvas-edge', clientEntityId: row.id, payload: edgePayload(row), occurredAt: row.createdAt, deleted: false })),
  ];
}

const recordKey = (entityType: string, clientEntityId: string) => `${entityType}:${clientEntityId}`;

/**
 * Pure: the writes that bring the projection in line with the board. A record already projected
 * under ANOTHER destination is left to that destination (its owner keeps writing it).
 */
export function planCanvasProjection(
  desired: readonly DesiredCanvasRecord[],
  existing: readonly ProjectedCanvasRecord[],
  scopeKey: string,
  now: Date,
): CanvasProjectionChange[] {
  const stored = new Map(existing.map((row) => [recordKey(row.entityType, row.clientEntityId), row]));
  const changes: CanvasProjectionChange[] = [];
  const wanted = new Set<string>();
  for (const record of desired) {
    const key = recordKey(record.entityType, record.clientEntityId);
    wanted.add(key);
    const current = stored.get(key);
    if (!current) {
      if (!record.deleted) changes.push({ ...record, operation: 'create', version: 1 });
      continue;
    }
    if (current.destinationKey !== scopeKey) continue;
    const dead = current.deletedAt !== null;
    if (record.deleted ? dead : !dead && current.payloadHash === hashSyncPayload(record.payload)) continue;
    changes.push({ ...record, operation: record.deleted ? 'delete' : 'update', version: current.version + 1 });
  }
  for (const current of existing) {
    const key = recordKey(current.entityType, current.clientEntityId);
    if (wanted.has(key) || current.deletedAt !== null || current.destinationKey !== scopeKey) continue;
    // A row the board no longer has: tombstone it, keeping its last payload (pull's boardId gate reads it).
    changes.push({
      entityType: current.entityType as ProjectedCanvasType,
      clientEntityId: current.clientEntityId,
      payload: (current.payload ?? {}) as Record<string, unknown>,
      occurredAt: now,
      deleted: true,
      operation: 'delete',
      version: current.version + 1,
    });
  }
  return changes;
}

const SERVER_PROVENANCE = {
  actorId: 'platform',
  deviceId: SERVER_CANVAS_DEVICE_ID,
  source: 'platform',
  evidence: CLIENT_REPORTED_EVIDENCE,
} as const;

/** Two multi-row inserts (records, then change rows) for any number of changes — never one write per row. */
export async function writeCanvasProjection(
  db: Db,
  scope: CanvasProjectionScope,
  changes: readonly CanvasProjectionChange[],
  now: Date,
): Promise<void> {
  if (changes.length === 0) return;
  const key = destinationKey(scope.destination);
  await inTransaction(db, async (tx) => {
    await tx.insert(syncRecords).values(changes.map((change) => ({
      tenantId: scope.tenantId,
      entityType: change.entityType,
      clientEntityId: change.clientEntityId,
      serverId: change.clientEntityId,
      schemaVersion: CANVAS_PROJECTION_SCHEMA_VERSION,
      version: change.version,
      destinationKey: key,
      occurredAt: change.occurredAt,
      receivedAt: now,
      updatedAt: now,
      deletedAt: change.deleted ? now : null,
      payload: change.payload,
      provenance: SERVER_PROVENANCE as unknown as Record<string, unknown>,
      payloadHash: hashSyncPayload(change.payload),
    }))).onConflictDoUpdate({
      target: [syncRecords.tenantId, syncRecords.entityType, syncRecords.clientEntityId],
      set: {
        version: sql`excluded.version`,
        occurredAt: sql`excluded.occurred_at`,
        updatedAt: sql`excluded.updated_at`,
        deletedAt: sql`excluded.deleted_at`,
        payload: sql`excluded.payload`,
        payloadHash: sql`excluded.payload_hash`,
        provenance: sql`excluded.provenance`,
      },
    });
    await tx.insert(syncChanges).values(changes.map((change) => ({
      tenantId: scope.tenantId,
      entityType: change.entityType,
      clientEntityId: change.clientEntityId,
      serverId: change.clientEntityId,
      operation: change.operation,
      version: change.version,
      destinationKey: key,
      record: {
        id: change.clientEntityId,
        entityType: change.entityType,
        schemaVersion: CANVAS_PROJECTION_SCHEMA_VERSION,
        version: change.version,
        destination: scope.destination,
        occurredAt: change.occurredAt.toISOString(),
        updatedAt: now.toISOString(),
        payload: change.payload,
        provenance: SERVER_PROVENANCE,
        ...(change.deleted ? { deletedAt: now.toISOString() } : {}),
      } as Record<string, unknown>,
      occurredAt: change.occurredAt,
      deviceId: SERVER_CANVAS_DEVICE_ID,
      // Unique per (record, version): a retried reconcile that finds the row already at this version writes nothing.
      eventId: crypto.randomUUID(),
    })));
  });
}

/** The projected records of these boards, by one query: the boards themselves, and their objects and edges by `payload.boardId`. */
export async function projectedRecordsOf(db: Db, tenantId: number, boardIds: readonly string[]): Promise<ProjectedCanvasRecord[]> {
  if (boardIds.length === 0) return [];
  const rows = await db.select({
    entityType: syncRecords.entityType,
    clientEntityId: syncRecords.clientEntityId,
    version: syncRecords.version,
    destinationKey: syncRecords.destinationKey,
    payloadHash: syncRecords.payloadHash,
    payload: syncRecords.payload,
    deletedAt: syncRecords.deletedAt,
  }).from(syncRecords).where(scopedToTenant(
    syncRecords,
    tenantId,
    or(
      and(eq(syncRecords.entityType, 'canvas-board'), inArray(syncRecords.clientEntityId, [...boardIds])),
      and(inArray(syncRecords.entityType, [...BOARD_CHILD_TYPES]), inArray(sql<string>`${syncRecords.payload} ->> 'boardId'`, [...boardIds])),
    ),
  ));
  return rows;
}

/**
 * Pure: the boards one successful board write may have touched — the first UUID in the request path
 * (`/:id`, `/:id/graph`, …) and the id a creating route answers with (`id`, `sessionId`, `session.id`).
 * A guess that is not a board of the tenant reconciles to nothing, so over-naming is harmless.
 */
export function touchedBoardIds(path: string, responseBody: unknown): string[] {
  const ids = new Set<string>();
  const fromPath = path.split('/').find(isLocalId);
  if (fromPath) ids.add(fromPath.toLowerCase());
  const body = responseBody && typeof responseBody === 'object' ? responseBody as Record<string, unknown> : {};
  const nested = body.session && typeof body.session === 'object' ? (body.session as Record<string, unknown>).id : undefined;
  for (const candidate of [body.id, body.sessionId, nested]) {
    if (isLocalId(candidate)) ids.add(candidate.toLowerCase());
  }
  return [...ids];
}

/** Reconcile each board; a failure is reported, never thrown (the write has committed and the next one reconciles it). */
export async function reconcileCanvasBoards(db: Db, scope: CanvasProjectionScope, boardIds: readonly string[]): Promise<void> {
  for (const boardId of boardIds) {
    try {
      await reconcileCanvasBoardProjection(db, scope, boardId);
    } catch (error) {
      reportCaughtError(error, {
        source: 'application/creation/sync/canvasSyncProjection.ts',
        operation: 'reconcileCanvasBoardProjection',
        context: { tenantId: scope.tenantId, boardId },
      });
    }
  }
}

/**
 * Bring ONE board's projection in line with its rows. Returns how many records it wrote. A board
 * that is not this tenant's (or does not exist) writes nothing.
 */
export async function reconcileCanvasBoardProjection(db: Db, scope: CanvasProjectionScope, boardId: string, now: Date = new Date()): Promise<number> {
  const [session] = await db
    .select({ id: creationSessions.id, title: creationSessions.title, mode: creationSessions.mode, status: creationSessions.status, updatedAt: creationSessions.updatedAt })
    .from(creationSessions)
    .where(and(eq(creationSessions.id, boardId), eq(creationSessions.tenantId, scope.tenantId)))
    .limit(1);
  if (!session) return 0;
  const [objects, edges, existing] = await Promise.all([
    db.select().from(creationSessionObjects).where(eq(creationSessionObjects.sessionId, boardId)),
    db.select().from(creationSessionConnections).where(eq(creationSessionConnections.sessionId, boardId)),
    projectedRecordsOf(db, scope.tenantId, [boardId]),
  ]);
  const changes = planCanvasProjection(desiredBoardRecords(session, objects, edges), existing, destinationKey(scope.destination), now);
  await writeCanvasProjection(db, scope, changes, now);
  return changes.length;
}
