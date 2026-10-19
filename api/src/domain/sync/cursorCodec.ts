/**
 * Domain — pull cursor codecs and delete tombstones (G18, ticket #5852).
 *
 * Two opaque cursors live here, and neither is sequence 0 when it is bad:
 *
 * - `encodeCursor` / `decodeCursor` is the `bfc1.` sequence token.
 * - `encodeSyncCursor` / `decodeSyncCursor` is the base64url JSON delta or
 *   snapshot cursor a pull read uses. A future `v`, a non-integer or negative
 *   `seq`, a `bfc1.` token, or any other string this codec did not produce is
 *   `null` — not the start of the log.
 *
 * `RESNAPSHOT_REQUIRED` is the only answer for a bad or expired cursor.
 * `admitCursor` returns that flag and nothing else: never a partial page, and
 * never sequence 0. A delta seq older than `retainedThroughSeq`, a non-finite
 * retention bound, or `expired: true` is that flag. A missing retention bound
 * is not expired. A cursor equal to the bound is still inside the window.
 *
 * A delete is a row with `deletedAt` and no `body`. Applying that twice keeps
 * the first `deletedAt`. A pull still returns the row: dropping it would hide
 * the deletion from every other device.
 *
 * Pure: no database, no HTTP, no import outside this file.
 */

const CURSOR_PREFIX = 'bfc1.';

function fingerprint(body: string): string {
  let hash = 2166136261;
  for (let index = 0; index < body.length; index += 1) {
    hash ^= body.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function existingDeletedAt(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/**
 * Opaque cursor for sequence `n`. Only a non-negative safe integer is a
 * sequence. `0` is a real cursor (nothing applied yet) and is not the string
 * `"0"`.
 */
export function encodeCursor(n: number): string {
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0) {
    throw new Error('cursor_not_a_sequence');
  }
  const body = n.toString(10);
  return `${CURSOR_PREFIX}${body}.${fingerprint(body)}`;
}

/**
 * Sequence from a cursor `encodeCursor` produced, or `null`.
 *
 * Never returns `0` for a bad cursor, and never throws. A missing cursor, a
 * bare `"0"`, a truncated token, a flipped checksum, a non-string, or another
 * codec's cursor are all `null` — not the start of the log.
 */
export function decodeCursor(s: unknown): number | null {
  try {
    if (typeof s !== 'string' || s.length === 0) return null;
    if (!s.startsWith(CURSOR_PREFIX)) return null;
    const rest = s.slice(CURSOR_PREFIX.length);
    const dot = rest.lastIndexOf('.');
    if (dot <= 0 || dot === rest.length - 1) return null;
    const body = rest.slice(0, dot);
    const check = rest.slice(dot + 1);
    if (!/^[0-9]+$/.test(body)) return null;
    if (body.length > 1 && body.startsWith('0')) return null;
    if (fingerprint(body) !== check) return null;
    const n = Number(body);
    if (!Number.isSafeInteger(n) || n < 0) return null;
    if (encodeCursor(n) !== s) return null;
    return n;
  } catch {
    return null;
  }
}

/**
 * Mark `record` deleted at `deletedAt` and drop `body`.
 *
 * A second apply keeps the first non-blank `deletedAt` and still has no body.
 * The input is not mutated. A blank `deletedAt` on a live row is refused so a
 * pull cannot treat an empty timestamp as "not deleted" and drop the row.
 */
export function applyTombstone<T extends { deletedAt?: string | null; body?: unknown }>(
  record: T,
  deletedAt: string,
): Omit<T, 'body'> & { deletedAt: string } {
  const kept = existingDeletedAt(record.deletedAt);
  if (kept === null && existingDeletedAt(deletedAt) === null) {
    throw new Error('tombstone_deleted_at_required');
  }
  const { body: _body, ...rest } = record;
  return {
    ...rest,
    deletedAt: kept ?? deletedAt,
  };
}

export interface PullPage<T> {
  changes: T[];
  /** Cursor covering the last returned seq, or the input cursor when the page is empty. */
  cursor: string;
}

/**
 * Changes strictly after `cursor`, in sequence order.
 *
 * Tombstoned rows are included — a delete must sync, and a later write must
 * not be reached by skipping one. A cursor this codec did not produce returns
 * `null` (resnapshot): never the rows after 0, and never an empty page that
 * looks like "caught up".
 */
export function pullChanges<T extends { seq: number }>(
  changes: readonly T[],
  cursor: string,
): PullPage<T> | null {
  const seq = decodeCursor(cursor);
  if (seq === null) return null;
  const page = changes
    .filter((change) => Number.isSafeInteger(change.seq) && change.seq > seq)
    .slice()
    .sort((left, right) => left.seq - right.seq);
  const last = page.length === 0 ? undefined : page[page.length - 1];
  return {
    changes: page,
    cursor: last === undefined ? cursor : encodeCursor(last.seq),
  };
}

// ── Opaque pull cursors (delta log vs snapshot keyset) ──────────────────────
//
// Base64url JSON so a client treats the token as opaque, while a pull can
// still reject a garbled one. A delta cursor names the last `sync_changes.seq`
// the device saw. A snapshot cursor keysets `sync_records`. This is not the
// `bfc1.` sequence token above: that token does not decode here.

export interface DeltaCursor {
  v: 1;
  kind: 'delta';
  seq: number;
}

export interface SnapshotCursor {
  v: 1;
  kind: 'snapshot';
  /** Keyset: the last `(entityType, clientEntityId)` pair served. */
  afterEntityType: string;
  afterClientEntityId: string;
}

export type SyncCursor = DeltaCursor | SnapshotCursor;

/**
 * A bad or expired cursor. One key, frozen, so a caller cannot ignore the flag
 * and merge a `changes` array that is not there, and cannot rewrite it into a
 * partial page.
 */
export const RESNAPSHOT_REQUIRED = Object.freeze({ resnapshotRequired: true as const });

export type CursorResnapshot = typeof RESNAPSHOT_REQUIRED;

const b64urlEncode = (text: string): string =>
  btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const b64urlDecode = (text: string): string => {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  return atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
};

/** Opaque cursor. Only a pull that decoded one of these may re-encode one. */
export function encodeSyncCursor(cursor: SyncCursor): string {
  return b64urlEncode(JSON.stringify(cursor));
}

/**
 * Cursor from `encodeSyncCursor`, or `null`.
 *
 * Never returns sequence 0 for a bad cursor, and never throws. A missing
 * cursor, a bare `"0"`, a future `v`, a non-integer or negative `seq`, a
 * `bfc1.` token, or another codec's cursor are all `null`.
 */
export function decodeSyncCursor(raw: string): SyncCursor | null {
  try {
    if (typeof raw !== 'string' || raw.length === 0) return null;
    const value: unknown = JSON.parse(b64urlDecode(raw));
    if (typeof value !== 'object' || value === null) return null;
    const cursor = value as Record<string, unknown>;
    if (cursor.v !== 1) return null;
    if (cursor.kind === 'delta' && typeof cursor.seq === 'number' && Number.isInteger(cursor.seq) && cursor.seq >= 0) {
      return { v: 1, kind: 'delta', seq: cursor.seq };
    }
    if (
      cursor.kind === 'snapshot'
      && typeof cursor.afterEntityType === 'string'
      && typeof cursor.afterClientEntityId === 'string'
    ) {
      return {
        v: 1,
        kind: 'snapshot',
        afterEntityType: cursor.afterEntityType,
        afterClientEntityId: cursor.afterClientEntityId,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * True when this delta seq is older than the retained window.
 *
 * A missing bound means nothing has been swept. A non-finite bound cannot
 * prove the window, so it is a gap rather than sequence 0. A seq equal to the
 * bound is still retained.
 */
export function deltaWindowExpired(seq: number, retainedThroughSeq: number | null | undefined): boolean {
  if (retainedThroughSeq == null) return false;
  if (typeof retainedThroughSeq !== 'number' || !Number.isFinite(retainedThroughSeq)) return true;
  return seq < retainedThroughSeq;
}

export interface CursorAdmission {
  readonly retainedThroughSeq?: number | null;
  /** The caller already knows the window is gone. */
  readonly expired?: boolean;
  /** Delta pulls reject a snapshot cursor instead of reading it as a seq. */
  readonly requireDelta?: boolean;
}

export type AdmittedCursor =
  | CursorResnapshot
  | { readonly resnapshotRequired: false; readonly cursor: SyncCursor };

function isNonBlankCursor(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Admit a pull cursor, or return `RESNAPSHOT_REQUIRED` and nothing else.
 *
 * Null, blank, undecodable, a non-delta cursor when `requireDelta` is set, a
 * delta seq older than `retainedThroughSeq`, a non-finite retention bound, or
 * `expired: true` is the resnapshot flag. The flag has no rows and no seq, so
 * it cannot be applied as a partial merge or as sequence 0.
 */
export function admitCursor(raw: string | null | undefined, admission?: CursorAdmission): AdmittedCursor {
  if (admission?.expired === true || !isNonBlankCursor(raw)) return RESNAPSHOT_REQUIRED;
  const decoded = decodeSyncCursor(raw);
  if (decoded === null) return RESNAPSHOT_REQUIRED;
  if (admission?.requireDelta === true && decoded.kind !== 'delta') return RESNAPSHOT_REQUIRED;
  if (decoded.kind === 'delta' && deltaWindowExpired(decoded.seq, admission?.retainedThroughSeq)) {
    return RESNAPSHOT_REQUIRED;
  }
  return Object.freeze({ resnapshotRequired: false as const, cursor: decoded });
}
