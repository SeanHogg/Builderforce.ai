/**
 * G26: per-device durability is not equivalent across adapters.
 *
 * IndexedDB is a transactional store. The VSIX snapshot is one file plus a
 * lock file. That lock is stolen once it has been held for
 * `VSIX_LOCK_STEAL_MS` (30 seconds), so a longer transaction can race a
 * second window. A corrupt snapshot file has no second copy; IndexedDB does
 * not need one.
 *
 * This module only classifies and parses. It does not open IndexedDB, take a
 * file lock, or write a snapshot.
 */

/** VSIX file-lock steal window. A holder at this age can be replaced. */
export const VSIX_LOCK_STEAL_MS = 30_000;

export type SnapshotRecovery =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly reason: 'corrupt_snapshot' };

/** Host stores this contract distinguishes. They are not equivalent. */
export type DurabilityAdapter = 'indexeddb' | 'vsix-file';

/**
 * True when `now - heldSince` has reached `stealAfterMs`.
 *
 * False while the hold is strictly shorter than the window. The boundary
 * itself is stolen: a lock held for exactly `stealAfterMs` may be taken.
 */
export function lockStolen(heldSince: number, now: number, stealAfterMs: number): boolean {
  return now - heldSince >= stealAfterMs;
}

/**
 * Parse a snapshot without throwing.
 *
 * Valid JSON returns the parsed value. Anything `JSON.parse` rejects —
 * truncated text, an empty file, or a non-string — is `corrupt_snapshot`.
 */
export function recoverSnapshot(raw: unknown): SnapshotRecovery {
  if (typeof raw !== 'string') return { ok: false, reason: 'corrupt_snapshot' };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, reason: 'corrupt_snapshot' };
  }
}

/**
 * Only the VSIX file snapshot can be corrupt on disk with no second copy.
 * IndexedDB is the store; it does not need a recovery file beside it.
 */
export function requiresRecoveryCopy(adapter: string): boolean {
  return adapter === 'vsix-file';
}
