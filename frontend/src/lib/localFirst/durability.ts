/**
 * G26: the web host's half of durability. The store is shared; this module is
 * only what a HOST OWES on top of it — the two stated constants a review reads,
 * and a classification of a failed read.
 *
 * The web host gets its four properties from
 * `@builderforce/local-first/indexed-db`, which already implements all of them.
 * This module does not re-implement the store, does not open a second list of
 * secret-shaped keys, and does not invent a recovery path:
 *
 *   - BUSY TIMEOUT, NOT A LOCK STEAL. `WEB_SNAPSHOT_BUSY_TIMEOUT` is the
 *     adapter's default timeout. A second owner polls for that long and then
 *     fails `local_first_store_busy`. It never takes a live lease, and age
 *     never releases one — see `webSecondWindowMayStealLock`, which is `false`
 *     for every input, exactly like the VSIX rule it mirrors.
 *
 *   - CORRUPT IS NOT EMPTY. A snapshot row that fails validation raises
 *     `local_first_snapshot_corrupt`. `classifyWebStoreFailure` maps it to
 *     `'corrupt'`, which is a state the host must SHOW — never an empty record
 *     list and never a fake success.
 *
 *   - RECOVERY DROPS SECRETS. The web rule is `INDEXEDDB_REDACTION_RULE`,
 *     re-exported here so a host does not have to import the adapter to state
 *     it. `redactWebSnapshotForUploadOrLog` is the shared stripper, not a
 *     second list.
 *
 *   - DURABLE ACROSS RELOAD. Nothing in this module holds state: a store is
 *     reopened from the same database and reads what was committed.
 *
 * The named secrets are the adapter's. See `INDEXEDDB_REDACTED_KEYS`.
 */

import {
  DEFAULT_BUSY_POLL_MS,
  DEFAULT_BUSY_TIMEOUT_MS,
  INDEXEDDB_REDACTED_KEYS,
  INDEXEDDB_REDACTION_RULE,
  redactSnapshotForUploadOrLog,
} from '@builderforce/local-first/indexed-db';

/**
 * How long a second owner of this partition polls for the lease before the host
 * reports it busy. This is a WAIT, not a steal window: the contender never
 * writes, and never takes the lease, however long it waits.
 */
export const WEB_SNAPSHOT_BUSY_TIMEOUT = DEFAULT_BUSY_TIMEOUT_MS;

/** Interval between lease attempts while another owner holds the partition. */
export const WEB_SNAPSHOT_BUSY_POLL_MS = DEFAULT_BUSY_POLL_MS;

/** The error a contended web store reports. It is busy, never `undefined`. */
export const WEB_BUSY_ERROR = 'local_first_store_busy';

/** The error a web store reports for a snapshot row that no longer validates. */
export const WEB_CORRUPT_ERROR = 'local_first_snapshot_corrupt';

/** The states a failed open or transaction can report. `durable` is not one. */
export type WebStoreFailureState = 'corrupt' | 'quota-exceeded' | 'busy' | 'unavailable';

/**
 * A second window NEVER takes this partition's lease because of age.
 *
 * `heldForMs` is accepted and ignored, so a host cannot smuggle a steal
 * deadline in through this call — 30_000, or ten years, does not admit a second
 * owner. A live holder releases it, or nobody writes. Mirrors the VSIX
 * `secondWindowMayStealLock`, whose `false` return is the rule itself.
 */
export function webSecondWindowMayStealLock(
  _heldForMs?: number,
  _holder?: string | null,
): false {
  return false;
}

/**
 * Classify a failed open/transaction so the host SHOWS the real state.
 *
 * `local_first_snapshot_corrupt` is `corrupt`, never `unavailable` and never a
 * successful empty store: a corrupt file is not an empty file, and reporting
 * one as the other would lose the records it still holds. A missing holder is
 * never busy here — this classifies an error, it does not grant a lease.
 */
export function classifyWebStoreFailure(error: unknown): WebStoreFailureState {
  // DOMException is a host global and is absent in some runtimes, so it is
  // read defensively — a classifier must never itself throw.
  const host = globalThis as { DOMException?: new (message?: string, name?: string) => Error };
  const name =
    typeof host.DOMException === 'function' && error instanceof host.DOMException
      ? error.name
      : undefined;
  const message = error instanceof Error ? error.message : String(error);
  if (name === 'QuotaExceededError' || /quota/i.test(message)) return 'quota-exceeded';
  if (message.includes(WEB_CORRUPT_ERROR)) return 'corrupt';
  if (message.includes(WEB_BUSY_ERROR)) return 'busy';
  return 'unavailable';
}

/**
 * Secret-shaped keys stripped before a snapshot may leave this device. These
 * are the ADAPTER'S keys, re-exported rather than copied, so a host cannot
 * state a list that has drifted from the one the store enforces.
 */
export const WEB_SNAPSHOT_REDACTED_KEYS = INDEXEDDB_REDACTED_KEYS;

/**
 * The web rule, in words. It embeds the adapter's own `INDEXEDDB_REDACTION_RULE`
 * instead of restating it, so this string cannot drift into a second, weaker
 * rule the way a hand-copied list would.
 */
export const WEB_SNAPSHOT_REDACTION_NOTE = `Web: ${INDEXEDDB_REDACTION_RULE}`;

/**
 * The ONLY value the web host may upload or log. The shared stripper, so the
 * web host and the adapter cannot disagree about what a secret is.
 */
export function redactWebSnapshotForUploadOrLog<T>(value: T): T {
  return redactSnapshotForUploadOrLog(value);
}