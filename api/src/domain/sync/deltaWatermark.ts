/**
 * Domain — the commit-ordered delta watermark (G18, migration 1304).
 *
 * `sync_changes.seq` is taken when a row is INSERTED, but the row is only
 * visible once its transaction COMMITS, and the two orders differ: transaction
 * A takes seq 10 and stays open, B takes 11 and commits, a pull delivers 11 and
 * moves its cursor to 11, A commits 10 — and 10 is never delivered. So the
 * cursor is the tuple `(txid, seq)` and a pull only reads rows whose `txid` is
 * BELOW the database's snapshot `xmin` (`pg_snapshot_xmin`). Every transaction
 * below `xmin` has finished and every later one gets an xid at or above it, so
 * no row can still appear underneath a cursor that stopped at `xmin`.
 *
 * LIVENESS: `xmin` is database-wide, so ANY long-lived transaction anywhere (a report, a
 * migration, an idle-in-transaction session) holds it back and delays delivery of every row
 * above it until that transaction ends. Rows are withheld, never lost; the pull reports an
 * xmin that lags the next xid by more than 10,000 (`syncPull:xminHeldBack`).
 *
 * `txid` is a Postgres `xid8` (64-bit): it exceeds 2^53, so it is a DECIMAL
 * STRING everywhere and is compared as a BigInt, never as a JS number.
 *
 * Pure: no database, no clock.
 */

export interface SyncWatermark {
  /** `xid8` of the writing transaction, as a decimal string. */
  txid: string;
  /** `sync_changes.seq`: orders rows inside one transaction. */
  seq: number;
}

/** The position before every row ever written (legacy rows carry txid 0). */
export const WATERMARK_ORIGIN: SyncWatermark = Object.freeze({ txid: '0', seq: 0 });

const XID_MAX = (1n << 64n) - 1n;

/** True for a canonical decimal `xid8`: digits only, no sign, no leading zeros, within 64 bits. */
export function isXid8(value: unknown): value is string {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,19})$/.test(value)) return false;
  return BigInt(value) <= XID_MAX;
}

/** Tuple order of two watermarks: negative, zero or positive like `Array.sort`. */
export function compareWatermark(a: SyncWatermark, b: SyncWatermark): number {
  const x = BigInt(a.txid);
  const y = BigInt(b.txid);
  if (x !== y) return x < y ? -1 : 1;
  return a.seq === b.seq ? 0 : a.seq < b.seq ? -1 : 1;
}

export function maxWatermark(...marks: SyncWatermark[]): SyncWatermark {
  return marks.reduce((best, next) => (compareWatermark(next, best) > 0 ? next : best));
}

export interface NextDeltaCursorInput {
  /** The page just read: ordered by `(txid, seq)`, every `txid` below `xmin`. */
  rows: ReadonlyArray<SyncWatermark>;
  limit: number;
  /** The cursor the page was read after. */
  prior: SyncWatermark;
  /** `pg_snapshot_xmin` of the SAME statement that read `rows`. */
  xmin: string;
}

/**
 * Where the next pull resumes.
 *
 * - A FULL page resumes at its last row: more rows may follow.
 * - A DRAINED page has read everything committed below `xmin`, so it resumes at
 *   `(xmin, 0)` — an idle destination moves with the database instead of
 *   sitting still while the log advances. It NEVER jumps to a per-tenant tip:
 *   a row above `xmin` may belong to a transaction that is still open, and a
 *   lower row from that transaction could still commit.
 * The cursor never moves backwards.
 */
export function nextDeltaCursor({ rows, limit, prior, xmin }: NextDeltaCursorInput): SyncWatermark {
  const last = rows[rows.length - 1];
  if (last && rows.length >= limit) return maxWatermark(prior, { txid: last.txid, seq: last.seq });
  const drained = { txid: xmin, seq: 0 };
  return last
    ? maxWatermark(prior, { txid: last.txid, seq: last.seq }, drained)
    : maxWatermark(prior, drained);
}
