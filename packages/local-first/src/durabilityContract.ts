/**
 * G26: per-device durability is not equivalent across adapters.
 *
 * IndexedDB is a transactional store. The VSIX snapshot is one file plus a
 * lock file. A held lease is busy until the holder releases it. Age does not
 * grant the lock to a second window: there is no steal, including at 30s.
 *
 * A corrupt VSIX snapshot keeps the previous good copy and must not replace
 * it with a parse that failed. IndexedDB does not need a second file.
 *
 * Secret-shaped keys are stripped before a snapshot is eligible to upload
 * or log.
 *
 * This module only classifies and parses. It does not open IndexedDB, take a
 * file lock, write a snapshot, import vscode, touch the filesystem, or call
 * the network.
 */

/**
 * Busy timeout: a second entrant waits until the holder releases.
 * This is not a millisecond steal window. No age, including 30s, admits them.
 */
export const BUSY_TIMEOUT = 'until_release' as const;

export type BusyTimeout = typeof BUSY_TIMEOUT;

export type SnapshotRecovery =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly reason: 'corrupt_snapshot' };

/** Host stores this contract distinguishes. They are not equivalent. */
export type DurabilityAdapter = 'indexeddb' | 'vsix-file';

/** Keys stripped before a snapshot may be uploaded or logged. */
export const SECRET_SHAPED_KEYS = [
  'token',
  'password',
  'authorization',
  'cookie',
  'apiKey',
  'clientSecret',
] as const;

export type SecretShapedKey = (typeof SECRET_SHAPED_KEYS)[number];

const SECRET_KEY_SET = new Set<string>(SECRET_SHAPED_KEYS.map((key) => key.toLowerCase()));

/**
 * True while `holder` is a non-empty id.
 *
 * A missing holder (`null`, `undefined`, or `''`) is not busy. `now` and
 * `heldSince` are ignored: a held lease stays busy at 30s and at any later
 * time. The holder must release it. This function never tells a second
 * entrant it may take the lock.
 */
export function leaseBusy(
  holder: string | null | undefined,
  _now?: number,
  _heldSince?: number,
): boolean {
  return typeof holder === 'string' && holder.length > 0;
}

/**
 * Never grants a steal.
 *
 * While a holder exists the lease stays busy until that holder releases it,
 * at 30s and at any later time. A missing holder is not a steal either:
 * there is no lease to take. `now`, `heldSince`, and `stealAfterMs` cannot
 * open a path that returns true.
 */
export function lockStolen(
  _holder: string | null | undefined,
  _now?: number,
  _heldSince?: number,
  _stealAfterMs?: number,
): boolean {
  return false;
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

export type RecoveryCopyDecision =
  | {
      readonly adapter: 'vsix-file';
      readonly replace: false;
      readonly keepPrevious: true;
      readonly previous: unknown;
      readonly reason: 'corrupt_snapshot';
    }
  | {
      readonly adapter: 'vsix-file';
      readonly replace: true;
      readonly value: unknown;
    }
  | {
      readonly secondFile: false;
      readonly replace: false;
    };

/**
 * Decide whether a parse may replace the previous good copy.
 *
 * A vsix-file snapshot keeps `previous` when the parse failed and must not
 * replace that copy. A successful parse may replace it with the parsed value.
 * IndexedDB, and any other adapter, does not need a second file.
 */
export function decideRecoveryCopy(
  adapter: string,
  previous: unknown,
  raw: unknown,
): RecoveryCopyDecision {
  if (adapter !== 'vsix-file') {
    return { secondFile: false, replace: false };
  }
  const recovered = recoverSnapshot(raw);
  if (!recovered.ok) {
    return {
      adapter: 'vsix-file',
      replace: false,
      keepPrevious: true,
      previous,
      reason: 'corrupt_snapshot',
    };
  }
  return { adapter: 'vsix-file', replace: true, value: recovered.value };
}

/** True when `key` is one of the secret-shaped names, ignoring case. */
export function isSecretShapedKey(key: string): boolean {
  return typeof key === 'string' && SECRET_KEY_SET.has(key.toLowerCase());
}

/**
 * Strip secret-shaped keys before a snapshot is eligible to upload or log.
 *
 * Nested objects and arrays are walked. The input is not mutated. The
 * returned value is what may be uploaded or logged; the original must not be.
 * This does not upload, log, or call the network.
 */
export function redactForUploadOrLog<T>(value: T): T {
  return redactValue(value) as T;
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (isSecretShapedKey(key)) continue;
      out[key] = redactValue(child);
    }
    return out;
  }
  return value;
}
