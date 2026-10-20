/**
 * Domain — THE pull cursor codec (G18). One codec; there is no second token.
 *
 * A cursor is base64url JSON so a client treats it as opaque while the server
 * can still reject a garbled one deterministically. Two shapes:
 *
 * - DELTA `{ seq, issuedAt }`: every `sync_changes` row of this destination
 *   with `seq > seq` is still unread. `seq` is a POSITION in the tenant's log,
 *   not "the last row this destination saw" — a page that drains the
 *   destination advances it to the tenant tip read before the page, so a
 *   destination with no changes of its own does not sit at 0 while the global
 *   sequence moves on (the resnapshot-forever bug).
 * - SNAPSHOT `{ afterEntityType, afterClientEntityId, tip, issuedAt }`: keyset
 *   over `sync_records`. `tip` is the tenant's max change seq captured on the
 *   FIRST snapshot page, so a change written while the snapshot pages is still
 *   delivered by the delta that follows (it has `seq > tip`).
 *
 * `issuedAt` (epoch ms) is when the guarantee "nothing after `seq` was swept"
 * was last proven. `sync_changes` is swept by age, so a cursor younger than the
 * retention window cannot have lost a row. An older one is still good while the
 * destination retains a row at or before `seq` — sweeping removes the oldest
 * rows first, so a retained earlier row proves the later ones survived.
 * Otherwise it is {@link RESNAPSHOT_REQUIRED}, never a partial page.
 *
 * Pure: no database, no HTTP, no clock read (`now` is an argument).
 */

export interface DeltaCursor {
  v: 1;
  kind: 'delta';
  seq: number;
  issuedAt: number;
}

export interface SnapshotCursor {
  v: 1;
  kind: 'snapshot';
  /** Keyset: the last `(entityType, clientEntityId)` pair served. */
  afterEntityType: string;
  afterClientEntityId: string;
  /** Tenant max change seq read before the first snapshot page. */
  tip: number;
  issuedAt: number;
}

export type SyncCursor = DeltaCursor | SnapshotCursor;

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
export function decodeSyncCursor(raw: unknown): SyncCursor | null {
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
  if (cursor.v !== 1 || !isEpochMs(cursor.issuedAt)) return null;
  if (cursor.kind === 'delta' && isSeq(cursor.seq)) {
    return { v: 1, kind: 'delta', seq: cursor.seq, issuedAt: cursor.issuedAt };
  }
  if (
    cursor.kind === 'snapshot'
    && typeof cursor.afterEntityType === 'string'
    && typeof cursor.afterClientEntityId === 'string'
    && isSeq(cursor.tip)
  ) {
    return {
      v: 1,
      kind: 'snapshot',
      afterEntityType: cursor.afterEntityType,
      afterClientEntityId: cursor.afterClientEntityId,
      tip: cursor.tip,
      issuedAt: cursor.issuedAt,
    };
  }
  return null;
}

export interface DeltaWindow {
  now: Date;
  /** `sync_changes` retention (`SYNC_CHANGE_RETENTION_DAYS`). */
  retentionDays: number;
  /** Lowest retained change seq FOR THIS DESTINATION, or null when it has none. */
  destinationMinSeq: number | null;
}

/**
 * True when rows after `cursor.seq` may have been swept, so the delta cannot
 * be trusted and the device must resnapshot. See the module comment.
 */
export function deltaCursorExpired(cursor: DeltaCursor, window: DeltaWindow): boolean {
  const ageMs = Math.max(0, window.now.getTime() - cursor.issuedAt);
  const safeMs = Math.max(0, window.retentionDays - CURSOR_RETENTION_MARGIN_DAYS) * DAY_MS;
  if (ageMs < safeMs) return false;
  return window.destinationMinSeq === null || window.destinationMinSeq > cursor.seq;
}
