/**
 * Import one canvas OBJECT (a card on a board) from a device's journal.
 *
 * One object per event, written through the canvas context's per-edit seam: the object
 * statement (`objectUpsertStatement` / `objectDeleteStatements`) and the revision bump +
 * event (`applyBoardEdit`) — the same building blocks the whole-graph `PUT /:id/graph`
 * shares. The board's snapshot is NOT written per event; the importer registers it with
 * `afterCommit` and the scheduler collapses a chunk's edits into one.
 *
 * The object's id is the client's node uuid and is the server row id. A board the event
 * names that has not landed yet is a HOLD (`dependency_pending`); a board the caller may
 * not write — a viewer, a commenter — is a refusal. A resource the card references (a
 * project, task, agent ...) is validated against the caller's workspace by the same gate
 * every graph write passes (`resourceAccess.ts`).
 *
 * Updating an object a collaborator has since deleted is a CONFLICT (the device keeps its
 * value and offers a restore), never a silent re-insert. Deleting one that is already
 * gone is acknowledged.
 */

import { isCreationObjectKind } from '@builderforce/creation-canvas-contract';
import type { Db, Tx } from '../../../infrastructure/database/connection';
import {
  appliedExisting,
  appliedNew,
  conflict,
  mutateGate,
  preludeRejection,
  rejected,
  sameCanonical,
  type BoundedImportOutcome,
} from '../../sync/importers';
import type { SyncEntityMappingRow, SyncEventInput, SyncImportContext, SyncStoreSet } from '../../sync/syncPorts';
import { applyBoardEdit } from '../boardEditWriter';
import { MAX_CREATION_OBJECTS, objectDeleteStatements, objectUpsertStatement, type GraphObjectInput } from '../creationGraphWriter';
import { validateResourceAccess } from '../resourceAccess';
import { resolveBoardForSync } from './canvasSyncAccess';
import { boardOfObject, countBoardObjects, objectsOnBoard } from './canvasGraphReads';
import { canvasWriteFailure, editOutcome } from './canvasSyncOutcome';
import type { CanvasSyncPorts } from './canvasSyncPorts';
import { canvasRowId, optionalText, payloadRecord, readBoardId, type Parsed } from './canvasSyncPayload';

const SOURCE = 'importSyncedCanvasObject.ts';
const INVALID = 'canvas_object_invalid';
/** A card's content is a document, not a blob: bound what one event may carry. */
const MAX_OBJECT_JSON_CHARS = 1_000_000;

interface ObjectFields {
  boardId: string;
  object: GraphObjectInput;
}

function readObject(payload: unknown, objectId: string): Parsed<ObjectFields> {
  const raw = payloadRecord(payload);
  if (!raw) return { ok: false, detail: 'payload_invalid' };
  const board = readBoardId(raw, INVALID);
  if (!board.ok) return board;
  if (!isCreationObjectKind(raw.kind)) return { ok: false, detail: INVALID };
  const resourceType = optionalText(raw.resourceType, 64);
  const resourceId = optionalText(raw.resourceId, 128);
  const resourceRevision = optionalText(raw.resourceRevision, 128);
  if (!resourceType.ok || !resourceId.ok || !resourceRevision.ok) return { ok: false, detail: INVALID };
  const canvasData = raw.canvasData === undefined ? {} : payloadRecord(raw.canvasData);
  if (!canvasData) return { ok: false, detail: INVALID };
  const content = raw.content === undefined ? null : raw.content;
  if (JSON.stringify([canvasData, content]).length > MAX_OBJECT_JSON_CHARS) return { ok: false, detail: INVALID };
  return {
    ok: true,
    value: {
      boardId: board.value,
      object: {
        id: objectId,
        kind: raw.kind,
        resourceType: resourceType.value,
        resourceId: resourceId.value,
        resourceRevision: resourceRevision.value,
        canvasData,
        content,
      },
    },
  };
}

/** What the mapping's hash is taken over: the object as it will be stored. */
function canonical({ boardId, object }: ObjectFields) {
  return {
    boardId,
    kind: object.kind,
    resourceType: object.resourceType ?? null,
    resourceId: object.resourceId ?? null,
    resourceRevision: object.resourceRevision ?? null,
    canvasData: object.canvasData,
    content: object.content ?? null,
  };
}

async function writeObject(
  event: SyncEventInput,
  ctx: SyncImportContext,
  tx: Tx,
  mapping: SyncEntityMappingRow | null,
  ports: CanvasSyncPorts,
  fields: ObjectFields,
  operation: 'createObject' | 'updateObject',
): Promise<BoundedImportOutcome> {
  const db = tx as unknown as Db;
  const { userId } = ctx.auth;
  const board = await resolveBoardForSync(tx, ctx, fields.boardId, { minimum: 'editor' });
  if (board.kind === 'outcome') return board.outcome;
  const { session } = board.access;
  const denied = await validateResourceAccess(db, [fields.object], session.tenantId, session.segmentId, userId);
  if (denied) return rejected('canvas_resource_denied');
  const exists = (await objectsOnBoard(db, session.id, [fields.object.id])).has(fields.object.id);
  if (mapping && !exists) return conflict(mapping, 'canvas_object_deleted_remotely');
  if (!exists && await countBoardObjects(db, session.id) >= MAX_CREATION_OBJECTS) return rejected('canvas_object_limit');
  const stored = canonical(fields);
  try {
    const result = await applyBoardEdit(tx, {
      sessionId: session.id,
      tenantId: session.tenantId,
      authorUserId: userId,
      eventType: mapping ? 'object.updated' : 'object.created',
      eventObjectId: fields.object.id,
      eventPayload: { objectId: fields.object.id },
      idempotencyKey: `sync:${event.eventId}`,
      content: (editDb) => [objectUpsertStatement(editDb, session.id, fields.object, userId)],
      // The conflict update is scoped to this board: no row back means the id is another board's object.
      refuse: ([upserted]) => (Array.isArray(upserted) && upserted.length > 0 ? null : INVALID),
    });
    if (result.status === 'applied') ctx.afterCommit(ports.scheduleSnapshot(session.tenantId, session.id));
    return editOutcome(result, { serverId: fields.object.id, destinationKey: ctx.destinationKey, stored, mapping });
  } catch (error) {
    return canvasWriteFailure(error, SOURCE, operation);
  }
}

async function createObject(
  event: SyncEventInput,
  ctx: SyncImportContext,
  tx: Tx,
  mapping: SyncEntityMappingRow | null,
  ports: CanvasSyncPorts,
): Promise<BoundedImportOutcome> {
  const id = canvasRowId(event.clientEntityId);
  if (!id) return rejected(INVALID);
  const parsed = readObject(event.payload, id);
  if (!parsed.ok) return rejected(parsed.detail);
  const stored = canonical(parsed.value);
  if (mapping) {
    if (mapping.destinationKey !== ctx.destinationKey) return rejected('destination_mismatch');
    if (sameCanonical(mapping, stored)) return appliedExisting(mapping, stored);
    return conflict(mapping, 'entity_already_imported');
  }
  return writeObject(event, ctx, tx, null, ports, parsed.value, 'createObject');
}

async function updateObject(
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
  const parsed = readObject(event.payload, id);
  if (!parsed.ok) return rejected(parsed.detail);
  if (sameCanonical(current, canonical(parsed.value))) return appliedExisting(current, canonical(parsed.value));
  return writeObject(event, ctx, tx, current, ports, parsed.value, 'updateObject');
}

async function deleteObject(
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
  // A tombstone may carry no payload: the board is then wherever the object still is.
  const boardId = named?.ok ? named.value : await boardOfObject(db, ctx.auth.tenantId, id);
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
      eventType: 'object.deleted',
      eventPayload: { objectId: id },
      idempotencyKey: `sync:${event.eventId}`,
      content: (editDb, now) => objectDeleteStatements(editDb, session.tenantId, session.id, id, now),
    });
    if (result.status === 'applied') ctx.afterCommit(ports.scheduleSnapshot(session.tenantId, session.id));
    return editOutcome(result, { serverId: id, destinationKey: ctx.destinationKey, stored: tombstone, mapping: current });
  } catch (error) {
    return canvasWriteFailure(error, SOURCE, 'deleteObject');
  }
}

/** Apply one already-validated object mutation inside the push's unit of work. */
export async function importSyncedCanvasObject(
  event: SyncEventInput,
  ctx: SyncImportContext,
  stores: SyncStoreSet,
  tx: Tx,
  ports: CanvasSyncPorts,
): Promise<BoundedImportOutcome> {
  if (event.entityType !== 'canvas-object') return rejected('entity_type_rejected');
  const prelude = preludeRejection(event, ctx);
  if (prelude) return prelude;
  const mapping = await stores.findMapping(ctx.auth.tenantId, event.entityType, event.clientEntityId);
  if (event.operation === 'delete') return deleteObject(event, ctx, tx, mapping, ports);
  if (event.operation === 'update') return updateObject(event, ctx, tx, mapping, ports);
  if (event.operation === 'create' || event.operation === 'import') return createObject(event, ctx, tx, mapping, ports);
  return rejected('operation_unsupported');
}
