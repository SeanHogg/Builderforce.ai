/**
 * Application — pull cursor read (G18, ticket #5852).
 *
 * Pure. The route loads `sync_changes` / `sync_records` and passes the rows
 * here. This function does not open a database, does not build a query, and
 * does not fetch. `handleSyncPull` in `mountSyncBatch.ts` does not call it, so
 * wiring this file does not close the pull route.
 *
 * The cursor is admitted with `admitCursor` and re-encoded with
 * `encodeSyncCursor` from `domain/sync/cursorCodec.ts`. That codec rejects a
 * future `v`, a non-integer or negative `seq`, a blank token, and an expired
 * delta window as `RESNAPSHOT_REQUIRED`. This file does not reimplement the
 * codec. Entity types stay local so this file does not import
 * `@builderforce/local-first`.
 *
 * A null, blank, undecodable, or expired cursor is `{ resnapshotRequired: true }`
 * and nothing else — never sequence 0, and never a partial page of the rows
 * the caller passed. A delta cursor older than `retainedThroughSeq` is expired:
 * the swept rows cannot be reconstructed from what remains.
 *
 * A tombstone is a `sync_records.deleted_at`, a `sync_changes.operation` of
 * `delete`, or a nested record `deletedAt`. It becomes a local delete
 * instruction (`op: 'delete'`) with no payload. Dropping the row would hide
 * the deletion; merging it as an upsert would resurrect the entity.
 */

import {
  RESNAPSHOT_REQUIRED,
  admitCursor,
  encodeSyncCursor,
  type SyncCursor,
} from '../../domain/sync/cursorCodec';

/** Entity type name. Local, so this pull does not import `@builderforce/local-first`. */
export type LocalEntityType = string;

export interface LocalRecordProvenance {
  actorId?: string;
  deviceId?: string;
  source?: 'local' | 'imported';
  evidence?: 'client-reported' | 'server-observed';
  policyVersion?: string;
  auditVersion?: string;
  modelVersion?: string;
  sequence?: number;
}

export interface LocalRecord<T = unknown> {
  id: string;
  entityType: LocalEntityType;
  schemaVersion: number;
  version: number;
  baseVersion?: number;
  destination: { kind: 'unbound' | 'bound' };
  occurredAt: string;
  updatedAt: string;
  deletedAt?: string;
  payload: T;
  provenance?: LocalRecordProvenance;
}

/** One `sync_records` row, or the record half of a `sync_changes` row. */
export interface PullCursorRecordRow<T = unknown> {
  readonly entityType?: LocalEntityType | string;
  readonly clientEntityId?: string;
  readonly version?: number;
  readonly schemaVersion?: number;
  readonly occurredAt?: string | Date | null;
  readonly updatedAt?: string | Date | null;
  /** Tombstone column. A non-blank value is a delete, not an upsert. */
  readonly deletedAt?: string | Date | null;
  readonly payload?: T;
  readonly provenance?: LocalRecord<T>['provenance'] | null;
  /** Already-assembled client record, when the caller has one. */
  readonly record?: LocalRecord<T> | null;
}

/** One `sync_changes` row. `seq` is the delta cursor's sequence. */
export interface PullCursorChangeRow<T = unknown> extends PullCursorRecordRow<T> {
  readonly seq: number;
  /** `delete` is a tombstone even when `deletedAt` was not copied onto the row. */
  readonly operation?: string | null;
}

/**
 * What the client must do with one row. A delete never carries `payload`,
 * `body`, or `record` — those would be a merge, not a deletion.
 */
export interface LocalDeleteInstruction {
  readonly op: 'delete';
  readonly clientEntityId: string;
  readonly entityType?: LocalEntityType;
  readonly deletedAt?: string;
  readonly seq?: number;
}

export interface LocalUpsertInstruction<T = unknown> {
  readonly op: 'upsert';
  readonly clientEntityId: string;
  readonly entityType: LocalEntityType;
  readonly record: LocalRecord<T>;
  readonly seq?: number;
}

export type LocalSyncInstruction<T = unknown> = LocalDeleteInstruction | LocalUpsertInstruction<T>;

export interface PullCursorReadInput<T = unknown> {
  readonly cursor: string | null | undefined;
  /** Delta-log rows. Read only for a delta cursor. */
  readonly changes?: readonly PullCursorChangeRow<T>[] | null;
  /** Projection rows. Read only for a snapshot cursor. */
  readonly records?: readonly PullCursorRecordRow<T>[] | null;
  /**
   * Lowest `sync_changes.seq` still retained. A delta cursor with
   * `seq < retainedThroughSeq` has a gap. `null` / omitted means nothing has
   * been swept. A non-finite bound cannot prove the window, so it is expired.
   */
  readonly retainedThroughSeq?: number | null;
  /** The route already knows the window is gone. */
  readonly expired?: boolean;
}

/** A page the client may apply. No `resnapshotRequired` — that key means stop. */
export interface PullCursorReadPage<T = unknown> {
  readonly cursor: string;
  readonly instructions: readonly LocalSyncInstruction<T>[];
  /** Ids whose instruction in this page is a delete, in instruction order. */
  readonly deleted: readonly string[];
}

export interface PullCursorResnapshot {
  readonly resnapshotRequired: true;
}

export type PullCursorReadResult<T = unknown> = PullCursorReadPage<T> | PullCursorResnapshot;

const RESNAPSHOT: PullCursorResnapshot = RESNAPSHOT_REQUIRED;

function isNonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isUsableSeq(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function toIso(value: string | Date | null | undefined): string | undefined {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  }
  return isNonBlank(value) ? value : undefined;
}

function rowId(row: PullCursorRecordRow): string | null {
  if (isNonBlank(row.clientEntityId)) return row.clientEntityId.trim();
  if (row.record && isNonBlank(row.record.id)) return row.record.id.trim();
  return null;
}

function rowEntityType(row: PullCursorRecordRow): LocalEntityType | undefined {
  if (isNonBlank(row.entityType)) return row.entityType as LocalEntityType;
  if (row.record && isNonBlank(row.record.entityType)) return row.record.entityType;
  return undefined;
}

function deletedAtOf(row: PullCursorRecordRow): string | undefined {
  return toIso(row.deletedAt) ?? toIso(row.record?.deletedAt ?? null);
}

/** Log operation `delete`, or a non-blank tombstone timestamp. Blank is live. */
function isTombstone(row: PullCursorRecordRow): boolean {
  if (row.operation === 'delete') return true;
  return deletedAtOf(row) !== undefined;
}

function copyBody<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice() as T;
  return { ...(value as object) } as T;
}

function copyProvenance<T>(
  provenance: LocalRecord<T>['provenance'] | null | undefined,
): LocalRecord<T>['provenance'] | undefined {
  if (!provenance || typeof provenance !== 'object') return undefined;
  return { ...provenance };
}

function materialize<T>(row: PullCursorRecordRow<T>, id: string, entityType: LocalEntityType): LocalRecord<T> {
  if (row.record) {
    const provenance = copyProvenance(row.record.provenance);
    return {
      ...row.record,
      id: row.record.id,
      entityType: row.record.entityType,
      destination: { ...row.record.destination },
      payload: copyBody(row.record.payload),
      ...(provenance ? { provenance } : {}),
    };
  }
  const stamp = toIso(row.updatedAt) ?? toIso(row.occurredAt) ?? '1970-01-01T00:00:00.000Z';
  const provenance = copyProvenance(row.provenance);
  return {
    id,
    entityType,
    schemaVersion: typeof row.schemaVersion === 'number' && Number.isFinite(row.schemaVersion) ? row.schemaVersion : 1,
    version: typeof row.version === 'number' && Number.isFinite(row.version) ? row.version : 1,
    destination: { kind: 'unbound' },
    occurredAt: toIso(row.occurredAt) ?? stamp,
    updatedAt: stamp,
    payload: copyBody(row.payload as T),
    ...(provenance ? { provenance } : {}),
  };
}

function toInstruction<T>(row: PullCursorRecordRow<T>, seq: number | undefined): LocalSyncInstruction<T> | null {
  const id = rowId(row);
  if (id === null) return null;
  const entityType = rowEntityType(row);
  const seqField = seq === undefined ? {} : { seq };
  if (isTombstone(row)) {
    const deletedAt = deletedAtOf(row);
    return Object.freeze({
      op: 'delete',
      clientEntityId: id,
      ...(entityType ? { entityType } : {}),
      ...(deletedAt ? { deletedAt } : {}),
      ...seqField,
    });
  }
  if (!entityType) return null;
  return Object.freeze({
    op: 'upsert',
    clientEntityId: id,
    entityType,
    record: materialize(row, id, entityType),
    ...seqField,
  });
}

function page<T>(cursor: SyncCursor, instructions: readonly LocalSyncInstruction<T>[]): PullCursorReadPage<T> {
  return Object.freeze({
    cursor: encodeSyncCursor(cursor),
    instructions: Object.freeze(instructions),
    deleted: Object.freeze(
      instructions.filter((instruction) => instruction.op === 'delete').map((instruction) => instruction.clientEntityId),
    ),
  });
}

function readDelta<T>(seq: number, input: PullCursorReadInput<T>): PullCursorReadResult<T> {
  const source = Array.isArray(input.changes) ? input.changes : [];
  const ordered = source
    .filter((row) => isUsableSeq(row.seq) && row.seq > seq)
    .slice()
    .sort((left, right) => left.seq - right.seq);
  const instructions: LocalSyncInstruction<T>[] = [];
  let tip = seq;
  for (const row of ordered) {
    if (row.seq > tip) tip = row.seq;
    const instruction = toInstruction(row, row.seq);
    if (instruction) instructions.push(instruction);
  }
  return page({ v: 1, kind: 'delta', seq: tip }, instructions);
}

function afterKeyset(row: PullCursorRecordRow, afterType: string, afterId: string): boolean {
  const entityType = rowEntityType(row) ?? '';
  const id = rowId(row) ?? '';
  if (entityType > afterType) return true;
  if (entityType < afterType) return false;
  return id > afterId;
}

function readSnapshot<T>(
  afterEntityType: string,
  afterClientEntityId: string,
  input: PullCursorReadInput<T>,
): PullCursorReadResult<T> {
  const source = Array.isArray(input.records) ? input.records : [];
  const ordered = source
    .filter((row) => afterKeyset(row, afterEntityType, afterClientEntityId))
    .slice()
    .sort((left, right) => {
      const typeOrder = (rowEntityType(left) ?? '').localeCompare(rowEntityType(right) ?? '');
      if (typeOrder !== 0) return typeOrder;
      return (rowId(left) ?? '').localeCompare(rowId(right) ?? '');
    });
  const instructions: LocalSyncInstruction<T>[] = [];
  let anchorType = afterEntityType;
  let anchorId = afterClientEntityId;
  for (const row of ordered) {
    const instruction = toInstruction(row, undefined);
    if (!instruction) continue;
    instructions.push(instruction);
    const entityType = rowEntityType(row);
    const id = rowId(row);
    if (entityType && id) {
      anchorType = entityType;
      anchorId = id;
    }
  }
  return page({ v: 1, kind: 'snapshot', afterEntityType: anchorType, afterClientEntityId: anchorId }, instructions);
}

/**
 * Decide a pull page from rows the caller already loaded.
 *
 * - Missing input, or a cursor `admitCursor` rejects (blank, `expired`,
 *   undecodable, or a delta seq older than the retained window):
 *   `{ resnapshotRequired: true }` only. The supplied rows are not returned.
 * - A delta cursor inside the retained window: `changes` with `seq` strictly
 *   greater than the cursor, in sequence order. `records` are not read, so a
 *   snapshot table cannot leak into a delta page.
 * - A snapshot cursor: `records` strictly after the keyset. `changes` are not
 *   read.
 * - A tombstone in the page is `{ op: 'delete', clientEntityId }` and has no
 *   payload. The input arrays are not mutated.
 */
export function readPullCursor<T>(input: PullCursorReadInput<T> | null | undefined): PullCursorReadResult<T> {
  if (!input) return RESNAPSHOT;
  const admitted = admitCursor(input.cursor, {
    expired: input.expired,
    retainedThroughSeq: input.retainedThroughSeq,
  });
  if (admitted.resnapshotRequired) return RESNAPSHOT;
  if (admitted.cursor.kind === 'snapshot') {
    return readSnapshot(admitted.cursor.afterEntityType, admitted.cursor.afterClientEntityId, input);
  }
  return readDelta(admitted.cursor.seq, input);
}
