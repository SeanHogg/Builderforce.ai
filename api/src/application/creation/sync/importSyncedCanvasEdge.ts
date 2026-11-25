/**
 * Import one canvas EDGE (a connection between two cards) from a device's journal.
 *
 * Payload: `{ boardId, source, target, kind?, data?: { label?, metadata? } }`. The edge's
 * id is the client's edge uuid and is the server row id. Both endpoints must be objects of
 * the board already; an endpoint that has not landed is a HOLD (`dependency_pending`) —
 * the device lists both objects' creates in `dependsOn`, and a raced edge is retried, not
 * lost. Writes go through the same per-edit seam as an object (`applyBoardEdit`,
 * `connectionUpsertStatement`), under the same editor-or-above board gate.
 *
 * Deleting an object removes its edges by foreign-key cascade, so a later delete of one of
 * those edges finds nothing and is acknowledged.
 */

import { isCreationConnectionKind } from '@builderforce/creation-canvas-contract';
import type { Db, Tx } from '../../../infrastructure/database/connection';
import {
  appliedExisting,
  appliedNew,
  conflict,
  mutateGate,
  pending,
  preludeRejection,
  rejected,
  sameCanonical,
  type BoundedImportOutcome,
} from '../../sync/importers';
import type { SyncEntityMappingRow, SyncEventInput, SyncImportContext, SyncStoreSet } from '../../sync/syncPorts';
import { applyBoardEdit } from '../boardEditWriter';
import {
  MAX_CREATION_CONNECTIONS,
  connectionDeleteStatement,
  connectionUpsertStatement,
  type GraphConnectionInput,
} from '../creationGraphWriter';
import { resolveBoardForSync } from './canvasSyncAccess';
import { boardOfConnection, countBoardConnections, objectsOnBoard } from './canvasGraphReads';
import { canvasWriteFailure, editOutcome } from './canvasSyncOutcome';
import type { CanvasSyncPorts } from './canvasSyncPorts';
import { canvasRowId, payloadRecord, readBoardId, type Parsed } from './canvasSyncPayload';

const SOURCE = 'importSyncedCanvasEdge.ts';
const INVALID = 'canvas_edge_invalid';
const MAX_METADATA_JSON_CHARS = 20_000;

interface EdgeFields {
  boardId: string;
  edge: GraphConnectionInput;
}

function readEdge(payload: unknown, edgeId: string): Parsed<EdgeFields> {
  const raw = payloadRecord(payload);
  if (!raw) return { ok: false, detail: 'payload_invalid' };
  const board = readBoardId(raw, INVALID);
  if (!board.ok) return board;
  const source = canvasRowId(raw.source);
  const target = canvasRowId(raw.target);
  if (!source || !target) return { ok: false, detail: INVALID };
  if (raw.kind !== undefined && !isCreationConnectionKind(raw.kind)) return { ok: false, detail: INVALID };
  const data = raw.data === undefined || raw.data === null ? {} : payloadRecord(raw.data);
  if (!data) return { ok: false, detail: INVALID };
  const label = data.label === undefined || data.label === null ? null : data.label;
  if (label !== null && (typeof label !== 'string' || label.length > 255)) return { ok: false, detail: INVALID };
  const metadata = data.metadata === undefined || data.metadata === null ? null : payloadRecord(data.metadata);
  if (data.metadata !== undefined && data.metadata !== null && !metadata) return { ok: false, detail: INVALID };
  if (metadata && JSON.stringify(metadata).length > MAX_METADATA_JSON_CHARS) return { ok: false, detail: INVALID };
  return {
    ok: true,
    value: {
      boardId: board.value,
      edge: {
        id: edgeId,
        sourceObjectId: source,
        targetObjectId: target,
        kind: typeof raw.kind === 'string' ? raw.kind : 'reference',
        label,
        metadata,
      },
    },
  };
}

function canonical({ boardId, edge }: EdgeFields) {
  return {
    boardId,
    source: edge.sourceObjectId,
    target: edge.targetObjectId,
    kind: edge.kind ?? 'reference',
    label: edge.label ?? null,
    metadata: edge.metadata ?? null,
  };
}

async function writeEdge(
  event: SyncEventInput,
  ctx: SyncImportContext,
  tx: Tx,
  mapping: SyncEntityMappingRow | null,
  ports: CanvasSyncPorts,
  fields: EdgeFields,
  operation: 'createEdge' | 'updateEdge',
): Promise<BoundedImportOutcome> {
  const db = tx as unknown as Db;
  const board = await resolveBoardForSync(tx, ctx, fields.boardId, { minimum: 'editor' });
  if (board.kind === 'outcome') return board.outcome;
  const { session } = board.access;
  const { edge } = fields;
  const present = await objectsOnBoard(db, session.id, [edge.sourceObjectId, edge.targetObjectId]);
  if (!present.has(edge.sourceObjectId) || !present.has(edge.targetObjectId)) return pending('canvas_edge_endpoint_pending');
  if (!mapping && await countBoardConnections(db, session.id) >= MAX_CREATION_CONNECTIONS) return rejected('canvas_edge_limit');
  const stored = canonical(fields);
  try {
    const result = await applyBoardEdit(tx, {
      sessionId: session.id,
      tenantId: session.tenantId,
      authorUserId: ctx.auth.userId,
      eventType: mapping ? 'connection.updated' : 'connection.created',
      eventPayload: { connectionId: edge.id },
      idempotencyKey: `sync:${event.eventId}`,
      content: (editDb) => [connectionUpsertStatement(editDb, session.id, edge, ctx.auth.userId)],
      // The conflict update is scoped to this board: no row back means the id is another board's connection.
      refuse: ([upserted]) => (Array.isArray(upserted) && upserted.length > 0 ? null : INVALID),
    });
    if (result.status === 'applied') ctx.afterCommit(ports.scheduleSnapshot(session.tenantId, session.id));
    return editOutcome(result, { serverId: edge.id, destinationKey: ctx.destinationKey, stored, mapping });
  } catch (error) {
    return canvasWriteFailure(error, SOURCE, operation);
  }
}

async function createEdge(
  event: SyncEventInput,
  ctx: SyncImportContext,
  tx: Tx,
  mapping: SyncEntityMappingRow | null,
  ports: CanvasSyncPorts,
): Promise<BoundedImportOutcome> {
  const id = canvasRowId(event.clientEntityId);
  if (!id) return rejected(INVALID);
  const parsed = readEdge(event.payload, id);
  if (!parsed.ok) return rejected(parsed.detail);
  const stored = canonical(parsed.value);
  if (mapping) {
    if (mapping.destinationKey !== ctx.destinationKey) return rejected('destination_mismatch');
    if (sameCanonical(mapping, stored)) return appliedExisting(mapping, stored);
    return conflict(mapping, 'entity_already_imported');
  }
  return writeEdge(event, ctx, tx, null, ports, parsed.value, 'createEdge');
}

async function updateEdge(
  event: SyncEventInput,
  ctx: SyncImportContext,
  tx: Tx,
  mapping: SyncEntityMappingRow | null,
  ports: CanvasSyncPorts,
): Promise<BoundedImportOutcome> {
  const gate = mutateGate(event, ctx, mapping);
  if (gate) return gate;
  const current = mapping as SyncEntityMappingRow;
  const id = canvasRowId(current.serverId);
  if (!id) return rejected('server_id_invalid');
  const parsed = readEdge(event.payload, id);
  if (!parsed.ok) return rejected(parsed.detail);
  const stored = canonical(parsed.value);
  if (sameCanonical(current, stored)) return appliedExisting(current, stored);
  return writeEdge(event, ctx, tx, current, ports, parsed.value, 'updateEdge');
}

async function deleteEdge(
  event: SyncEventInput,
  ctx: SyncImportContext,
  tx: Tx,
  mapping: SyncEntityMappingRow | null,
  ports: CanvasSyncPorts,
): Promise<BoundedImportOutcome> {
  const tombstone = null;
  const gate = mutateGate(event, ctx, mapping, tombstone);
  if (gate) return gate;
  const current = mapping as SyncEntityMappingRow;
  const id = canvasRowId(current.serverId);
  if (!id) return rejected('server_id_invalid');
  const db = tx as unknown as Db;
  const raw = payloadRecord(event.payload);
  const named = raw ? readBoardId(raw, INVALID) : null;
  const boardId = named?.ok ? named.value : await boardOfConnection(db, ctx.auth.tenantId, id);
  const gone = appliedNew(current.serverId, current.serverVersion + 1, ctx.destinationKey, tombstone);
  if (!boardId) return gone;
  const board = await resolveBoardForSync(tx, ctx, boardId, { minimum: 'editor', allowDeleted: true });
  if (board.kind === 'outcome') return board.outcome;
  const { session } = board.access;
  if (session.status === 'deleted') return gone;
  try {
    const result = await applyBoardEdit(tx, {
      sessionId: session.id,
      tenantId: session.tenantId,
      authorUserId: ctx.auth.userId,
      eventType: 'connection.deleted',
      eventPayload: { connectionId: id },
      idempotencyKey: `sync:${event.eventId}`,
      content: (editDb) => [connectionDeleteStatement(editDb, session.id, id)],
    });
    if (result.status === 'applied') ctx.afterCommit(ports.scheduleSnapshot(session.tenantId, session.id));
    return editOutcome(result, { serverId: id, destinationKey: ctx.destinationKey, stored: tombstone, mapping: current });
  } catch (error) {
    return canvasWriteFailure(error, SOURCE, 'deleteEdge');
  }
}

/** Apply one already-validated edge mutation inside the push's unit of work. */
export async function importSyncedCanvasEdge(
  event: SyncEventInput,
  ctx: SyncImportContext,
  stores: SyncStoreSet,
  tx: Tx,
  ports: CanvasSyncPorts,
): Promise<BoundedImportOutcome> {
  if (event.entityType !== 'canvas-edge') return rejected('entity_type_rejected');
  const prelude = preludeRejection(event, ctx);
  if (prelude) return prelude;
  const mapping = await stores.findMapping(ctx.auth.tenantId, event.entityType, event.clientEntityId);
  if (event.operation === 'delete') return deleteEdge(event, ctx, tx, mapping, ports);
  if (event.operation === 'update') return updateEdge(event, ctx, tx, mapping, ports);
  if (event.operation === 'create' || event.operation === 'import') return createEdge(event, ctx, tx, mapping, ports);
  return rejected('operation_unsupported');
}
