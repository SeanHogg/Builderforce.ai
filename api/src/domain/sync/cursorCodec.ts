/**
 * Domain — THE pull cursor codec (G18). One codec; there is no second token.
 *
 * A cursor is base64url JSON so a client treats it as opaque while the server
 * can still reject a garbled one deterministically. Two shapes:
 *
 * Version 2 (commit-ordered watermark, migration 1304 — see `deltaWatermark.ts`):
 *
 * - DELTA `{ txid, seq, issuedAt }`: every `sync_changes` row of this
 *   destination with `(txid, seq) > (txid, seq)` is still unread. `txid` is the
 *   writing transaction's `xid8` as a DECIMAL STRING (it exceeds 2^53). A page
 *   that drains the destination advances it to `(xmin, 0)`, never to a tenant
 *   tip, so a late commit can never fall behind it.
 * - SNAPSHOT `{ afterEntityType, afterClientEntityId, tipTxid, issuedAt }`:
 *   keyset over `sync_records`. `tipTxid` is the database `xmin` captured on
 *   the FIRST snapshot page, so a change written while the snapshot pages is
 *   still delivered by the delta that follows (it has `txid >= tipTxid`).
 *
 * Version 1 (`seq` only) is still READ, never written. A v1 DELTA cursor decodes
 * as {@link LegacyDeltaCursor}: the pull translates seq S to `('0', S)` (never via
 * the txid of S's row, which would skip migration-window rows), and still applies
 * the expiry check, resnapshotting when the retained rows no longer reach back to S. A v1
 * SNAPSHOT cursor is `null` (resnapshot): its tenant-tip `tip` has no txid.
 *
 * `issuedAt` (epoch ms) is when the guarantee "nothing after the cursor was
 * swept" was last proven. `sync_changes` is swept by age, so a cursor younger
 * than the retention window cannot have lost a row. An older one is still good
 * while the destination retains a row at or before the cursor — sweeping
 * removes the oldest rows first, so a retained earlier row proves the later
 * ones survived. Otherwise it is {@link RESNAPSHOT_REQUIRED}, never a partial page.
 *
 * Pure: no database, no HTTP, no clock read (`now` is an argument).
 */

import { compareWatermark, isXid8, type SyncWatermark } from './deltaWatermark';

export interface DeltaCursor {
  v: 2;
  kind: 'delta';
  /** `xid8` of the last transaction fully read, decimal string. */
  txid: string;
  seq: number;
  issuedAt: number;
}

/** A v1 delta cursor (seq only). Decoded for translation, never minted. */
export interface LegacyDeltaCursor {
  v: 1;
  kind: 'delta';
  seq: number;
  issuedAt: number;
}

export interface SnapshotCursor {
  v: 2;
  kind: 'snapshot';
  /** Keyset: the last `(entityType, clientEntityId)` pair served. */
  afterEntityType: string;
  afterClientEntityId: string;
  /** Database `xmin` (decimal `xid8`) read before the first snapshot page. */
  tipTxid: string;
  issuedAt: number;
}

/** What a pull may mint. */
export type SyncCursor = DeltaCursor | SnapshotCursor;

/** What a pull may read. */
export type DecodedSyncCursor = SyncCursor | LegacyDeltaCursor;

/**
 * A bad or expired cursor. One key, frozen, so a caller cannot ignore the flag
 * and merge a `records` array that is not there.
 */
export const RESNAPSHOT_REQUIRED = Object.freeze({ resnapshotRequired: true as const });

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Margin subtracted from the retention window: the sweep runs on a schedule and
 * the two clocks (API, database) are not the same clock. A cursor inside the
 * last day of the window is checked against the retained rows instead.
 */
export const CURSOR_RETENTION_MARGIN_DAYS = 1;

const b64urlEncode = (text: string): string =>
  btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const b64urlDecode = (text: string): string => {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  return atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
};

const isSeq = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const isEpochMs = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

/** Opaque cursor. Only a pull may mint one. */
export function encodeSyncCursor(cursor: SyncCursor): string {
  return b64urlEncode(JSON.stringify(cursor));
}

/**
 * Cursor from {@link encodeSyncCursor}, or `null`. Never throws, and never
 * returns sequence 0 for a bad token: a blank string, a future `v`, a negative
 * or fractional `seq`, a missing `issuedAt` or `tip`, or any other string is
 * `null` — the caller answers {@link RESNAPSHOT_REQUIRED}.
 */
export function decodeSyncCursor(raw: unknown): DecodedSyncCursor | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  let value: unknown;
  try {
    value = JSON.parse(b64urlDecode(raw));
  } catch {
    // Not base64url JSON: not a cursor this codec minted. The caller resnapshots.
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const cursor = value as Record<string, unknown>;
  if (!isEpochMs(cursor.issuedAt)) return null;
  if (cursor.v === 1) {
    // Legacy: only a delta survives (translated by the pull); a v1 snapshot restarts.
    return cursor.kind === 'delta' && isSeq(cursor.seq)
      ? { v: 1, kind: 'delta', seq: cursor.seq, issuedAt: cursor.issuedAt }
      : null;
  }
  if (cursor.v !== 2) return null;
  if (cursor.kind === 'delta' && isSeq(cursor.seq) && isXid8(cursor.txid)) {
    return { v: 2, kind: 'delta', txid: cursor.txid, seq: cursor.seq, issuedAt: cursor.issuedAt };
  }
  if (
    cursor.kind === 'snapshot'
    && typeof cursor.afterEntityType === 'string'
    && typeof cursor.afterClientEntityId === 'string'
    && isXid8(cursor.tipTxid)
  ) {
    return {
      v: 2,
      kind: 'snapshot',
      afterEntityType: cursor.afterEntityType,
      afterClientEntityId: cursor.afterClientEntityId,
      tipTxid: cursor.tipTxid,
      issuedAt: cursor.issuedAt,
    };
  }
  return null;
}

export interface DeltaWindow {
  now: Date;
  /** `sync_changes` retention (`SYNC_CHANGE_RETENTION_DAYS`). */
  retentionDays: number;
  /** Lowest retained `(txid, seq)` FOR THIS DESTINATION, or null when it has none. */
  destinationMin: SyncWatermark | null;
}

/**
 * True when rows after the cursor may have been swept, so the delta cannot be
 * trusted and the device must resnapshot. See the module comment. `position` is
 * the cursor's watermark (a legacy cursor is translated to one first).
 */
export function deltaCursorExpired(
  cursor: { issuedAt: number },
  position: SyncWatermark,
  window: DeltaWindow,
): boolean {
  const ageMs = Math.max(0, window.now.getTime() - cursor.issuedAt);
  const safeMs = Math.max(0, window.retentionDays - CURSOR_RETENTION_MARGIN_DAYS) * DAY_MS;
  if (ageMs < safeMs) return false;
  return window.destinationMin === null || compareWatermark(window.destinationMin, position) > 0;
}
