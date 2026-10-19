/**
 * Application — refuse an invalid client `occurredAt` before any insert (G25).
 *
 * {@link occurredAtError} is the rule. {@link rejectInvalidOccurredAt} is the
 * check a push calls first. {@link pushClientOccurredAt} is the push path: it
 * calls that check, and `insert` runs only when the check returns `null`.
 *
 * This module does not open a database or read `Date.now()`. `now` is an
 * argument. A refusal is a code. There is no row.
 */

import { occurredAtError, type OccurredAtErrorCode } from '../../domain/sync/occurredAtGate';

/**
 * Gate a client `occurredAt` against the injected server clock.
 *
 * Returns the {@link occurredAtError} result: `occurred_at_invalid`,
 * `occurred_at_in_future`, or `null`. Does not insert a row.
 */
export function rejectInvalidOccurredAt(
  occurredAt: string,
  now: Date,
): OccurredAtErrorCode | null {
  return occurredAtError(occurredAt, now);
}

/** The slice of a pushed event this path reads. Other fields are preserved. */
export interface PushClientEvent {
  occurredAt: string;
}

export type PushClientOccurredAtResult<T extends PushClientEvent> =
  | { ok: true; event: T }
  | { ok: false; code: OccurredAtErrorCode };

/**
 * Push path. Calls {@link occurredAtError} before `insert`.
 *
 * A code is a rejection: `insert` is not called, and nothing is written. `null`
 * admits the original event — including an arbitrarily old historical
 * `occurredAt` — and only then calls `insert`.
 */
export function pushClientOccurredAt<T extends PushClientEvent>(
  event: T,
  now: Date,
  insert: (event: T) => void,
): PushClientOccurredAtResult<T> {
  const code = occurredAtError(event.occurredAt, now);
  if (code !== null) return { ok: false, code };
  insert(event);
  return { ok: true, event };
}
