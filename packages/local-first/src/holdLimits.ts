/**
 * When a held journal event stops being retried and is dead-lettered.
 *
 * A HOLD is the server answering `dependency_pending`, `conflict` or a non-permanent refusal. The
 * event backs off and is re-sent; this decides when it gives up, so sync status shows a dead-letter
 * instead of an endless spinner.
 *
 * - `dependency_pending` waits on a PARENT, which is not a defect of the event, so it is patient.
 *   What is measured is the time since the event was FIRST held under this kind (`heldSince`, read
 *   from the DEVICE clock; a change of hold kind restarts it) — not the age of the parent. The server
 *   sweeps `sync_events` after `SYNC_EVENT_RETENTION_DAYS` (api/src/domain/sync/syncRetention.ts), so a
 *   hold that long is treated as never going to resolve and the event is `dependency_unresolvable`.
 *   It is recoverable: `requeueJournalDeadLetter` (requeueJournalDeadLetter.ts) appends the same write
 *   again as a fresh live event; the VS Code "journal dead letters" command (clients/vscode/src/
 *   journalDeadLetters.ts) offers it as Retry. A permanent refusal is not recoverable that way.
 * - Every other hold gives up after 7 days as `gave_up:<detail>`.
 *
 * Pure. No store, no clock read.
 */

/**
 * MUST equal the server's `SYNC_EVENT_RETENTION_DAYS` (api/src/domain/sync/syncRetention.ts).
 * Duplicated because this package does not import the API; the two are kept in step by the
 * constant's name and this comment.
 */
export const SYNC_EVENT_RETENTION_DAYS = 90;

/** Dead-letter reason of a `dependency_pending` event held past the server's event retention. */
export const DEPENDENCY_UNRESOLVABLE = 'dependency_unresolvable';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOLD_MAX_AGE_MS = 7 * DAY_MS;
const DEPENDENCY_PENDING_MAX_AGE_MS = SYNC_EVENT_RETENTION_DAYS * DAY_MS;

/**
 * The dead-letter reason once an event has been held for `heldMs` under receipt `status`, or
 * `undefined` while it should keep backing off.
 */
export function holdGiveUpReason(
  status: 'dependency_pending' | 'conflict' | 'rejected',
  detail: string | undefined,
  heldMs: number,
): string | undefined {
  if (status === 'dependency_pending') {
    return heldMs >= DEPENDENCY_PENDING_MAX_AGE_MS ? DEPENDENCY_UNRESOLVABLE : undefined;
  }
  return heldMs >= HOLD_MAX_AGE_MS ? `gave_up:${detail ?? status}` : undefined;
}
