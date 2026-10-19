/**
 * Domain — refuse a client `occurredAt` before any insert (G25).
 *
 * Client clocks drift. Historical import makes `occurredAt` arbitrarily OLD by
 * design, so only the future direction is bounded. Past
 * {@link MAX_FUTURE_CLOCK_SKEW_MS} the claim is a client defect, not history.
 *
 * Pure. This module does not insert, write, or call the network. `now` is an
 * argument; this module never reads `Date.now()`.
 */

/** Fifteen minutes. A client clock further ahead than this is not history. */
export const MAX_FUTURE_CLOCK_SKEW_MS = 15 * 60 * 1000;

/** Why a client `occurredAt` cannot be stored. */
export type OccurredAtErrorCode = 'occurred_at_invalid' | 'occurred_at_in_future';

/**
 * Is `occurredAt` a parseable timestamp within the allowed future skew?
 *
 * `null` means the client time may be stored later, including an arbitrarily
 * old historical import. A code means refuse — the caller must not insert.
 */
export function occurredAtError(occurredAt: string, now: Date): OccurredAtErrorCode | null {
  const at = Date.parse(occurredAt);
  if (Number.isNaN(at)) return 'occurred_at_invalid';
  if (at > now.getTime() + MAX_FUTURE_CLOCK_SKEW_MS) return 'occurred_at_in_future';
  return null;
}

/** A refusal returned before any insert. There is no row. */
export interface OccurredAtGateRefusal {
  refused: true;
  code: OccurredAtErrorCode;
}

/** The client time may be stored later. This decision does not insert it. */
export interface OccurredAtGatePass {
  refused: false;
  occurredAt: string;
}

export type OccurredAtGateDecision = OccurredAtGateRefusal | OccurredAtGatePass;

/**
 * Gate `occurredAt` against the injected server clock.
 *
 * Calls {@link occurredAtError}. A code becomes `{ refused: true, code }` and
 * stops before any insert. `null` becomes `{ refused: false, occurredAt }` with
 * the client's string kept, including an arbitrarily old historical import.
 */
export function occurredAtGate(occurredAt: string, now: Date): OccurredAtGateDecision {
  const code = occurredAtError(occurredAt, now);
  if (code !== null) return { refused: true, code };
  return { refused: false, occurredAt };
}

/**
 * Trust label for a client clock the server accepted. Imported evidence is a
 * claim, not a server observation — billing and audit must not treat
 * `occurredAt` as time the server witnessed.
 */
export const CLIENT_REPORTED_EVIDENCE = 'client-reported' as const;

/**
 * The pair a push must persist: the client's `occurredAt` unchanged, plus the
 * server clock at apply time. Historical past values stay on `occurredAt`.
 */
export interface AppliedClientTime {
  occurredAt: string;
  receivedAt: string;
  evidence: typeof CLIENT_REPORTED_EVIDENCE;
}

export type ApplyClientOccurredAtResult =
  | { ok: true; time: AppliedClientTime }
  | { ok: false; error: OccurredAtErrorCode };

/**
 * Apply the clock rule before any insert. An invalid or too-future client time
 * is refused via {@link occurredAtError} and nothing is stamped. An accepted
 * time — including an arbitrarily old historical import — keeps the client's
 * `occurredAt` and stamps a separate server `receivedAt`. The evidence is
 * always client-reported. This function does not insert a row.
 */
export function applyClientOccurredAt(occurredAt: string, now: Date): ApplyClientOccurredAtResult {
  const error = occurredAtError(occurredAt, now);
  if (error) return { ok: false, error };
  return {
    ok: true,
    time: {
      occurredAt,
      receivedAt: now.toISOString(),
      evidence: CLIENT_REPORTED_EVIDENCE,
    },
  };
}
