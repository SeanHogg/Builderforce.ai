/**
 * Domain — admit a client clock on a sync event (G25).
 *
 * The rule lives in {@link occurredAtError}. This gate is what a push calls
 * before any insert: an invalid or too-future `occurredAt` is refused with
 * that code, and an accepted event — including one years in the past — is
 * returned unchanged. No server timestamp is invented here, and nothing is
 * inserted.
 *
 * `now` is an argument. This module never reads `Date.now()`.
 */

import { occurredAtError, type OccurredAtErrorCode } from './occurredAtGate';

/** The slice of a sync event this gate reads. Other fields are preserved. */
export interface ClientTimeEvent {
  occurredAt: string;
}

export type AdmitClientTimeResult<T extends ClientTimeEvent> =
  | { ok: true; event: T }
  | { ok: false; code: OccurredAtErrorCode };

/**
 * Admit `event.occurredAt` against the injected server clock.
 *
 * Calls {@link occurredAtError} before any insert. `null` returns
 * `{ ok: true, event }` with the original `occurredAt` kept. A code returns
 * `{ ok: false, code }` and does not stamp a server time or insert a row.
 */
export function admitClientTime<T extends ClientTimeEvent>(
  event: T,
  now: Date,
): AdmitClientTimeResult<T> {
  const code = occurredAtError(event.occurredAt, now);
  if (code !== null) return { ok: false, code };
  return { ok: true, event };
}
