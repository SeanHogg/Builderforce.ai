/**
 * WHAT A WORKSPACE MEMBERSHIP COSTS — the one place that answers "does this
 * person occupy a paid seat?".
 *
 * A workspace membership is created by two very different motions and they are
 * not billed alike:
 *
 *  - `seat` — somebody was invited to the WORKSPACE to do work in it. This is
 *    the thing `PlanLimits.maxSeats` caps, and the thing Teams is sold on.
 *  - `collaborator` — somebody was shared a single CANVAS. They hold a
 *    `tenant_members` row only because canvas reads are tenant-scoped (see
 *    `application/creation/sessionAccess.ts`): membership is the mechanism, not
 *    the grant. Their real cap is `PlanLimits.maxCreationSessionCollaborators`,
 *    which Free and Pro both allow (3 and 25) — so charging them a seat made
 *    canvas sharing impossible on the two plans that advertise it, which is
 *    exactly the bug this type exists to prevent recurring.
 *
 * Stated as a type and a predicate rather than an `if` in the seat guard,
 * because the seat guard is not the only place that has to agree: the invite
 * writes it, the accept path reads it, and the member row carries it.
 */

/** The two ways a `tenant_members` row can come to exist. */
export const SEAT_KIND = {
  SEAT: 'seat',
  COLLABORATOR: 'collaborator',
} as const;

export type SeatKind = (typeof SEAT_KIND)[keyof typeof SEAT_KIND];

/** Narrow a stored string to the type. Anything unrecognised is a paid seat —
 *  the safe default, since under-counting seats is the failure that gives a
 *  plan away and over-counting is the one that merely asks someone to upgrade. */
export function asSeatKind(value: string | null | undefined): SeatKind {
  return value === SEAT_KIND.COLLABORATOR ? SEAT_KIND.COLLABORATOR : SEAT_KIND.SEAT;
}

/** Does this membership (or pending invitation) count against `maxSeats`? */
export function consumesSeat(value: string | null | undefined): boolean {
  return asSeatKind(value) === SEAT_KIND.SEAT;
}
