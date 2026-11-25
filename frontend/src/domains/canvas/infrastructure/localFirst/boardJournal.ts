/**
 * THE BOARD JOURNAL PRIMITIVE — put a record and, when it is owed to the server, enqueue its event,
 * in the caller's ONE transaction.
 *
 * Every board write (an edit, a bind, a media upload, a conflict resolution) goes through
 * `writeRecord`, so the rules below exist once:
 *
 *   - A record is journaled ONLY when its destination is bound. An unbound (guest) record is a
 *     local write: nothing is sent for it, and the bind (`boardBind.ts`) enqueues it whole later.
 *   - The operation is decided by what the SERVER can be assumed to know, not by the local version:
 *     a mapping or a pending event for the row means `update` / `delete`, otherwise `create`. A
 *     delete of a row the server never saw sends nothing.
 *   - `baseVersion` of an update is the version the server will be at when the event applies (the
 *     mapping plus the row's events ahead of it), which is what the server's conflict rule compares —
 *     not the local version counter, which also counts writes that were never sent.
 *   - Deletes are tombstones (`deletedAt`), never row removal.
 *   - Every child event waits on its board's creating write (`boardCreateKey`).
 *   - A payload that refers to media whose bytes are not uploaded yet is written but NOT journaled:
 *     the server must never hold an object pointing at a blob it cannot serve. The upload queue
 *     journals it, rewritten, once the media is `uploaded`.
 */

import {
  newLocalRecord,
  scanPendingOfRow,
  type EntityDestination,
  type LocalEntityType,
  type LocalFirstTransaction,
  type LocalRecord,
} from '@builderforce/local-first';
import {
  CANVAS_MEDIA,
  CANVAS_RECORD_SCHEMA_VERSION,
  boardCreateKey,
  eventKey,
  mediaIdsIn,
  type MediaPayload,
} from './boardRecords';

export interface JournalContext {
  deviceId: string;
  now?: () => Date;
}

export interface RecordWrite<T> {
  entityType: LocalEntityType;
  id: string;
  payload: T;
  /** Snapshotted onto a NEW record; an existing record keeps its own. */
  destination: EntityDestination;
  /** The board a child record belongs to: its events wait on that board's creating write. */
  boardId?: string;
  /** What the event carries when it is not the whole payload (a board's synced fields). */
  syncPayload?: unknown;
  /** `false`: a local-only write (this device's viewport, a media upload attempt). */
  journal?: boolean;
  /** Further keys the event waits on (a media's uploaded event). */
  dependsOn?: readonly string[];
  /** Tombstone the record. */
  deleted?: boolean;
}

/** How many live events of this row are waiting to be sent. */
async function queuedEventsOf(tx: LocalFirstTransaction, record: LocalRecord): Promise<number> {
  let queued = 0;
  await scanPendingOfRow(tx, record.id, (event) => {
    if (!event.deadLetter && event.entityType === record.entityType) queued += 1;
  }, record.destination);
  return queued;
}

/** The media a payload names that is not uploaded yet — the reason its event must wait. */
export async function unuploadedMediaIn(tx: LocalFirstTransaction, payload: unknown): Promise<string[]> {
  const waiting: string[] = [];
  for (const mediaId of mediaIdsIn(payload)) {
    const media = await tx.get<MediaPayload>(CANVAS_MEDIA, mediaId);
    if (media && !media.deletedAt && media.payload.status !== 'uploaded') waiting.push(mediaId);
  }
  return waiting;
}

/** Enqueue the event of a record just written (see the module comment for the rules). */
export async function appendRecordEvent(
  tx: LocalFirstTransaction,
  record: LocalRecord,
  options: { boardId?: string; syncPayload?: unknown; dependsOn?: readonly string[]; deleted?: boolean; idempotencyKey?: string } = {},
): Promise<void> {
  const mapping = await tx.mapping(record.entityType, record.id, record.destination);
  const queued = await queuedEventsOf(tx, record);
  const known = mapping !== undefined || queued > 0;
  if (options.deleted && !known) return;
  const operation = options.deleted ? 'delete' : known ? 'update' : 'create';
  await tx.append({
    idempotencyKey: options.idempotencyKey ?? eventKey(record.entityType, record.id, record.version),
    clientEntityId: record.id,
    entityType: record.entityType,
    operation,
    schemaVersion: record.schemaVersion,
    occurredAt: record.updatedAt,
    // The version the server will be at when this event applies: what it is known to hold, plus the
    // events of this row ahead of this one (each accepted write is one version). Not the local
    // counter, which also counts writes that were never sent.
    ...(operation === 'create' ? {} : { baseVersion: (mapping?.serverVersion ?? 0) + queued }),
    dependsOn: [...(options.boardId ? [boardCreateKey(options.boardId)] : []), ...(options.dependsOn ?? [])],
    destination: record.destination,
    payload: options.syncPayload ?? record.payload,
  });
}

/**
 * Write `write` over `existing` (undefined: a new record) in `tx`, with its event when it is owed.
 * Returns the record as written. The put is a compare-and-set on `existing.version`.
 */
export async function writeRecord<T>(
  tx: LocalFirstTransaction,
  ctx: JournalContext,
  existing: LocalRecord<T> | undefined,
  write: RecordWrite<T>,
): Promise<LocalRecord<T>> {
  const stamp = (ctx.now?.() ?? new Date()).toISOString();
  let record: LocalRecord<T>;
  if (existing) {
    // A re-added id (an undo of a delete) is live again: the tombstone is not carried forward.
    const { deletedAt: _tombstone, ...live } = existing;
    record = {
      ...live,
      version: existing.version + 1,
      baseVersion: existing.version,
      updatedAt: stamp,
      payload: write.payload,
      ...(write.deleted ? { deletedAt: stamp } : {}),
    };
  } else {
    record = newLocalRecord<T>({
      id: write.id,
      entityType: write.entityType,
      payload: write.payload,
      deviceId: ctx.deviceId,
      destination: write.destination,
      occurredAt: stamp,
      schemaVersion: CANVAS_RECORD_SCHEMA_VERSION,
    });
  }
  await tx.put(record, existing?.version);
  if (write.journal === false || record.destination.kind !== 'bound') return record;
  if (!write.deleted && (await unuploadedMediaIn(tx, write.payload)).length > 0) return record;
  await appendRecordEvent(tx, record, {
    ...(write.boardId ? { boardId: write.boardId } : {}),
    ...(write.syncPayload !== undefined ? { syncPayload: write.syncPayload } : {}),
    ...(write.dependsOn ? { dependsOn: write.dependsOn } : {}),
    ...(write.deleted ? { deleted: true } : {}),
  });
  return record;
}
