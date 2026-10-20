/**
 * Delete tombstones and pull-cursor inclusion (G18).
 *
 * A delete is a record with `deletedAt`, not a missing row. Applying a remote
 * record must not resurrect a tombstone, and a cursor must return every event
 * after the last applied sequence — including delete operations — so a delete
 * cannot be skipped.
 *
 * `decideCursor` is the pull decision. A cursor that is not a non-negative
 * safe integer, or one the caller marks expired, is a resnapshot. It is not
 * sequence 0 and it is not a partial merge of the supplied changes. A usable
 * cursor applies only changes strictly after that cursor.
 */

import type { JournalEvent, LocalRecord } from './records.js';

function isTombstone(record: LocalRecord): boolean {
  return typeof record.deletedAt === 'string' && record.deletedAt.trim() !== '';
}

/** Mark `record` deleted at `at`, bump its version, and keep id and destination. */
export function tombstoneRecord<T>(record: LocalRecord<T>, at: string): LocalRecord<T> {
  if (typeof at !== 'string' || at.trim() === '') {
    throw new Error('tombstone_at_required');
  }
  if (!Number.isFinite(record.version)) {
    throw new Error('tombstone_version_required');
  }
  return {
    ...record,
    id: record.id,
    destination: record.destination,
    version: record.version + 1,
    baseVersion: record.version,
    deletedAt: at,
    updatedAt: at,
  };
}

/**
 * Merge one pulled record onto the local row.
 *
 * - Local tombstone and `remote.version <= local.version`: keep the tombstone.
 * - Remote tombstone and `remote.version > local.version`: the result is that tombstone.
 * - Local tombstone and a newer live remote: still keep the tombstone. A later
 *   pull must not resurrect a deleted entity.
 * - Neither deleted: the higher version wins; an equal version keeps local.
 * - A remote tombstone that is not strictly newer does not delete a live local row.
 * - No local row: keep the remote record, including when it is a tombstone, so
 *   the delete lands as a row rather than an absence.
 */
export function applyRemote<T>(
  local: LocalRecord<T> | undefined,
  remote: LocalRecord<T>,
): LocalRecord<T> {
  if (!local) return remote;
  if (local.id !== remote.id) throw new Error('tombstone_id_mismatch');

  const localDeleted = isTombstone(local);
  const remoteDeleted = isTombstone(remote);

  if (localDeleted && remote.version <= local.version) return local;
  if (remoteDeleted && remote.version > local.version) return remote;
  if (localDeleted) return local;
  if (!remoteDeleted) {
    return remote.version > local.version ? remote : local;
  }
  return local;
}

function afterCursor(localSequence: number, cursorSequence: number): boolean {
  if (!Number.isFinite(localSequence) || !Number.isFinite(cursorSequence)) return true;
  return localSequence > cursorSequence;
}

/** A sequence this contract can resume from. `0` is valid (nothing applied yet). */
function isUsableCursor(cursor: unknown): cursor is number {
  return typeof cursor === 'number' && Number.isSafeInteger(cursor) && cursor >= 0;
}

function strictlyAfter<E extends Pick<JournalEvent, 'localSequence'>>(
  events: readonly E[],
  cursor: number,
): E[] {
  return events
    .filter((event) => Number.isFinite(event.localSequence) && event.localSequence > cursor)
    .slice()
    .sort((left, right) => left.localSequence - right.localSequence);
}

/**
 * Events still owed after `cursorSequence`. Delete operations are included;
 * a cursor must not skip a tombstone to reach a later write.
 */
export function cursorIncludes<E extends Pick<JournalEvent, 'localSequence' | 'operation'>>(
  events: readonly E[],
  cursorSequence: number,
): E[] {
  return events
    .filter((event) => afterCursor(event.localSequence, cursorSequence))
    .slice()
    .sort((left, right) => {
      const leftSeq = Number.isFinite(left.localSequence) ? left.localSequence : Number.POSITIVE_INFINITY;
      const rightSeq = Number.isFinite(right.localSequence) ? right.localSequence : Number.POSITIVE_INFINITY;
      return leftSeq - rightSeq;
    });
}

export interface ApplyCursorDecision<E> {
  readonly action: 'apply';
  readonly cursor: number;
  /** Changes strictly after `cursor`, including delete operations. */
  readonly changes: readonly E[];
}

export interface ResnapshotCursorDecision {
  readonly action: 'resnapshot';
}

export type CursorDecision<E> = ApplyCursorDecision<E> | ResnapshotCursorDecision;

export interface CursorDecisionInput<E> {
  readonly cursor: number | null;
  readonly expired?: boolean;
  readonly changes?: readonly E[] | null;
}

const RESNAPSHOT: ResnapshotCursorDecision = Object.freeze({ action: 'resnapshot' });

/**
 * Decide whether a pull may merge.
 *
 * - Missing input, a null cursor, a cursor that is not a non-negative safe
 *   integer, or `expired === true`: `{ action: 'resnapshot' }` only. The
 *   supplied changes are not returned, and the decision is not sequence 0.
 * - Otherwise `{ action: 'apply', cursor, changes }` where `changes` are the
 *   events strictly after that cursor, deletes included. Events at the cursor
 *   were already applied and are not replayed.
 */
export function decideCursor<E extends Pick<JournalEvent, 'localSequence' | 'operation'>>(
  input: CursorDecisionInput<E> | null | undefined,
): CursorDecision<E> {
  if (!input || input.expired === true || !isUsableCursor(input.cursor)) return RESNAPSHOT;
  const source = Array.isArray(input.changes) ? input.changes : [];
  return Object.freeze({
    action: 'apply',
    cursor: input.cursor,
    changes: Object.freeze(strictlyAfter(source, input.cursor)),
  });
}
