/**
 * A1 — the WRITES that turn a confirmed 1:1 reservation into its three records in
 * the service tenant (the advisor's workspace): an `advisory` meeting, a calendar
 * event for both attendees (the existing `pushMeetingEvent` path), and a
 * `restricted` Brain thread (`visibility: 'locked'`, `memoryEnabled: false`).
 * Nothing is copied into the booker's tenant. The plan is `advisorySessionPlan.ts`.
 *
 * IDEMPOTENT BY CONSTRAINT, NOT BY READ. The meeting carries the reservation id in
 * `meetings.advisory_reservation_id` (unique per tenant, migration 1249), so the
 * insert is `ON CONFLICT DO NOTHING` and a concurrent confirm reads the winner's
 * row instead of minting a second meeting. The thread attach is a compare-and-set
 * on `meetings.chat_id IS NULL`, so two provisions racing past "no thread yet"
 * keep exactly one thread (the loser's is deleted).
 */
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import {
  ADVISORY_THREAD_MARKER,
  encodeAdvisoryThreadMarker,
  readAdvisoryThreadState,
  sealedAdvisoryThread,
  type AdvisoryThreadState,
} from '@builderforce/creation-canvas-contract';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import {
  bookingReservations,
  bookingServices,
  brainChatMessages,
  brainChats,
  meetingAttendees,
  meetings,
  users,
} from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { pushMeetingEvent } from '../calendar/calendarService';
import { BRAIN_ORIGIN } from '../brain/chatAccess';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import {
  ADVISORY_MEETING_KIND,
  advisoryJoinUrl,
  meetingIdFromJoinUrl,
  planAdvisorySession,
  type AdvisoryProvisionPlan,
  type AdvisorySession,
  type ConfirmedReservation,
} from './advisorySessionPlan';

const SOURCE = 'application/commerce/advisoryProvisioning.ts';

/** Raised when a confirmed 1:1 cannot be provisioned as the contract requires —
 *  reported (never swallowed) by {@link provisionConfirmedAdvisory}. */
export class AdvisoryProvisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdvisoryProvisionError';
  }
}

interface LinkedMeeting { id: string; chatId: number | null; calendarEventId: string | null }

const linkedColumns = {
  id: meetings.id,
  chatId: meetings.chatId,
  calendarEventId: meetings.calendarEventId,
  kind: meetings.kind,
};

async function emailsFor(
  db: Db,
  refs: string[],
): Promise<Map<string, { email: string; name: string | null }>> {
  const ids = [...new Set(refs.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: users.id, email: users.email, displayName: users.displayName })
    .from(users)
    .where(inArray(users.id, ids));
  return new Map(rows.map((row) => [row.id, { email: row.email, name: row.displayName }]));
}

async function findAdvisoryMeeting(
  db: Db,
  tenantId: number,
  reservationId: number,
  meetingUrl: string | null,
): Promise<LinkedMeeting | null> {
  const [byRef] = await db
    .select(linkedColumns)
    .from(meetings)
    .where(scopedToTenant(meetings, tenantId, eq(meetings.advisoryReservationId, reservationId)))
    .limit(1);
  if (byRef?.kind === ADVISORY_MEETING_KIND) return byRef;

  const meetingId = meetingIdFromJoinUrl(meetingUrl);
  if (!meetingId) return null;
  const [byUrl] = await db
    .select(linkedColumns)
    .from(meetings)
    .where(scopedToTenant(meetings, tenantId, eq(meetings.id, meetingId)))
    .limit(1);
  if (!byUrl || byUrl.kind !== ADVISORY_MEETING_KIND) return null;
  return byUrl;
}

/** Insert the advisory meeting, or — when a concurrent provision won the unique
 *  reservation reference — return the winner's row. */
async function insertOrReadAdvisoryMeeting(db: Db, plan: AdvisoryProvisionPlan): Promise<LinkedMeeting> {
  const [meeting] = await db.insert(meetings).values({
    tenantId: plan.tenantId,
    kind: plan.meeting.kind,
    title: plan.meeting.title,
    description: plan.meeting.description,
    advisoryReservationId: plan.meeting.reservationId,
    scheduledAt: plan.meeting.scheduledAt,
    durationMinutes: plan.meeting.durationMinutes,
    status: 'scheduled',
    createdBy: plan.meeting.createdBy,
    roomKey: crypto.randomUUID(),
    videoEnabled: true,
  })
    .onConflictDoNothing({
      target: [meetings.tenantId, meetings.advisoryReservationId],
      where: isNotNull(meetings.advisoryReservationId),
    })
    .returning({ id: meetings.id });
  if (meeting) return { id: meeting.id, chatId: null, calendarEventId: null };

  const [existing] = await db
    .select(linkedColumns)
    .from(meetings)
    .where(scopedToTenant(meetings, plan.tenantId, eq(meetings.advisoryReservationId, plan.meeting.reservationId)))
    .limit(1);
  if (!existing) throw new AdvisoryProvisionError('advisory meeting insert conflicted but no meeting holds the reservation');
  return existing;
}

async function ensureAttendees(db: Db, plan: AdvisoryProvisionPlan, meetingId: string): Promise<void> {
  const [existing] = await db
    .select({ id: meetingAttendees.id })
    .from(meetingAttendees)
    .where(scopedToTenant(meetingAttendees, plan.tenantId, eq(meetingAttendees.meetingId, meetingId)))
    .limit(1);
  if (existing) return;

  const hostRef = plan.meeting.hostRef.slice(0, 64);
  const rows: Array<typeof meetingAttendees.$inferInsert> = [{
    tenantId: plan.tenantId,
    meetingId,
    memberKind: 'human',
    memberRef: hostRef,
    memberName: plan.meeting.hostName.slice(0, 255),
    email: plan.meeting.hostEmail?.slice(0, 255) ?? null,
    role: 'host',
    response: 'accepted',
  }];
  const bookerRef = (plan.meeting.bookerRef || plan.meeting.bookerEmail || '').slice(0, 64);
  if (bookerRef && bookerRef !== hostRef) {
    rows.push({
      tenantId: plan.tenantId,
      meetingId,
      memberKind: 'human',
      memberRef: bookerRef,
      memberName: plan.meeting.bookerName.slice(0, 255),
      email: plan.meeting.bookerEmail?.slice(0, 255) ?? null,
      role: 'attendee',
      response: 'invited',
    });
  }
  await db.insert(meetingAttendees).values(rows);
}

async function pushAdvisoryCalendar(
  db: Db,
  env: Env,
  plan: AdvisoryProvisionPlan,
  meetingId: string,
  joinUrl: string,
): Promise<string | null> {
  try {
    const synced = await pushMeetingEvent(db, env, plan.tenantId, plan.calendar.organizerId, {
      title: plan.calendar.title,
      startISO: plan.calendar.startISO,
      endISO: plan.calendar.endISO,
      attendeeEmails: plan.calendar.attendeeEmails,
      joinUrl,
    });
    if (!synced) return null;
    await db.update(meetings).set({
      calendarProvider: synced.provider,
      calendarEventId: synced.eventId,
      calendarHtmlLink: synced.htmlLink ?? null,
      updatedAt: new Date(),
    }).where(scopedToTenant(meetings, plan.tenantId, eq(meetings.id, meetingId)));
    return synced.eventId;
  } catch (error) {
    reportCaughtError(error, { source: SOURCE, operation: 'pushMeetingEvent' });
    return null;
  }
}

async function insertAdvisoryThread(
  db: Db,
  plan: AdvisoryProvisionPlan,
  ownerUserId: string,
  meetingId: string,
  reservationId: number,
): Promise<number> {
  const [chat] = await db.insert(brainChats).values({
    tenantId: plan.tenantId,
    userId: ownerUserId,
    origin: BRAIN_ORIGIN,
    title: plan.meeting.title,
    visibility: 'locked',
    mode: 'chat',
    memoryEnabled: false,
  }).returning({ id: brainChats.id });
  if (!chat) throw new AdvisoryProvisionError('advisory thread insert returned no row');

  const state = sealedAdvisoryThread(plan.thread.hostRef);
  await db.insert(brainChatMessages).values({
    chatId: chat.id,
    role: 'system',
    content: 'Advisory thread. Restricted — not in AI context until the founder invites the advisor.',
    metadata: encodeAdvisoryThreadMarker(state, {
      reservationId,
      meetingId,
      tenantId: plan.tenantId,
    }),
    eventKey: `${ADVISORY_THREAD_MARKER}:${reservationId}`,
  });
  return chat.id;
}

/** Attach a freshly-minted thread to the meeting only if none is attached yet.
 *  A provision that loses the race deletes its own thread and adopts the winner's. */
async function attachAdvisoryThread(
  db: Db,
  plan: AdvisoryProvisionPlan,
  ownerUserId: string,
  meetingId: string,
  reservationId: number,
): Promise<number> {
  const chatId = await insertAdvisoryThread(db, plan, ownerUserId, meetingId, reservationId);
  const [attached] = await db.update(meetings).set({ chatId, updatedAt: new Date() })
    .where(scopedToTenant(meetings, plan.tenantId, eq(meetings.id, meetingId), isNull(meetings.chatId)))
    .returning({ chatId: meetings.chatId });
  if (attached) return chatId;

  await db.delete(brainChats).where(scopedToTenant(brainChats, plan.tenantId, eq(brainChats.id, chatId)));
  const [winner] = await db.select({ chatId: meetings.chatId }).from(meetings)
    .where(scopedToTenant(meetings, plan.tenantId, eq(meetings.id, meetingId)))
    .limit(1);
  if (!winner?.chatId) throw new AdvisoryProvisionError('advisory thread attach lost the race but no thread is attached');
  return winner.chatId;
}

async function readThreadState(db: Db, chatId: number, hostRef: string): Promise<AdvisoryThreadState> {
  const rows = await db
    .select({ metadata: brainChatMessages.metadata })
    .from(brainChatMessages)
    .where(and(eq(brainChatMessages.chatId, chatId), eq(brainChatMessages.role, 'system')));
  for (const row of rows) {
    const state = readAdvisoryThreadState(row.metadata);
    if (state) return state;
  }
  return sealedAdvisoryThread(hostRef);
}

/**
 * Idempotent. A retry of the same confirmed reservation reuses the meeting that
 * holds its reservation reference rather than minting a second one. No-op for any
 * mode other than `one_to_one`, a non-confirmed row, or a reservation with no host.
 *
 * Throws {@link AdvisoryProvisionError} — before any write — when the booker has
 * no user account: the founder must own the thread, and an advisor-owned thread
 * would let the advisor admit it to AI context themselves.
 */
export async function provisionAdvisorySession(
  db: Db,
  env: Env,
  reservation: ConfirmedReservation,
  service: { mode: string; name: string },
): Promise<AdvisorySession | null> {
  const people = await emailsFor(db, [reservation.hostRef ?? '', reservation.bookerRef ?? '']);
  const host = reservation.hostRef ? people.get(reservation.hostRef) : undefined;
  const booker = reservation.bookerRef ? people.get(reservation.bookerRef) : undefined;
  const plan = planAdvisorySession({
    reservation,
    service,
    hostEmail: host?.email ?? null,
    bookerAccountEmail: booker?.email ?? null,
    hostName: host?.name ?? null,
    bookerName: booker?.name ?? null,
    hostIsUser: !!host,
    bookerIsUser: !!booker,
  });
  if (!plan) return null;
  const ownerUserId = plan.thread.ownerUserId;
  if (!ownerUserId) {
    throw new AdvisoryProvisionError(
      `advisory reservation ${reservation.id}: the booker has no user account to own the restricted thread`,
    );
  }

  const linked = await findAdvisoryMeeting(db, plan.tenantId, reservation.id, reservation.meetingUrl)
    ?? await insertOrReadAdvisoryMeeting(db, plan);

  await ensureAttendees(db, plan, linked.id);
  const urlMatches = meetingIdFromJoinUrl(reservation.meetingUrl) === linked.id;
  const joinUrl = reservation.meetingUrl && urlMatches ? reservation.meetingUrl : advisoryJoinUrl(env, linked.id);
  if (!reservation.meetingUrl || !urlMatches) {
    await db.update(bookingReservations).set({
      meetingUrl: joinUrl,
      updatedAt: new Date(),
    }).where(scopedToTenant(bookingReservations, plan.tenantId, eq(bookingReservations.id, reservation.id)));
  }

  const calendarEventId = linked.calendarEventId
    ?? await pushAdvisoryCalendar(db, env, plan, linked.id, joinUrl);

  const chatId = linked.chatId ?? await attachAdvisoryThread(db, plan, ownerUserId, linked.id, reservation.id);

  const state = await readThreadState(db, chatId, plan.meeting.hostRef);
  return {
    tenantId: plan.tenantId,
    reservationId: reservation.id,
    meetingId: linked.id,
    chatId,
    calendarEventId,
    confidentiality: state.confidentiality,
    founderInvitedAdvisor: state.founderInvitedAdvisor,
  };
}

/**
 * Founder confirm hook. Loads the service in the reservation's tenant and
 * provisions only a confirmed 1:1. A failure here must not un-confirm the
 * reservation — the calendar path already treats a missing grant as a no-op,
 * and a thread error is reported rather than thrown back through Book.
 */
export async function provisionConfirmedAdvisory(
  db: Db,
  env: Env,
  reservation: ConfirmedReservation,
): Promise<AdvisorySession | null> {
  if (reservation.status !== 'confirmed' || !reservation.hostRef || reservation.serviceId == null) return null;
  try {
    const [service] = await db
      .select({ mode: bookingServices.mode, name: bookingServices.name })
      .from(bookingServices)
      .where(scopedToTenant(bookingServices, reservation.tenantId, eq(bookingServices.id, reservation.serviceId)))
      .limit(1);
    if (!service || service.mode !== 'one_to_one') return null;
    return await provisionAdvisorySession(db, env, reservation, service);
  } catch (error) {
    reportCaughtError(error, { source: SOURCE, operation: 'provisionConfirmedAdvisory', context: { reservationId: reservation.id } });
    return null;
  }
}
