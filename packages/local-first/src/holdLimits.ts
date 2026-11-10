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

/** Backoff after a hold: 30s · 2^(n-1), capped at an hour. Give up only on AGE ({@link holdGiveUpReason}), never on a count. */
export const HOLD_BACKOFF_BASE_MS = 30_000;
export const HOLD_BACKOFF_CAP_MS = 60 * 60 * 1000;

/** The wait before the `attempts`-th hold of an event is re-sent. */
export function holdBackoffMs(attempts: number): number {
  return Math.min(HOLD_BACKOFF_CAP_MS, HOLD_BACKOFF_BASE_MS * 2 ** (Math.max(1, attempts) - 1));
}

export type HoldStatus = 'dependency_pending' | 'conflict' | 'rejected';

/** The hold fields a journal event carries between attempts. */
export interface HeldEventState {
  readonly holdKind?: string;
  readonly holdAttempts?: number;
  readonly heldSince?: string;
}

/** What the receipt loop does with a held event: re-hold it with this state, or dead-letter it. */
export type HoldTransition =
  | { readonly kind: 'hold'; readonly hold: { holdKind: HoldStatus; holdAttempts: number; heldSince: string; nextAttemptAt: string } }
  | { readonly kind: 'dead_letter'; readonly reason: string; readonly at: string };

/**
 * The next hold state of `event` after the server answered `status` (with `detail`) at `at`.
 *
 * A different KIND of hold than the last (waiting on a parent, then a conflict) starts a fresh clock
 * and a fresh attempt count: a long dependency wait must not make a later refusal give up instantly.
 * Out of patience ({@link holdGiveUpReason}) it is a dead letter, so sync status says so instead of
 * retrying forever; otherwise it backs off ({@link holdBackoffMs}). Pure.
 */
export function nextHoldTransition(
  event: HeldEventState,
  status: HoldStatus,
  detail: string | undefined,
  at: Date,
): HoldTransition {
  const now = at.toISOString();
  const sameKind = event.holdKind === undefined || event.holdKind === status;
  const holdAttempts = (sameKind ? (event.holdAttempts ?? 0) : 0) + 1;
  const heldSince = sameKind ? (event.heldSince ?? now) : now;
  const giveUp = holdGiveUpReason(status, detail, at.getTime() - Date.parse(heldSince));
  if (giveUp !== undefined) return { kind: 'dead_letter', reason: giveUp, at: now };
  return {
    kind: 'hold',
    hold: { holdKind: status, holdAttempts, heldSince, nextAttemptAt: new Date(at.getTime() + holdBackoffMs(holdAttempts)).toISOString() },
  };
}
