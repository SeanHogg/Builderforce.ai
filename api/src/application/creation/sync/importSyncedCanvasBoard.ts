/**
 * Import one canvas BOARD (the `creation_sessions` row) from a device's journal.
 *
 * Writes the board and the owner's seat on it, through the canvas context's own
 * statements (`newCreationSessionStatements`, `applyBoardEdit`) — the same ones `POST
 * /claim` and `PATCH /:id` run — never raw SQL of its own. The push transaction calling
 * this owns the mapping, projection, change row and receipt.
 *
 * - create: the client's board uuid IS the server row id (never re-keyed). The workspace's
 *   plan cap (`creationSessionQuota`, the one `/claim` reads) refuses a board over the
 *   limit with its plan code, a HOLD — an upgrade lets the same event through. An id that
 *   is already the caller's own board is adopted, not duplicated; one that is not theirs
 *   is refused without saying whose it is.
 * - update (`title`, `mode`): editor or above. delete: owner only, a soft delete exactly
 *   like `DELETE /:id` (status `deleted`, recoverable).
 *
 * Accepted in the payload and NOT persisted here: `folder`, `initialPrompt`,
 * `branchParentId` (folders, the opening prompt and branch lineage have their own routes
 * and are not part of the journal contract) and `viewport` beyond the new board's initial
 * camera — a viewport is the device's own and is never merged.
 */

import type { Db, Tx } from '../../../infrastructure/database/connection';
import { isUniqueViolation } from '../../../infrastructure/database/uniqueViolation';
import { normalizeChatMode, type ChatMode } from '../../brain/chatMode';
import { creationSessionQuotaError } from '../../../domain/tenant/creationSessionQuota';
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
import { newCreationSessionStatements } from '../creationGraphWriter';
import { grantReadFor, resolveSessionAccess } from '../sessionAccess';
import { resolveBoardForSync } from './canvasSyncAccess';
import { canvasWriteFailure, editOutcome } from './canvasSyncOutcome';
import type { CanvasSyncPorts } from './canvasSyncPorts';
import { boundedText, canvasRowId, payloadRecord, type Parsed } from './canvasSyncPayload';

const SOURCE = 'importSyncedCanvasBoard.ts';

interface BoardFields {
  title: string;
  mode: ChatMode;
  viewport: { x: number; y: number; zoom: number };
}

const DEFAULT_VIEWPORT = { x: 0, y: 0, zoom: 1 };

function readViewport(raw: unknown): BoardFields['viewport'] {
  const v = payloadRecord(raw);
  const { x, y, zoom } = (v ?? {}) as Record<string, unknown>;
  return typeof x === 'number' && typeof y === 'number' && typeof zoom === 'number'
    && Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(zoom) && zoom > 0
    ? { x, y, zoom }
    : DEFAULT_VIEWPORT;
}

function readBoard(payload: unknown): Parsed<BoardFields> {
  const raw = payloadRecord(payload);
  if (!raw) return { ok: false, detail: 'payload_invalid' };
  const title = boundedText(raw.title, 255);
  if (!title) return { ok: false, detail: 'canvas_board_title_invalid' };
  const mode = raw.mode === undefined ? 'chat' : normalizeChatMode(raw.mode);
  if (!mode) return { ok: false, detail: 'payload_invalid' };
  return { ok: true, value: { title, mode, viewport: readViewport(raw.viewport) } };
}

/** What the mapping's hash is taken over: the fields this importer persists, nothing device-local. */
function canonical(fields: Pick<BoardFields, 'title' | 'mode'>): { title: string; mode: string } {
  return { title: fields.title, mode: fields.mode };
}

async function createBoard(
  event: SyncEventInput,
  ctx: SyncImportContext,
  tx: Tx,
  mapping: SyncEntityMappingRow | null,
  ports: CanvasSyncPorts,
): Promise<BoundedImportOutcome> {
  const id = canvasRowId(event.clientEntityId);
  if (!id) return rejected('canvas_board_id_invalid');
  const parsed = readBoard(event.payload);
  if (!parsed.ok) return rejected(parsed.detail);
  const fields = parsed.value;
  const stored = canonical(fields);
  if (mapping) {
    if (mapping.destinationKey !== ctx.destinationKey) return rejected('destination_mismatch');
    if (sameCanonical(mapping, stored)) return appliedExisting(mapping, stored);
    return conflict(mapping, 'entity_already_imported');
  }
  const db = tx as unknown as Db;
  const { tenantId, userId, segmentId } = ctx.auth;
  const adopted = await adoptOwnBoard(db, ctx, id);
  if (adopted) return appliedNew(id, 1, ctx.destinationKey, adopted);
  if (!segmentId) return rejected('canvas_segment_unavailable');
  const quota = await ports.sessionQuota(db, tenantId, userId);
  if (!quota.allowed) return rejected(creationSessionQuotaError(quota).code);
  try {
    await tx.transaction(async (savepoint) => {
      const writes = newCreationSessionStatements(savepoint as unknown as Db, {
        sessionId: id,
        tenantId,
        segmentId,
        title: fields.title,
        objects: [],
        authorUserId: userId,
        eventType: 'session.synced',
        eventPayload: { deviceId: ctx.deviceId },
        idempotencyKey: `sync:${event.eventId}`,
        viewport: fields.viewport,
        memberViewport: fields.viewport,
        columns: { mode: fields.mode },
      });
      for (const write of writes) await (write.statement as PromiseLike<unknown>);
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      // Lost a race to the same id: if it is the caller's own board, it is theirs; otherwise it is not.
      const raced = await adoptOwnBoard(db, ctx, id);
      return raced ? appliedNew(id, 1, ctx.destinationKey, raced) : rejected('canvas_board_id_conflict');
    }
    return canvasWriteFailure(error, SOURCE, 'createBoard');
  }
  return appliedNew(id, 1, ctx.destinationKey, stored);
}

/**
 * The caller's own board under this id (created through the HTTP routes before the device
 * synced it), as the canonical payload to adopt it with; null when there is none. A board
 * of another tenant, or one the caller is not on, is invisible here and stays a conflict.
 */
async function adoptOwnBoard(db: Db, ctx: SyncImportContext, id: string): Promise<{ title: string; mode: string } | null> {
  const access = await resolveSessionAccess(db, id, ctx.auth.tenantId, ctx.auth.userId, undefined, grantReadFor('editor'));
  return access ? canonical({ title: access.session.title, mode: access.session.mode as ChatMode }) : null;
}

async function updateBoard(
  event: SyncEventInput,
  ctx: SyncImportContext,
  tx: Tx,
  mapping: SyncEntityMappingRow | null,
): Promise<BoundedImportOutcome> {
  const gate = mutateGate(event, ctx, mapping);
  if (gate) return gate;
  const current = mapping as SyncEntityMappingRow;
  const id = canvasRowId(current.serverId);
  if (!id) return rejected('server_id_invalid');
  const parsed = readBoard(event.payload);
  if (!parsed.ok) return rejected(parsed.detail);
  const stored = canonical(parsed.value);
  if (sameCanonical(current, stored)) return appliedExisting(current, stored);
  const board = await resolveBoardForSync(tx, ctx, id, { minimum: 'editor' });
  if (board.kind === 'outcome') return board.outcome;
  try {
    const result = await applyBoardEdit(tx, {
      sessionId: id,
      tenantId: board.access.session.tenantId,
      authorUserId: ctx.auth.userId,
      eventType: 'session.updated',
      eventPayload: { fields: ['title', 'mode'] },
      idempotencyKey: `sync:${event.eventId}`,
      sessionSet: { title: parsed.value.title, mode: parsed.value.mode },
      content: () => [],
    });
    return editOutcome(result, { serverId: id, destinationKey: ctx.destinationKey, stored, mapping: current });
  } catch (error) {
    return canvasWriteFailure(error, SOURCE, 'updateBoard');
  }
}

async function deleteBoard(
  event: SyncEventInput,
  ctx: SyncImportContext,
  tx: Tx,
  mapping: SyncEntityMappingRow | null,
): Promise<BoundedImportOutcome> {
  const tombstone = { status: 'deleted' as const };
  const gate = mutateGate(event, ctx, mapping, tombstone);
  if (gate) return gate;
  const current = mapping as SyncEntityMappingRow;
  const id = canvasRowId(current.serverId);
  if (!id) return rejected('server_id_invalid');
  const board = await resolveBoardForSync(tx, ctx, id, { minimum: 'owner', allowDeleted: true });
  if (board.kind === 'outcome') return board.outcome;
  if (board.access.session.status === 'deleted') return appliedNew(current.serverId, current.serverVersion + 1, ctx.destinationKey, tombstone);
  const now = ctx.now;
  try {
    const result = await applyBoardEdit(tx, {
      sessionId: id,
      tenantId: board.access.session.tenantId,
      authorUserId: ctx.auth.userId,
      eventType: 'session.deleted',
      eventPayload: { retention: true },
      idempotencyKey: `sync:${event.eventId}`,
      sessionSet: { status: 'deleted', archivedAt: now },
      content: () => [],
    });
    return editOutcome(result, { serverId: id, destinationKey: ctx.destinationKey, stored: tombstone, mapping: current });
  } catch (error) {
    return canvasWriteFailure(error, SOURCE, 'deleteBoard');
  }
}

/** Apply one already-validated board mutation inside the push's unit of work. */
export async function importSyncedCanvasBoard(
  event: SyncEventInput,
  ctx: SyncImportContext,
  stores: SyncStoreSet,
  tx: Tx,
  ports: CanvasSyncPorts,
): Promise<BoundedImportOutcome> {
  if (event.entityType !== 'canvas-board') return rejected('entity_type_rejected');
  const prelude = preludeRejection(event, ctx);
  if (prelude) return prelude;
  const mapping = await stores.findMapping(ctx.auth.tenantId, event.entityType, event.clientEntityId);
  if (event.operation === 'delete') return deleteBoard(event, ctx, tx, mapping);
  if (event.operation === 'update') return updateBoard(event, ctx, tx, mapping);
  if (event.operation === 'create' || event.operation === 'import') return createBoard(event, ctx, tx, mapping, ports);
  return rejected('operation_unsupported');
}
