/**
 * Import one canvas TRANSCRIPT message from a device's journal.
 *
 * Payload: `{ boardId, clientMessageId, role, body, metadata?, createdAt? }` — the
 * `timeline[]` entry of the board. The transcript is append-only: a message is created
 * once and never edited or deleted through sync (`canvas_timeline_immutable`). The row is
 * keyed by `(board, clientMessageId)`, so a replay, or a message the HTTP route already
 * wrote, is adopted rather than duplicated. Appending needs editor or above on the board
 * — the same bar as `POST /:id/timeline` — and goes through the same writer
 * (`appendTimelineMessage`) and metadata whitelist (`sanitizeTimelineMetadata`).
 *
 * A message is not a graph edit: it does not move the board's revision, and the realtime
 * room is not nudged (collaborators read the transcript by its cursor).
 */

import type { Db, Tx } from '../../../infrastructure/database/connection';
import {
  appliedExisting,
  appliedNew,
  clampedClientTime,
  conflict,
  preludeRejection,
  rejected,
  sameCanonical,
  type BoundedImportOutcome,
} from '../../sync/importers';
import type { SyncEventInput, SyncImportContext, SyncStoreSet } from '../../sync/syncPorts';
import { sanitizeTimelineMetadata, timelineRole } from '../timelineMetadata';
import { appendTimelineMessage } from '../timelineWriter';
import { resolveBoardForSync } from './canvasSyncAccess';
import { displayNameOf } from './canvasGraphReads';
import { canvasWriteFailure } from './canvasSyncOutcome';
import { boundedText, payloadRecord, readBoardId, type Parsed } from './canvasSyncPayload';

const SOURCE = 'importSyncedCanvasTimeline.ts';
const INVALID = 'canvas_timeline_invalid';
const MAX_BODY_CHARS = 50_000;

interface TimelineFields {
  boardId: string;
  clientMessageId: string;
  role: ReturnType<typeof timelineRole>;
  body: string;
  metadata: unknown;
  createdAt: unknown;
}

function readMessage(payload: unknown): Parsed<TimelineFields> {
  const raw = payloadRecord(payload);
  if (!raw) return { ok: false, detail: 'payload_invalid' };
  const board = readBoardId(raw, INVALID);
  if (!board.ok) return board;
  const clientMessageId = boundedText(raw.clientMessageId, 128);
  const body = typeof raw.body === 'string' ? raw.body.trim() : '';
  if (!clientMessageId || body === '' || body.length > MAX_BODY_CHARS) return { ok: false, detail: INVALID };
  return {
    ok: true,
    value: {
      boardId: board.value,
      clientMessageId,
      role: timelineRole(raw.role),
      body,
      metadata: raw.metadata,
      createdAt: raw.createdAt,
    },
  };
}

/** What the mapping's hash is taken over: what makes the message THIS message. */
function canonical(fields: TimelineFields) {
  return { boardId: fields.boardId, clientMessageId: fields.clientMessageId, role: fields.role, body: fields.body };
}

async function createMessage(
  event: SyncEventInput,
  ctx: SyncImportContext,
  stores: SyncStoreSet,
  tx: Tx,
): Promise<BoundedImportOutcome> {
  const parsed = readMessage(event.payload);
  if (!parsed.ok) return rejected(parsed.detail);
  const fields = parsed.value;
  const stored = canonical(fields);
  const mapping = await stores.findMapping(ctx.auth.tenantId, event.entityType, event.clientEntityId);
  if (mapping) {
    if (mapping.destinationKey !== ctx.destinationKey) return rejected('destination_mismatch');
    if (sameCanonical(mapping, stored)) return appliedExisting(mapping, stored);
    return conflict(mapping, 'entity_already_imported');
  }
  const board = await resolveBoardForSync(tx, ctx, fields.boardId, { minimum: 'editor' });
  if (board.kind === 'outcome') return board.outcome;
  const { session } = board.access;
  const db = tx as unknown as Db;
  try {
    const human = fields.role === 'user' ? await displayNameOf(db, ctx.auth.userId) : null;
    const written = await tx.transaction((savepoint) => appendTimelineMessage(savepoint as unknown as Db, {
      sessionId: session.id,
      tenantId: session.tenantId,
      clientMessageId: fields.clientMessageId,
      role: fields.role,
      body: fields.body,
      metadata: sanitizeTimelineMetadata(fields.metadata, fields.role, { userId: ctx.auth.userId, name: human }),
      createdBy: ctx.auth.userId,
      createdAt: clampedClientTime(fields.createdAt, ctx.now),
    }));
    if (!written.message) return rejected('canvas_write_failed');
    return appliedNew(String(written.message.id), 1, ctx.destinationKey, stored);
  } catch (error) {
    return canvasWriteFailure(error, SOURCE, 'createMessage');
  }
}

/** Apply one already-validated transcript message inside the push's unit of work. */
export async function importSyncedCanvasTimeline(
  event: SyncEventInput,
  ctx: SyncImportContext,
  stores: SyncStoreSet,
  tx: Tx,
): Promise<BoundedImportOutcome> {
  if (event.entityType !== 'canvas-timeline') return rejected('entity_type_rejected');
  const prelude = preludeRejection(event, ctx);
  if (prelude) return prelude;
  if (event.operation === 'update' || event.operation === 'delete') return rejected('canvas_timeline_immutable');
  if (event.operation === 'create' || event.operation === 'import') return createMessage(event, ctx, stores, tx);
  return rejected('operation_unsupported');
}
