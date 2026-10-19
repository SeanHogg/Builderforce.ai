/**
 * Continue-with-this-advisor (A5, ticket #5236).
 *
 * A completed session is a relationship, not a one-off search. The founder-side
 * pointer is `users.advisor_reservation_id` — a nullable integer at
 * `booking_reservations.id`, the same shape as
 * `consultant_consultations.reservation_id` (bare integer, null when there is
 * nothing to continue). The booker IS the founder (`booker_ref` = `users.id`).
 * `companies` has no owner-user column, so the completed session cannot be
 * resolved to a company row.
 *
 * The second session reuses that reservation's `host_ref` and `service_id` and
 * is written with {@link reserve} in the advisor's tenant. It does not call
 * `reserveForHost`: that path re-resolves the talent through the public
 * catalogue, which is the cold start this relation exists to skip.
 *
 * The column is written with raw SQL. Migration 1241 adds it; the Drizzle
 * `users` declaration is shared with other tickets and is not edited here.
 */
import { and, asc, desc, eq, gte, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { bookingReservations } from '../../infrastructure/database/schema';
import type { ActorIdentity } from '../activity/activityLog';
import { StatusError } from '../../domain/shared/errors';
import { reserve } from './bookings';

/** The second-session write. Defaults to {@link reserve}; tests pass a fake so
 *  the reuse of host and service is asserted without the overlap transaction. */
export type ContinueBooker = (
  db: Db,
  env: Env,
  tenantId: number,
  actor: ActorIdentity,
  input: {
    serviceId: number;
    startsAt: Date;
    hostRef: string;
    bookerRef: string;
    timezone?: string;
  },
) => Promise<{ id: number; status: string }>;

/** Column added by migration 1241. */
export const FOUNDER_ADVISOR_RELATION = {
  table: 'users',
  column: 'advisor_reservation_id',
} as const;

/** Only a finished session establishes the relationship. Matches
 *  `RESERVATION_STATUSES` in bookings.ts — `pending` is not a live status. */
export const CONTINUABLE_STATUS = 'completed' as const;

export class ContinueAdvisorError extends StatusError<400 | 404> {
  constructor(message: string, status: 400 | 404 = 400) {
    super(message, status);
    this.name = 'ContinueAdvisorError';
  }
}

export interface AdvisorSessionRow {
  id: number;
  tenantId: number;
  serviceId: number | null;
  hostRef: string | null;
  bookerRef: string | null;
  status: string;
}

const founderRefOf = (founderRef: string): string => {
  const ref = founderRef.trim();
  if (!ref || ref.length > 64) {
    throw new ContinueAdvisorError('founderRef is required and must be 64 characters or fewer');
  }
  return ref;
};

async function loadSession(db: Db, reservationId: number): Promise<AdvisorSessionRow | null> {
  const [row] = await db
    .select({
      id: bookingReservations.id,
      tenantId: bookingReservations.tenantId,
      serviceId: bookingReservations.serviceId,
      hostRef: bookingReservations.hostRef,
      bookerRef: bookingReservations.bookerRef,
      status: bookingReservations.status,
    })
    .from(bookingReservations)
    .where(eq(bookingReservations.id, reservationId))
    .limit(1);
  return row ?? null;
}

/** The host and service a second session must reuse. Refuses anything that is
 *  not this founder's completed session with an advisor. */
export function continuationOf(session: AdvisorSessionRow, founderRef: string): {
  reservationId: number;
  serviceId: number;
  hostRef: string;
  tenantId: number;
} {
  const founder = founderRefOf(founderRef);
  if (session.bookerRef !== founder) {
    throw new ContinueAdvisorError('this session belongs to another founder', 404);
  }
  if (session.status !== CONTINUABLE_STATUS) {
    throw new ContinueAdvisorError('only a completed session can be continued');
  }
  if (!session.hostRef || session.serviceId == null) {
    throw new ContinueAdvisorError('the completed session has no advisor to continue with');
  }
  if (session.hostRef === founder) {
    throw new ContinueAdvisorError('a founder cannot continue a session they hosted');
  }
  return {
    reservationId: session.id,
    serviceId: session.serviceId,
    hostRef: session.hostRef,
    tenantId: session.tenantId,
  };
}

/**
 * Remember the completed session on the founder's user row.
 * Writing the same reservation again is the same relation.
 */
export async function recordAdvisorRelation(
  db: Db,
  input: { founderRef: string; reservationId: number },
) {
  const founderRef = founderRefOf(input.founderRef);
  if (!Number.isInteger(input.reservationId) || input.reservationId <= 0) {
    throw new ContinueAdvisorError('reservationId must be a positive integer');
  }
  const session = await loadSession(db, input.reservationId);
  if (!session) throw new ContinueAdvisorError('session not found', 404);
  const reused = continuationOf(session, founderRef);

  await db.execute(sql`
    UPDATE users
    SET advisor_reservation_id = ${session.id}
    WHERE id = ${founderRef}
  `);

  return {
    table: FOUNDER_ADVISOR_RELATION.table,
    column: FOUNDER_ADVISOR_RELATION.column,
    founderRef,
    reservationId: reused.reservationId,
    advisorUserId: reused.hostRef,
    serviceId: reused.serviceId,
    tenantId: reused.tenantId,
  };
}

async function readFounderReservationId(db: Db, founderRef: string): Promise<number | null> {
  const result = await db.execute(sql`
    SELECT advisor_reservation_id AS "advisorReservationId"
    FROM users
    WHERE id = ${founderRef}
    LIMIT 1
  `);
  const row = result.rows[0] as { advisorReservationId?: number | string | null } | undefined;
  if (!row || row.advisorReservationId == null) return null;
  const id = Number(row.advisorReservationId);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Book the next session with the advisor the founder already finished with.
 * The host and service come from the stored reservation — not from a catalogue
 * search — and the relation stays pointed at the completed session.
 */
export async function continueWithAdvisor(
  db: Db,
  env: Env,
  actor: ActorIdentity,
  input: { founderRef: string; startsAt: Date; timezone?: string },
  book: ContinueBooker = reserve,
) {
  const founderRef = founderRefOf(input.founderRef);
  if (!(input.startsAt instanceof Date) || Number.isNaN(input.startsAt.getTime())) {
    throw new ContinueAdvisorError('startsAt must be a valid date');
  }
  const reservationId = await readFounderReservationId(db, founderRef);
  if (reservationId == null) {
    throw new ContinueAdvisorError('no continued advisor relationship', 404);
  }
  const session = await loadSession(db, reservationId);
  if (!session) throw new ContinueAdvisorError('the continued session no longer exists', 404);
  const reused = continuationOf(session, founderRef);

  const booked = await book(db, env, reused.tenantId, actor, {
    serviceId: reused.serviceId,
    startsAt: input.startsAt,
    hostRef: reused.hostRef,
    bookerRef: founderRef,
    timezone: input.timezone,
  });

  return {
    reservationId,
    advisorUserId: reused.hostRef,
    serviceId: reused.serviceId,
    tenantId: reused.tenantId,
    session: booked,
  };
}

const sessionColumns = {
  id: bookingReservations.id,
  status: bookingReservations.status,
  hostRef: bookingReservations.hostRef,
  serviceId: bookingReservations.serviceId,
  startsAt: bookingReservations.startsAt,
  endsAt: bookingReservations.endsAt,
  meetingUrl: bookingReservations.meetingUrl,
};

/**
 * Upcoming sessions the founder booked. Not scoped to the viewer's tenant:
 * a continued session is written in the advisor's tenant, and filtering on
 * the founder's tenant would hide the relationship this module exists to show.
 */
export async function listFounderAdvisorSessions(
  db: Db,
  input: { founderRef: string },
) {
  const founderRef = founderRefOf(input.founderRef);
  return db
    .select(sessionColumns)
    .from(bookingReservations)
    .where(and(
      eq(bookingReservations.bookerRef, founderRef),
      gte(bookingReservations.startsAt, new Date()),
    ))
    .orderBy(asc(bookingReservations.startsAt))
    .limit(20);
}

/** Completed sessions this founder can continue. Past rows, newest first. */
export async function listFounderCompletedSessions(
  db: Db,
  input: { founderRef: string },
) {
  const founderRef = founderRefOf(input.founderRef);
  return db
    .select(sessionColumns)
    .from(bookingReservations)
    .where(and(
      eq(bookingReservations.bookerRef, founderRef),
      eq(bookingReservations.status, CONTINUABLE_STATUS),
    ))
    .orderBy(desc(bookingReservations.startsAt))
    .limit(20);
}

/** Upcoming sessions this advisor is hosting, in their own tenant. */
export async function listAdvisorRoster(
  db: Db,
  input: { tenantId: number; hostRef: string },
) {
  const hostRef = founderRefOf(input.hostRef);
  return db
    .select(sessionColumns)
    .from(bookingReservations)
    .where(and(
      eq(bookingReservations.tenantId, input.tenantId),
      eq(bookingReservations.hostRef, hostRef),
      gte(bookingReservations.startsAt, new Date()),
    ))
    .orderBy(asc(bookingReservations.startsAt))
    .limit(40);
}
