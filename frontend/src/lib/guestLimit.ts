/**
 * THE reading of "an anonymous visitor has run out of free turns".
 *
 * The gateway answers a spent guest allowance with a structured 429 — chat says
 * `{ code: 'guest_limit_reached', reason, limit }` (see `handleGuestChat`) and the
 * research surface says `guest_research_limit_reached` the same way (`chargeResearch`).
 * Every guest surface then has to make the same two decisions from it: what to SAY,
 * and whether to offer the way forward (a free account). Both were re-derived per
 * surface from `error.code` comparisons, which is how the Creation Canvas ended up
 * printing "Sign up free to keep going" as prose with nothing to click.
 *
 * One classifier, so a surface asks "is this a guest wall?" instead of pattern
 * matching an error shape it does not own — and one channel, because the two
 * allowances are refused in different places: chat THROWS (the turn ends), while
 * research returns its refusal as a tool result so the model can carry on with what
 * the user already gave it. The canvas has to learn about both.
 */

import type { LlmError } from './builderforceApi';

/** Which free allowance was spent. */
export type GuestAllowance = 'messages' | 'research';

/** Whose allowance it was. */
export type GuestLimitReason =
  /** This visitor's own daily allowance. */
  | 'guest'
  /** Every visitor behind this IP together (the anti-abuse cap). */
  | 'ip'
  /** A shared guest room's combined allowance. */
  | 'room';

export interface GuestLimitRefusal {
  allowance: GuestAllowance;
  reason: GuestLimitReason;
  /** Calls the refused allowance grants per day, when the gateway named it. */
  limit: number | null;
}

const ALLOWANCE_BY_CODE: Record<string, GuestAllowance> = {
  guest_limit_reached: 'messages',
  guest_research_limit_reached: 'research',
};

/**
 * Classify a gateway error BODY as a guest wall, or `null` for any other failure.
 * Structured fields only — never error prose, which is localized on the client and
 * would stop matching in every locale but English.
 */
export function guestLimitFromBody(body: unknown): GuestLimitRefusal | null {
  const fields = (body ?? {}) as { code?: unknown; reason?: unknown; limit?: unknown };
  const allowance = typeof fields.code === 'string' ? ALLOWANCE_BY_CODE[fields.code] : undefined;
  if (!allowance) return null;
  const limit = Number(fields.limit);
  return {
    allowance,
    reason: fields.reason === 'ip' || fields.reason === 'room' ? fields.reason : 'guest',
    limit: Number.isFinite(limit) && limit > 0 ? limit : null,
  };
}

/** The same reading, for a turn that THREW — the chat path, where the refusal ends it. */
export function guestLimitRefusal(error: unknown): GuestLimitRefusal | null {
  const candidate = error as LlmError | null | undefined;
  if (!candidate || typeof candidate.code !== 'string') return null;
  return guestLimitFromBody({ ...(candidate.body ?? {}), code: candidate.code });
}

// ---------------------------------------------------------------------------
// The channel for a refusal that does NOT reach the surface as a thrown error
// ---------------------------------------------------------------------------

const listeners = new Set<(refusal: GuestLimitRefusal) => void>();

/** Announce a guest wall met somewhere the surface cannot see (a tool result). */
export function noteGuestLimit(refusal: GuestLimitRefusal): void {
  for (const listener of [...listeners]) listener(refusal);
}

/** Subscribe a surface to those walls. Returns the unsubscribe. */
export function onGuestLimit(listener: (refusal: GuestLimitRefusal) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
