/**
 * Scheduling — services, hosts and reservations (PRD 19 §9).
 *
 * ── §2 ROW 5 SAYS BURNRATEOS WINS THIS ONE ──────────────────────────────────
 * The capability-ownership register is explicit: bookings are **BurnRateOS
 * (richer)** and hired.video's are dropped. Builderforce had no scheduling
 * product at all — only `availability_slots`, which is the raw "when is somebody
 * free" table read by interviews and ceremonies. So this is the one place in the
 * merge where the incoming side is the mature one, and the shape it brings is
 * kept whole rather than trimmed to fit.
 *
 * What Builderforce contributes is what it already owns and BurnRateOS would have
 * duplicated: `availability_slots` stays the single source of "free", and
 * `objects` registration makes a reservation addressable like everything else.
 *
 * ── DOUBLE BOOKING IS PREVENTED BY THE WRITE, NOT BY THE UI ─────────────────
 * There is no exclusion constraint on `booking_reservations`, so overlap has to
 * be refused by {@link reserve} — and it is refused inside a transaction, because
 * a check-then-insert outside one is exactly the race that produces two people in
 * the same slot. The overlap predicate is the standard half-open one
 * (`existing.starts_at < new.ends_at AND existing.ends_at > new.starts_at`), so
 * a booking that starts precisely when another ends is allowed rather than
 * rejected — back-to-back meetings are the normal case, not a conflict.
 *
 * ── BUFFERS BELONG TO THE SERVICE, AND ARE APPLIED HERE ─────────────────────
 * `booking_services.buffer_min` exists so a host is not booked wall-to-wall. It
 * only works if the OVERLAP CHECK includes it, which is why {@link reserve}
 * widens the window it tests by the buffer on both sides rather than merely
 * displaying the buffer to a booker.
 *
 * ── CAPACITY IS PER SLOT, NOT PER SERVICE ───────────────────────────────────
 * A `one_to_many` service (a webinar, office hours) has `capacity > 1`, and the
 * cap applies to concurrent bookings of the SAME slot. So the overlap check
 * counts rather than existence-tests, and rejects only when the count has reached
 * capacity.
 */

import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import {
  bookingHosts,
  bookingReservations,
  bookingServices,
} from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { recordActivity, type ActorIdentity } from '../activity/activityLog';
import { registerObject } from '../kernel/ObjectRegistry';

/** `booking_services.mode`. */
export const BOOKING_MODES = ['one_to_one', 'one_to_many', 'round_robin'] as const;
export type BookingMode = (typeof BOOKING_MODES)[number];

/** `booking_reservations.status`. */
export const RESERVATION_STATUSES = ['confirmed', 'cancelled', 'completed', 'no_show'] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const isBookingMode = (v: unknown): v is BookingMode =>
  typeof v === 'string' && (BOOKING_MODES as readonly string[]).includes(v);
export const isReservationStatus = (v: unknown): v is ReservationStatus =>
  typeof v === 'string' && (RESERVATION_STATUSES as readonly string[]).includes(v);

export class BookingError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) {
    super(message);
    this.name = 'BookingError';
  }
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// ── Services ────────────────────────────────────────────────────────────────

export async function listServices(db: Db, tenantId: number) {
  return db
    .select({
      id: bookingServices.id,
      slug: bookingServices.slug,
      name: bookingServices.name,
      description: bookingServices.description,
      durationMin: bookingServices.durationMin,
      bufferMin: bookingServices.bufferMin,
      priceCents: bookingServices.priceCents,
      currency: bookingServices.currency,
      mode: bookingServices.mode,
      capacity: bookingServices.capacity,
      hostCount: sql<number>`(
        select count(*)::int from ${bookingHosts}
        where ${bookingHosts.serviceId} = ${bookingServices.id} and ${bookingHosts.isActive}
      )`,
    })
    .from(bookingServices)
    .where(scopedToTenant(bookingServices, tenantId))
    .orderBy(asc(bookingServices.name));
}

export async function createService(
  db: Db,
  tenantId: number,
  input: { slug: string; name: string; description?: string | null; durationMin?: number; bufferMin?: number; priceCents?: number; currency?: string; mode?: BookingMode; capacity?: number },
) {
  const slug = input.slug.trim().toLowerCase();
  if (!SLUG.test(slug) || slug.length > 160) {
    throw new BookingError('slug must be lowercase alphanumeric words separated by single hyphens');
  }
  const mode = input.mode ?? 'one_to_one';
  if (!isBookingMode(mode)) throw new BookingError(`mode must be one of: ${BOOKING_MODES.join(', ')}`);

  const capacity = input.capacity ?? 1;
  if (mode === 'one_to_one' && capacity !== 1) {
    throw new BookingError('a one_to_one service has capacity 1 — use one_to_many for a group session');
  }
  if (capacity < 1) throw new BookingError('capacity must be at least 1');
  if ((input.durationMin ?? 30) <= 0) throw new BookingError('durationMin must be positive');

  const [existing] = await db
    .select({ id: bookingServices.id })
    .from(bookingServices)
    .where(scopedToTenant(bookingServices, tenantId, eq(bookingServices.slug, slug)))
    .limit(1);
  if (existing) throw new BookingError(`a service already uses /${slug}`, 409);

  const [row] = await db
    .insert(bookingServices)
    .values({
      tenantId,
      slug,
      name: input.name.trim().slice(0, 200),
      description: input.description ?? null,
      durationMin: input.durationMin ?? 30,
      bufferMin: input.bufferMin ?? 0,
      priceCents: input.priceCents ?? 0,
      currency: input.currency ?? 'USD',
      mode,
      capacity,
    })
    .returning();
  if (!row) throw new BookingError('could not create the service');
  return row;
}

/** Attach a host. `priority` orders round-robin assignment; `connection_id`
 *  points at the calendar this host's availability syncs from. */
export async function addHost(
  db: Db,
  tenantId: number,
  serviceId: number,
  input: { hostRef: string; timezone?: string; priority?: number; connectionId?: number | null },
) {
  const [row] = await db
    .insert(bookingHosts)
    .values({
      tenantId,
      serviceId,
      hostRef: input.hostRef.trim().slice(0, 64),
      timezone: input.timezone ?? 'UTC',
      priority: input.priority ?? 0,
      connectionId: input.connectionId ?? null,
    })
    .returning();
  if (!row) throw new BookingError('could not add the host');
  return row;
}

export async function serviceHosts(db: Db, tenantId: number, serviceId: number) {
  return db
    .select()
    .from(bookingHosts)
    .where(scopedToTenant(bookingHosts, tenantId, and(
      eq(bookingHosts.serviceId, serviceId),
      eq(bookingHosts.isActive, true),
    )))
    .orderBy(asc(bookingHosts.priority));
}

// ── Reserving ───────────────────────────────────────────────────────────────

/**
 * Take a slot.
 *
 * The overlap check and the insert are in ONE transaction — see the module
 * docstring; a check-then-insert outside a transaction is the race that produces
 * two people in the same slot, and it will happen the first time two people click
 * at once.
 *
 * The window tested is widened by the service's buffer on both sides so that
 * `buffer_min` is enforced rather than merely displayed. Cancelled reservations
 * are excluded from the check: a cancelled slot is free, which is the entire
 * point of cancelling.
 */
export async function reserve(
  db: Db,
  env: Env,
  tenantId: number,
  actor: ActorIdentity,
  input: {
    serviceId: number;
    startsAt: Date;
    hostRef?: string | null;
    bookerRef?: string | null;
    bookerEmail?: string | null;
    timezone?: string;
  },
) {
  const [service] = await db
    .select()
    .from(bookingServices)
    .where(scopedToTenant(bookingServices, tenantId, eq(bookingServices.id, input.serviceId)))
    .limit(1);
  if (!service) throw new BookingError('service not found', 404);
  if (!input.bookerRef && !input.bookerEmail) {
    throw new BookingError('a reservation needs a bookerRef or a bookerEmail');
  }

  const endsAt = new Date(input.startsAt.getTime() + service.durationMin * 60_000);
  if (endsAt <= input.startsAt) throw new BookingError('the service duration must be positive');

  const bufferMs = service.bufferMin * 60_000;
  const windowStart = new Date(input.startsAt.getTime() - bufferMs);
  const windowEnd = new Date(endsAt.getTime() + bufferMs);

  const inserted = await db.transaction(async (tx) => {
    // Half-open overlap: back-to-back bookings are allowed, genuine overlap is not.
    const clash = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(bookingReservations)
      .where(scopedToTenant(bookingReservations, tenantId, and(
        eq(bookingReservations.serviceId, input.serviceId),
        ne(bookingReservations.status, 'cancelled'),
        ...(input.hostRef ? [eq(bookingReservations.hostRef, input.hostRef)] : []),
        sql`${bookingReservations.startsAt} < ${windowEnd}`,
        sql`${bookingReservations.endsAt} > ${windowStart}`,
      )));

    // Counted, not existence-tested: a one_to_many service admits `capacity`
    // concurrent bookings of the same slot.
    if ((clash[0]?.n ?? 0) >= service.capacity) {
      throw new BookingError('that slot is no longer available', 409);
    }

    const [row] = await tx
      .insert(bookingReservations)
      .values({
        tenantId,
        serviceId: input.serviceId,
        hostRef: input.hostRef ?? null,
        bookerRef: input.bookerRef ?? null,
        bookerEmail: input.bookerEmail ?? null,
        startsAt: input.startsAt,
        endsAt,
        timezone: input.timezone ?? 'UTC',
        status: 'confirmed',
      })
      .returning();
    return row;
  });
  if (!inserted) throw new BookingError('could not reserve the slot');

  const registered = await registerObject(db, env, {
    tenantId, kind: 'booking', refId: inserted.id, domain: 'commerce',
    title: `${service.name} — ${input.startsAt.toISOString()}`,
  });
  const [row] = await db
    .update(bookingReservations)
    .set({ objectId: registered.id, updatedAt: new Date() })
    .where(scopedToTenant(bookingReservations, tenantId, eq(bookingReservations.id, inserted.id)))
    .returning();
  if (!row) throw new BookingError('could not reserve the slot');

  await recordActivity(env, db, {
    tenantId, actor, verb: 'booking.reserved',
    targetType: 'booking', targetId: String(row.id), objectId: registered.id,
    metadata: { service: service.name, startsAt: input.startsAt.toISOString(), hostRef: input.hostRef ?? null },
  });
  return row;
}

/**
 * Change a reservation's status.
 *
 * `cancelled` frees the slot, which is why {@link reserve} excludes it — and why
 * this is the only path that sets it, rather than a generic patch that could set
 * `completed` on something that never happened.
 */
export async function setReservationStatus(
  db: Db,
  env: Env,
  tenantId: number,
  actor: ActorIdentity,
  id: number,
  status: ReservationStatus,
) {
  if (!isReservationStatus(status)) {
    throw new BookingError(`status must be one of: ${RESERVATION_STATUSES.join(', ')}`);
  }
  const [row] = await db
    .update(bookingReservations)
    .set({ status, updatedAt: new Date() })
    .where(scopedToTenant(bookingReservations, tenantId, eq(bookingReservations.id, id)))
    .returning();
  if (!row) throw new BookingError('reservation not found', 404);

  await recordActivity(env, db, {
    tenantId, actor, verb: `booking.${status}`,
    targetType: 'booking', targetId: String(id),
    metadata: { startsAt: row.startsAt.toISOString() },
  });
  return row;
}

/** The diary — upcoming reservations, optionally for one host. */
export async function upcoming(db: Db, tenantId: number, hostRef?: string) {
  return db
    .select()
    .from(bookingReservations)
    .where(scopedToTenant(bookingReservations, tenantId, and(
      ne(bookingReservations.status, 'cancelled'),
      sql`${bookingReservations.endsAt} > now()`,
      ...(hostRef ? [eq(bookingReservations.hostRef, hostRef)] : []),
    )))
    .orderBy(asc(bookingReservations.startsAt));
}

/**
 * Which slots in a window are already taken.
 *
 * Returns the BOOKED intervals rather than the free ones, deliberately: free time
 * is a function of the host's `availability_slots` — which Builderforce already
 * owns and which this module must not re-derive — intersected with what is
 * booked. Returning "free" from here would be a second, quietly divergent answer
 * to a question that table exists to answer.
 */
export async function busyIntervals(db: Db, tenantId: number, serviceId: number, from: Date, to: Date) {
  return db
    .select({
      startsAt: bookingReservations.startsAt,
      endsAt: bookingReservations.endsAt,
      hostRef: bookingReservations.hostRef,
      status: bookingReservations.status,
    })
    .from(bookingReservations)
    .where(scopedToTenant(bookingReservations, tenantId, and(
      eq(bookingReservations.serviceId, serviceId),
      ne(bookingReservations.status, 'cancelled'),
      sql`${bookingReservations.startsAt} < ${to}`,
      sql`${bookingReservations.endsAt} > ${from}`,
    )))
    .orderBy(asc(bookingReservations.startsAt));
}

/** Booking outcomes by service — including no-shows, which are the number that
 *  decides whether to start charging a deposit. */
export async function bookingStats(db: Db, tenantId: number) {
  return db
    .select({
      serviceId: bookingReservations.serviceId,
      total: sql<number>`count(*)::int`,
      confirmed: sql<number>`count(*) filter (where ${bookingReservations.status} = 'confirmed')::int`,
      completed: sql<number>`count(*) filter (where ${bookingReservations.status} = 'completed')::int`,
      cancelled: sql<number>`count(*) filter (where ${bookingReservations.status} = 'cancelled')::int`,
      noShow: sql<number>`count(*) filter (where ${bookingReservations.status} = 'no_show')::int`,
    })
    .from(bookingReservations)
    .where(scopedToTenant(bookingReservations, tenantId))
    .groupBy(bookingReservations.serviceId)
    .orderBy(desc(sql`count(*)`));
}
