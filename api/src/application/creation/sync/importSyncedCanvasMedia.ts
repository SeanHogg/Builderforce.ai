/**
 * Import one canvas MEDIA manifest from a device's journal.
 *
 * The record is a manifest, never the bytes: `{ boardId, objectId, mimeType, bytes, sha256,
 * name, status, storageKey? }`. Bytes live in the device's blob store and, once uploaded,
 * in the private upload store (`storageKey`); there is no media table, so this writes no
 * domain row. The push transaction persists the mapping and the sync projection (which is
 * what other devices pull), exactly as for a history-only record — what this adds is the
 * canvas context's decision: the manifest is well-formed, and the caller may write the
 * board it names (editor or above, the gate every board write passes).
 *
 * A manifest that says `uploaded` must name its `storageKey`; one that does not is invalid.
 * Deleting a manifest must name its board, because a tombstone has no row to look the board
 * up from — an unauthorised tombstone would otherwise reach the projection other devices pull.
 */

import type { Tx } from '../../../infrastructure/database/connection';
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
import { resolveBoardForSync } from './canvasSyncAccess';
import { boundedText, canvasRowId, payloadRecord, readBoardId, type Parsed } from './canvasSyncPayload';

const INVALID = 'canvas_media_invalid';
/** The largest single file the product accepts (a video); the upload endpoint's own limit is the tighter one. */
const MAX_MEDIA_BYTES = 200 * 1024 * 1024;
const MEDIA_STATUSES = ['local', 'uploading', 'uploaded', 'failed'] as const;
type MediaStatus = (typeof MEDIA_STATUSES)[number];
const MIME_TYPE_RE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/i;

interface MediaManifest {
  boardId: string;
  objectId: string;
  mimeType: string;
  bytes: number;
  sha256: string;
  name: string;
  status: MediaStatus;
  storageKey: string | null;
}

function isStatus(value: unknown): value is MediaStatus {
  return typeof value === 'string' && (MEDIA_STATUSES as readonly string[]).includes(value);
}

function readManifest(payload: unknown): Parsed<MediaManifest> {
  const raw = payloadRecord(payload);
  if (!raw) return { ok: false, detail: 'payload_invalid' };
  const board = readBoardId(raw, INVALID);
  const objectId = canvasRowId(raw.objectId);
  const mimeType = typeof raw.mimeType === 'string' && MIME_TYPE_RE.test(raw.mimeType) ? raw.mimeType.toLowerCase() : null;
  const name = boundedText(raw.name, 255);
  if (!board.ok || !objectId || !mimeType || !name) return { ok: false, detail: INVALID };
  if (typeof raw.bytes !== 'number' || !Number.isSafeInteger(raw.bytes) || raw.bytes < 0 || raw.bytes > MAX_MEDIA_BYTES) {
    return { ok: false, detail: INVALID };
  }
  if (typeof raw.sha256 !== 'string' || !SHA256_RE.test(raw.sha256)) return { ok: false, detail: INVALID };
  if (!isStatus(raw.status)) return { ok: false, detail: INVALID };
  const storageKey = raw.storageKey === undefined || raw.storageKey === null ? null : boundedText(raw.storageKey, 512);
  if (raw.storageKey !== undefined && raw.storageKey !== null && (!storageKey || storageKey.includes('..'))) {
    return { ok: false, detail: INVALID };
  }
  if (raw.status === 'uploaded' && !storageKey) return { ok: false, detail: INVALID };
  return {
    ok: true,
    value: {
      boardId: board.value,
      objectId,
      mimeType,
      bytes: raw.bytes,
      sha256: raw.sha256.toLowerCase(),
      name,
      status: raw.status,
      storageKey,
    },
  };
}

async function createMedia(
  event: SyncEventInput,
  ctx: SyncImportContext,
  tx: Tx,
  mapping: SyncEntityMappingRow | null,
): Promise<BoundedImportOutcome> {
  const id = canvasRowId(event.clientEntityId);
  if (!id) return rejected(INVALID);
  const parsed = readManifest(event.payload);
  if (!parsed.ok) return rejected(parsed.detail);
  if (mapping) {
    if (mapping.destinationKey !== ctx.destinationKey) return rejected('destination_mismatch');
    if (sameCanonical(mapping, parsed.value)) return appliedExisting(mapping, parsed.value);
    return conflict(mapping, 'entity_already_imported');
  }
  const board = await resolveBoardForSync(tx, ctx, parsed.value.boardId, { minimum: 'editor' });
  if (board.kind === 'outcome') return board.outcome;
  return appliedNew(id, 1, ctx.destinationKey, parsed.value);
}

async function updateMedia(
  event: SyncEventInput,
  ctx: SyncImportContext,
  tx: Tx,
  mapping: SyncEntityMappingRow | null,
): Promise<BoundedImportOutcome> {
  const gate = mutateGate(event, ctx, mapping);
  if (gate) return gate;
  const current = mapping as SyncEntityMappingRow;
  const parsed = readManifest(event.payload);
  if (!parsed.ok) return rejected(parsed.detail);
  const board = await resolveBoardForSync(tx, ctx, parsed.value.boardId, { minimum: 'editor' });
  if (board.kind === 'outcome') return board.outcome;
  if (sameCanonical(current, parsed.value)) return appliedExisting(current, parsed.value);
  return appliedNew(current.serverId, current.serverVersion + 1, ctx.destinationKey, parsed.value);
}

async function deleteMedia(
  event: SyncEventInput,
  ctx: SyncImportContext,
  tx: Tx,
  mapping: SyncEntityMappingRow | null,
): Promise<BoundedImportOutcome> {
  const tombstone = null;
  const gate = mutateGate(event, ctx, mapping, tombstone);
  if (gate) return gate;
  const current = mapping as SyncEntityMappingRow;
  const raw = payloadRecord(event.payload);
  const named = raw ? readBoardId(raw, INVALID) : null;
  if (!named?.ok) return rejected(INVALID);
  const board = await resolveBoardForSync(tx, ctx, named.value, { minimum: 'editor', allowDeleted: true });
  if (board.kind === 'outcome') return board.outcome;
  return appliedNew(current.serverId, current.serverVersion + 1, ctx.destinationKey, tombstone);
}

/** Accept one already-validated media manifest mutation inside the push's unit of work. */
export async function importSyncedCanvasMedia(
  event: SyncEventInput,
  ctx: SyncImportContext,
  stores: SyncStoreSet,
  tx: Tx,
): Promise<BoundedImportOutcome> {
  if (event.entityType !== 'canvas-media') return rejected('entity_type_rejected');
  const prelude = preludeRejection(event, ctx);
  if (prelude) return prelude;
  const mapping = await stores.findMapping(ctx.auth.tenantId, event.entityType, event.clientEntityId);
  if (event.operation === 'delete') return deleteMedia(event, ctx, tx, mapping);
  if (event.operation === 'update') return updateMedia(event, ctx, tx, mapping);
  if (event.operation === 'create' || event.operation === 'import') return createMedia(event, ctx, tx, mapping);
  return rejected('operation_unsupported');
}
