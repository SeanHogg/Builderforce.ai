/**
 * Candidate self-scheduling — the external half of a solver that already existed.
 *
 * ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────────
 * Interview scheduling is the largest single time sink in a recruiter's week, and every
 * piece needed to remove it was already built: `availabilitySolver.ts` proposes slots
 * where everyone is free and within their declared window, `calendarFreeBusy.ts` merges
 * external calendars, `googleCalendarSync.ts` pushes the event. All of it had exactly
 * one consumer — `meetingRoutes.ts`, tenant-authenticated, internal meetings.
 *
 * A candidate is not a tenant user. They have no account, they are in another timezone,
 * and they must be able to pick a time from a link. That is the entire missing piece:
 * this module offers slots against a token, and books one.
 *
 * ── WHY THE OFFER IS STORED ──────────────────────────────────────────────────────
 * `interviews.offered_slots` holds what was proposed rather than recomputing on each
 * page load. The offer is a PROMISE: recomputing can silently drop the slot the
 * candidate is looking at, and "that time is no longer available" after they clicked is
 * the worst moment in a candidate experience. Availability is still re-checked at
 * booking — against the stored offer, not instead of it — so a genuine conflict is
 * caught while a transient one is not manufactured.
 *
 * ── WHY THE TOKEN IS A `share_links` ROW ─────────────────────────────────────────
 * A booking link is a scoped, expiring, revocable external link, which is exactly what
 * `share_links` is. Reusing it means expiry, revocation and use-counting are already
 * built and already audited, and there is no second token table to keep in step. The
 * raw token is returned ONCE at creation and only its SHA-256 is stored, so a database
 * read cannot mint a working link.
 */

import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { interviewKitStages, interviews } from '../../infrastructure/database/schema/hiring';
import { shareLinks } from '../../infrastructure/database/schema/kernel';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { sha256Hex } from '../../domain/shared/hash';
import { proposeSlots } from '../calendar/attendeeAvailability';
import { withinWindows, isBusy } from '../calendar/availabilitySolver';
import { loadDeclaredAvailability, loadAllBusy } from '../calendar/attendeeAvailability';
import type { Env } from '../../env';

export interface OfferedSlot { startISO: string; endISO: string }

/**
 * The interviewers whose calendars a proposed slot must clear.
 *
 * Read from the interview's kit stage and NEVER from a request. Both the tenant route
 * and the public candidate route need it, and a client-supplied panel is a
 * client-supplied availability check: pass an empty list and every slot clears.
 */
export async function interviewPanelRefs(
  db: Db,
  tenantId: number,
  interviewId: number,
): Promise<string[]> {
  const [row] = await db
    .select({ kitStageId: interviews.kitStageId })
    .from(interviews)
    .where(scopedToTenant(interviews, tenantId, eq(interviews.id, interviewId)))
    .limit(1);
  if (!row?.kitStageId) return [];
  // Scoped as well, even though the stage was reached through a tenant-scoped interview:
  // a stage id is a bare integer, and defence that depends on the caller having filtered
  // upstream is defence that lapses the first time somebody calls this from elsewhere.
  const [stage] = await db
    .select({ interviewerRefs: interviewKitStages.interviewerRefs })
    .from(interviewKitStages)
    .where(scopedToTenant(interviewKitStages, tenantId, eq(interviewKitStages.id, row.kitStageId)))
    .limit(1);
  const refs = stage?.interviewerRefs;
  return Array.isArray(refs) ? refs.filter((ref): ref is string => typeof ref === 'string') : [];
}

/** The tenant an interview belongs to — the public booking route resolves a token to an
 *  interview id and needs the scope before it can read that interview's panel. */
export async function interviewTenantId(db: Db, interviewId: number): Promise<number | null> {
  const [row] = await db
    .select({ tenantId: interviews.tenantId })
    .from(interviews)
    .where(eq(interviews.id, interviewId))
    .limit(1);
  return row?.tenantId ?? null;
}

/** What the candidate's page needs, and nothing else. */
export interface BookingOffer {
  interviewId: number;
  slots: OfferedSlot[];
  durationMinutes: number;
  candidateTimezone: string | null;
  bookedAt: string | null;
  expiresAt: string | null;
}

/** How long a booking link lives unless the caller says otherwise. Long enough that a
 *  candidate can reply after a weekend; short enough that a leaked link goes stale. */
const DEFAULT_LINK_DAYS = 14;

/**
 * Slots the candidate may book, with the token that lets them.
 *
 * Returns the RAW token exactly once — it is not recoverable afterwards, by design.
 * Offering again replaces the previous link (the old row is revoked), so a re-offer
 * cannot leave two working links against one interview.
 */
export async function offerInterviewSlots(
  db: Db,
  env: Env,
  input: {
    tenantId: number;
    interviewId: number;
    /** Interviewer refs whose calendars the slots must clear. */
    panelRefs: readonly string[];
    durationMinutes: number;
    candidateTimezone?: string | null;
    fromMs?: number;
    toMs?: number;
    count?: number;
    linkDays?: number;
    createdBy?: string;
  },
): Promise<{ token: string; slots: OfferedSlot[]; expiresAt: string } | { error: string }> {
  const [row] = await db.select().from(interviews).where(and(
    eq(interviews.tenantId, input.tenantId),
    eq(interviews.id, input.interviewId),
  )).limit(1);
  if (!row) return { error: 'Interview not found' };
  // An interview with no `objectId` has no kernel object for the share link to point at,
  // and `share_links.object_id` is NOT NULL. Saying so is better than a foreign-key error
  // the recruiter has to interpret.
  if (!row.objectId) return { error: 'This interview has no canvas object to share; open it on a board first.' };

  const fromMs = input.fromMs ?? Date.now();
  const toMs = input.toMs ?? fromMs + 14 * 86_400_000;
  const durationMinutes = Math.min(480, Math.max(5, Math.round(input.durationMinutes || 30)));

  const slots = await proposeSlots(db, env, input.tenantId, input.panelRefs, {
    fromMs, toMs, durationMinutes, count: Math.min(20, Math.max(1, input.count ?? 8)),
  });
  // No slots is a real answer and must not be sent as a link to an empty page: the panel
  // is genuinely unavailable in the window, and the recruiter needs to know that now
  // rather than after the candidate opens it.
  if (!slots.length) return { error: 'No slot clears every interviewer in that window. Widen the window or trim the panel.' };

  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '');
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + Math.max(1, input.linkDays ?? DEFAULT_LINK_DAYS) * 86_400_000);

  // Revoke first, then create: an interview must never have two live booking links, and
  // ordering it this way means a failure leaves zero rather than two.
  if (row.bookingShareId) {
    await db.update(shareLinks).set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(scopedToTenant(shareLinks, input.tenantId, eq(shareLinks.id, row.bookingShareId)));
  }

  const [link] = await db.insert(shareLinks).values({
    tenantId: input.tenantId,
    objectId: row.objectId,
    tokenHash,
    // Its own scope, not 'view': a booking link WRITES (it sets `scheduledAt`), and
    // reusing 'view' would make a read-only share indistinguishable from one that can
    // change a schedule.
    scope: 'book',
    expiresAt,
    ...(input.createdBy ? { createdBy: input.createdBy } : {}),
  }).returning({ id: shareLinks.id });

  // A RETURNING that came back empty means the insert did not land; writing the
  // interview's booking pointer from `link!.id` would leave it pointing at nothing and
  // the candidate at a dead link.
  if (!link) return { error: 'Could not create the booking link. Try again.' };

  await db.update(interviews).set({
    bookingShareId: link.id,
    offeredSlots: slots,
    candidateTimezone: input.candidateTimezone ?? row.candidateTimezone ?? null,
    updatedAt: new Date(),
  }).where(scopedToTenant(interviews, input.tenantId, eq(interviews.id, row.id)));

  return { token, slots, expiresAt: expiresAt.toISOString() };
}

/**
 * The interview + live link behind a raw token, or null when it does not resolve.
 *
 * The ONE query in this module with no tenant predicate, and it cannot have one: there is
 * no session here, so the tenant is an OUTPUT of this lookup rather than an input. The
 * token hash is the scope — it is a 256-bit value stored only as its SHA-256, matched on
 * a UNIQUE column, so it resolves to exactly one row or to none. Every write that follows
 * is then scoped to the `tenantId` this returns, so a resolved token can only ever change
 * rows inside its own tenant.
 */
async function resolveToken(db: Db, token: string) {
  if (!token || token.length < 32) return null;
  const tokenHash = await sha256Hex(token);
  const [row] = await db
    .select({
      interviewId: interviews.id,
      tenantId: interviews.tenantId,
      offeredSlots: interviews.offeredSlots,
      candidateTimezone: interviews.candidateTimezone,
      scheduledAt: interviews.scheduledAt,
      bookedAt: interviews.bookedAt,
      status: interviews.status,
      linkId: shareLinks.id,
      expiresAt: shareLinks.expiresAt,
      useCount: shareLinks.useCount,
      maxUses: shareLinks.maxUses,
    })
    .from(shareLinks)
    .innerJoin(interviews, eq(interviews.bookingShareId, shareLinks.id))
    .where(and(
      eq(shareLinks.tokenHash, tokenHash),
      eq(shareLinks.scope, 'book'),
      isNull(shareLinks.revokedAt),
    ))
    .limit(1);
  if (!row) return null;
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;
  if (row.maxUses != null && row.useCount >= row.maxUses) return null;
  return row;
}

function slotsOf(value: unknown): OfferedSlot[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const slot = raw as Record<string, unknown>;
    const startISO = typeof slot.startISO === 'string' ? slot.startISO : '';
    const endISO = typeof slot.endISO === 'string' ? slot.endISO : '';
    return startISO && endISO ? [{ startISO, endISO }] : [];
  });
}

/**
 * What the candidate sees.
 *
 * Slots already in the past are dropped on READ rather than on a schedule: a link opened
 * a week after it was sent must not offer last Tuesday, and no sweep can be relied on to
 * have run. Returns nothing identifying beyond the times — the page is public.
 */
export async function readBookingOffer(db: Db, token: string): Promise<BookingOffer | null> {
  const row = await resolveToken(db, token);
  if (!row) return null;
  const now = Date.now();
  const slots = slotsOf(row.offeredSlots).filter((slot) => Date.parse(slot.startISO) > now);
  const first = slots[0];
  const durationMinutes = first
    ? Math.max(5, Math.round((Date.parse(first.endISO) - Date.parse(first.startISO)) / 60_000))
    : 30;
  return {
    interviewId: row.interviewId,
    slots,
    durationMinutes,
    candidateTimezone: row.candidateTimezone,
    bookedAt: row.bookedAt ? row.bookedAt.toISOString() : null,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
  };
}

/**
 * Book one of the offered slots.
 *
 * Three checks, in this order, because each rules out a different failure:
 *   1. the slot was OFFERED — a token holder cannot book an arbitrary time;
 *   2. it has not already been booked — the link is single-use for booking, and a
 *      double-click must not move an interview that is already set;
 *   3. the panel is STILL free — re-checked against live availability, because the
 *      offer may be days old and an interviewer's calendar moves.
 */
export async function bookInterviewSlot(
  db: Db,
  env: Env,
  token: string,
  startISO: string,
  panelRefs: readonly string[],
): Promise<{ ok: true; scheduledAt: string } | { ok: false; error: string; code: 'invalid' | 'taken' | 'unavailable' | 'not-offered' }> {
  const row = await resolveToken(db, token);
  if (!row) return { ok: false, error: 'This booking link is no longer valid.', code: 'invalid' };
  if (row.bookedAt) return { ok: false, error: 'This interview has already been booked.', code: 'taken' };

  const slot = slotsOf(row.offeredSlots).find((candidate) => candidate.startISO === startISO);
  if (!slot) return { ok: false, error: 'That time was not one of the offered slots.', code: 'not-offered' };

  const startMs = Date.parse(slot.startISO);
  const endMs = Date.parse(slot.endISO);
  if (!Number.isFinite(startMs) || startMs <= Date.now()) {
    return { ok: false, error: 'That time has passed. Choose another.', code: 'unavailable' };
  }

  if (panelRefs.length) {
    const [availability, busy] = await Promise.all([
      loadDeclaredAvailability(db, row.tenantId, panelRefs),
      loadAllBusy(db, env, row.tenantId, panelRefs, startMs, endMs),
    ]);
    const stillFree = availability.every((person) =>
      withinWindows(startMs, endMs, person) && !isBusy(startMs, endMs, busy.get(person.userId) ?? []));
    if (!stillFree) {
      return { ok: false, error: 'An interviewer is no longer free at that time. Choose another slot.', code: 'unavailable' };
    }
  }

  const now = new Date();
  // Guarded on `bookedAt IS NULL` so two simultaneous bookings cannot both win — the
  // check above narrows the race, this closes it.
  const updated = await db.update(interviews).set({
    scheduledAt: new Date(startMs),
    bookedAt: now,
    status: 'scheduled',
    updatedAt: now,
  }).where(scopedToTenant(
    interviews,
    row.tenantId,
    eq(interviews.id, row.interviewId),
    isNull(interviews.bookedAt),
  )).returning({ id: interviews.id });

  if (!updated.length) return { ok: false, error: 'This interview has already been booked.', code: 'taken' };

  await db.update(shareLinks).set({
    useCount: row.useCount + 1,
    lastUsedAt: now,
    updatedAt: now,
  }).where(scopedToTenant(shareLinks, row.tenantId, eq(shareLinks.id, row.linkId)));

  return { ok: true, scheduledAt: new Date(startMs).toISOString() };
}
