/**
 * Application — server pull query (G18, ticket #5852).
 *
 * In-memory delta page over rows the caller already loaded. Uses the opaque
 * cursor codec in `domain/sync/cursorCodec` (`admitCursor` /
 * `encodeSyncCursor`). It does not reimplement that codec, does not read
 * Postgres, and does not register `POST` or `GET /api/sync/v1/pull`.
 *
 * A cursor this codec did not produce is not sequence 0. Null, blank, a
 * decode failure, a non-delta cursor, or a delta seq older than
 * `retainedThroughSeq` is `{ resnapshotRequired: true }` and nothing else —
 * never a partial page, and never the rows after 0.
 */

import { RESNAPSHOT_REQUIRED, admitCursor, encodeSyncCursor } from '../../domain/sync/cursorCodec';

export interface PullDeltaRow<T = unknown> {
  seq: number;
  clientEntityId?: string;
  deletedAt?: string | null;
  body?: T;
  /** Local-record body, when the caller has not already renamed it to `body`. */
  payload?: T;
}

export interface QueryPullInput<T = unknown> {
  readonly cursor: string | null;
  readonly changes?: readonly PullDeltaRow<T>[] | null;
  /**
   * Lowest seq still in the retained log. A delta cursor older than this has
   * a gap: the swept rows cannot be reconstructed from what remains.
   */
  readonly retainedThroughSeq?: number | null;
}

export interface PullDeltaDelete<T = unknown> extends Omit<PullDeltaRow<T>, 'body' | 'payload'> {
  readonly op: 'delete';
  readonly deletedAt: string;
}

export type PullDeltaChange<T = unknown> = PullDeltaRow<T> | PullDeltaDelete<T>;

export interface PullDeltaPage<T = unknown> {
  readonly changes: readonly PullDeltaChange<T>[];
  readonly cursor: string;
}

export interface PullDeltaResnapshot {
  readonly resnapshotRequired: true;
}

export type QueryPullResult<T = unknown> = PullDeltaPage<T> | PullDeltaResnapshot;

const RESNAPSHOT: PullDeltaResnapshot = RESNAPSHOT_REQUIRED;

function isNonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function copyBody<T>(body: T): T {
  if (body === null || typeof body !== 'object') return body;
  if (Array.isArray(body)) return body.slice() as T;
  return { ...(body as object) } as T;
}

function isTombstone(row: PullDeltaRow): boolean {
  return isNonBlank(row.deletedAt);
}

/** A new row. A non-blank `deletedAt` is a delete and keeps no body. */
function copyChange<T>(row: PullDeltaRow<T>): PullDeltaChange<T> {
  if (isTombstone(row)) {
    const { body: _body, payload: _payload, ...rest } = row;
    return Object.freeze({
      ...rest,
      op: 'delete',
      deletedAt: row.deletedAt as string,
    });
  }
  const copy = { ...row } as PullDeltaRow<T>;
  if (copy.body !== undefined) copy.body = copyBody(copy.body);
  if (copy.payload !== undefined) copy.payload = copyBody(copy.payload);
  return Object.freeze(copy);
}

function inWindow(row: PullDeltaRow, afterSeq: number): boolean {
  return typeof row.seq === 'number' && Number.isSafeInteger(row.seq) && row.seq > afterSeq;
}

/**
 * Delta page for an already-loaded change list.
 *
 * - Null input, or a cursor `admitCursor` rejects (blank, undecodable,
 *   non-delta, expired, or a delta seq older than `retainedThroughSeq`):
 *   `RESNAPSHOT_REQUIRED` only.
 * - A usable delta cursor: every row with `seq` greater than `cursor.seq`,
 *   in sequence order, and a new cursor from `encodeSyncCursor`. Tombstones
 *   stay in the page as deletes. The input array is not mutated.
 */
export function queryPull<T>(input: QueryPullInput<T> | null | undefined): QueryPullResult<T> {
  if (!input) return RESNAPSHOT;
  const admitted = admitCursor(input.cursor, {
    requireDelta: true,
    retainedThroughSeq: input.retainedThroughSeq,
  });
  if (admitted.resnapshotRequired) return RESNAPSHOT;
  // Bound once: a narrowed `admitted.cursor` does not stay narrowed inside the callbacks.
  const cursor = admitted.cursor;
  if (cursor.kind !== 'delta') return RESNAPSHOT;

  const source = Array.isArray(input.changes) ? input.changes : [];
  const ordered = source.filter((row) => inWindow(row, cursor.seq)).sort((left, right) => left.seq - right.seq);
  const lastSeq = ordered.reduce((max, row) => (row.seq > max ? row.seq : max), cursor.seq);
  return Object.freeze({
    changes: Object.freeze(ordered.map((row) => copyChange<T>(row))),
    cursor: encodeSyncCursor({ v: 1, kind: 'delta', seq: lastSeq }),
  });
}
