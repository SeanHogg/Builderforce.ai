/**
 * A1 — a confirmed 1:1 reservation against a bound advisor becomes three records
 * in the SERVICE tenant (the advisor's workspace), never the booker's:
 *
 *   1. a meeting whose kind is `advisory` (already in meeting KINDS; not a team
 *      ceremony, so it does not default-link a team chat),
 *   2. a calendar event for both attendees, via the existing `pushMeetingEvent`
 *      path (one event on the advisor's grant, both emails invited),
 *   3. a Brain thread whose confidentiality is `restricted`.
 *
 * The thread is absent from `aiContext` until the founder explicitly invites the
 * advisor. Admission is asked of `boundaryAdmits` — this module does not invent
 * a second confidentiality model. `advisory` is not in
 * `RESTRICTED_BY_DEFAULT_KINDS`, so the kind default would be `internal` and
 * would admit aiContext; the product contract is restricted, so it is set
 * explicitly.
 *
 * The Brain thread stays in the service tenant (`visibility: 'locked'`,
 * `memoryEnabled: false`). Nothing is copied into the booker's tenant.
 */
import { and, eq, inArray } from 'drizzle-orm';
import {
  boundaryAdmits,
  isConfidentialityLevel,
  type CanvasBoundary,
  type ConfidentialityLevel,
} from '@builderforce/creation-canvas-contract';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { resolveAppBaseUrl } from '../../env';
import {
  bookingReservations,
  bookingServices,
  brainChatMessages,
  brainChats,
  chatMembers,
  meetingAttendees,
  meetings,
  users,
} from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { pushMeetingEvent } from '../calendar/calendarService';
import { BRAIN_ORIGIN } from '../brain/chatAccess';
import { reportCaughtError } from '../observability/caughtErrorReporter';

export const ADVISORY_MEETING_KIND = 'advisory' as const;

/** Marker on the opening system message. Brain chats have no confidentiality column. */
export const ADVISORY_THREAD_MARKER = 'advisory-thread';

/**
 * Product contract, not the kind default. `defaultConfidentialityForKind('advisory')`
 * is `internal`, which admits aiContext. A missing or illegal label resolves here
 * too — a caller cannot smuggle the thread across a boundary by writing `public`.
 */
export const ADVISORY_THREAD_CONFIDENTIALITY: ConfidentialityLevel = 'restricted';

export interface AdvisoryThreadState {
  confidentiality: ConfidentialityLevel;
  /** True only after the founder explicitly invites the advisor. */
  founderInvitedAdvisor: boolean;
  /** The bound advisor. An invite for anyone else is refused. */
  hostRef?: string;
}

export interface AdvisorySession {
  tenantId: number;
  reservationId: number;
  meetingId: string;
  chatId: number;
  calendarEventId: string | null;
  confidentiality: ConfidentialityLevel;
  founderInvitedAdvisor: boolean;
}

export interface ConfirmedReservation {
  id: number;
  tenantId: number;
  serviceId: number;
  hostRef: string | null;
  bookerRef: string | null;
  bookerEmail: string | null;
  startsAt: Date;
  endsAt: Date;
  status: string;
  meetingUrl: string | null;
}

export interface AdvisoryProvisionPlan {
  tenantId: number;
  meeting: {
    kind: typeof ADVISORY_MEETING_KIND;
    title: string;
    scheduledAt: Date;
    durationMinutes: number;
    createdBy: string;
    hostRef: string;
    bookerRef: string | null;
    hostEmail: string | null;
    bookerEmail: string | null;
    hostName: string;
    bookerName: string;
    description: string;
  };
  calendar: {
    organizerId: string;
    title: string;
    startISO: string;
    endISO: string;
    attendeeEmails: string[];
  };
  thread: AdvisoryThreadState & {
    ownerUserId: string | null;
    visibility: 'locked';
    memoryEnabled: false;
    /** The advisor is not a member until the founder invites them. */
    advisorIsMember: false;
  };
}

export function advisoryReservationKey(reservationId: number): string {
  return `advisory-reservation:${reservationId}`;
}

export function advisoryThreadConfidentiality(declared?: unknown): ConfidentialityLevel {
  if (isConfidentialityLevel(declared) && declared === ADVISORY_THREAD_CONFIDENTIALITY) return declared;
  return ADVISORY_THREAD_CONFIDENTIALITY;
}

export function sealedAdvisoryThread(hostRef?: string): AdvisoryThreadState {
  return {
    confidentiality: ADVISORY_THREAD_CONFIDENTIALITY,
    founderInvitedAdvisor: false,
    hostRef,
  };
}

/**
 * Does this thread cross `boundary`?
 *
 * Stored confidentiality is always asked of `boundaryAdmits`. Restricted crosses
 * nothing. `aiContext` is the one boundary a founder invite can open, and only
 * by asking the contract's own ceiling (`internal`) — the stored level stays
 * restricted, so share, guest, publicMedia and export stay closed. An invite is
 * not a bypass and not a new level.
 */
export function advisoryThreadAdmitted(state: AdvisoryThreadState, boundary: CanvasBoundary): boolean {
  const level = advisoryThreadConfidentiality(state.confidentiality);
  if (boundary === 'aiContext' && state.founderInvitedAdvisor) {
    return boundaryAdmits('internal', 'aiContext');
  }
  return boundaryAdmits(level, boundary);
}

export function advisoryThreadInAiContext(state: AdvisoryThreadState): boolean {
  return advisoryThreadAdmitted(state, 'aiContext');
}

export function calendarAttendeeEmails(
  hostEmail: string | null | undefined,
  bookerEmail: string | null | undefined,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const email of [hostEmail, bookerEmail]) {
    const trimmed = email?.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed.slice(0, 255));
  }
  return out;
}

export function encodeAdvisoryThreadMarker(
  state: AdvisoryThreadState,
  extra?: Record<string, unknown>,
): string {
  return JSON.stringify({
    marker: ADVISORY_THREAD_MARKER,
    confidentiality: advisoryThreadConfidentiality(state.confidentiality),
    founderInvitedAdvisor: state.founderInvitedAdvisor === true,
    hostRef: state.hostRef ?? null,
    ...extra,
  });
}

export function readAdvisoryThreadState(metadata: string | null | undefined): AdvisoryThreadState | null {
  if (!metadata) return null;
  try {
    const raw = JSON.parse(metadata) as Record<string, unknown>;
    if (raw.marker !== ADVISORY_THREAD_MARKER) return null;
    return {
      confidentiality: advisoryThreadConfidentiality(raw.confidentiality),
      founderInvitedAdvisor: raw.founderInvitedAdvisor === true,
      hostRef: typeof raw.hostRef === 'string' && raw.hostRef ? raw.hostRef : undefined,
    };
  } catch {
    return null;
  }
}

export function planAdvisorySession(input: {
  reservation: ConfirmedReservation;
  service: { mode: string; name: string };
  hostEmail?: string | null;
  bookerAccountEmail?: string | null;
  hostName?: string | null;
  bookerName?: string | null;
  hostIsUser?: boolean;
  bookerIsUser?: boolean;
}): AdvisoryProvisionPlan | null {
  const { reservation, service } = input;
  if (reservation.status !== 'confirmed') return null;
  if (service.mode !== 'one_to_one') return null;
  const hostRef = reservation.hostRef?.trim() ?? '';
  if (!hostRef) return null;

  const bookerEmail = reservation.bookerEmail?.trim() || input.bookerAccountEmail?.trim() || null;
  const hostEmail = input.hostEmail?.trim() || null;
  const title = (service.name.trim() || 'Advisory session').slice(0, 200);
  const durationMinutes = Math.max(
    1,
    Math.round((reservation.endsAt.getTime() - reservation.startsAt.getTime()) / 60_000),
  );
  const ownerUserId = input.bookerIsUser && reservation.bookerRef
    ? reservation.bookerRef
    : input.hostIsUser
      ? hostRef
      : null;

  return {
    tenantId: reservation.tenantId,
    meeting: {
      kind: ADVISORY_MEETING_KIND,
      title,
      scheduledAt: reservation.startsAt,
      durationMinutes,
      createdBy: hostRef,
      hostRef,
      bookerRef: reservation.bookerRef,
      hostEmail,
      bookerEmail,
      hostName: input.hostName?.trim() || 'Advisor',
      bookerName: input.bookerName?.trim() || 'Founder',
      description: advisoryReservationKey(reservation.id),
    },
    calendar: {
      organizerId: hostRef,
      title,
      startISO: reservation.startsAt.toISOString(),
      endISO: reservation.endsAt.toISOString(),
      attendeeEmails: calendarAttendeeEmails(hostEmail, bookerEmail),
    },
    thread: {
      confidentiality: ADVISORY_THREAD_CONFIDENTIALITY,
      founderInvitedAdvisor: false,
      hostRef,
      ownerUserId,
      visibility: 'locked',
      memoryEnabled: false,
      advisorIsMember: false,
    },
  };
}

function meetingIdFromJoinUrl(url: string | null): string | null {
  if (!url) return null;
  const match = url.match(/[?&]join=([0-9a-fA-F-]{36})/);
  return match?.[1] ?? null;
}

export function advisoryJoinUrl(env: { APP_URL?: string }, meetingId: string): string {
  return `${resolveAppBaseUrl(env)}/meetings?join=${meetingId}`;
}

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
): Promise<{ id: string; chatId: number | null; calendarEventId: string | null } | null> {
  const [byKey] = await db
    .select({
      id: meetings.id,
      chatId: meetings.chatId,
      calendarEventId: meetings.calendarEventId,
      kind: meetings.kind,
    })
    .from(meetings)
    .where(scopedToTenant(meetings, tenantId, eq(meetings.description, advisoryReservationKey(reservationId))))
    .limit(1);
  if (byKey?.kind === ADVISORY_MEETING_KIND) return byKey;

  const meetingId = meetingIdFromJoinUrl(meetingUrl);
  if (!meetingId) return null;
  const [byUrl] = await db
    .select({
      id: meetings.id,
      chatId: meetings.chatId,
      calendarEventId: meetings.calendarEventId,
      kind: meetings.kind,
    })
    .from(meetings)
    .where(scopedToTenant(meetings, tenantId, eq(meetings.id, meetingId)))
    .limit(1);
  if (!byUrl || byUrl.kind !== ADVISORY_MEETING_KIND) return null;
  return byUrl;
}

async function ensureAttendees(db: Db, plan: AdvisoryProvisionPlan, meetingId: string): Promise<void> {
  const [existing] = await db
    .select({ id: meetingAttendees.id })
    .from(meetingAttendees)
    .where(scopedToTenant(meetingAttendees, plan.tenantId, eq(meetingAttendees.meetingId, meetingId)))
    .limit(1);
  if (existing) return;

  const hostRef = plan.meeting.hostRef.slice(0, 64);
  const rows: Array<{
    tenantId: number;
    meetingId: string;
    memberKind: string;
    memberRef: string;
    memberName: string;
    email: string | null;
    role: string;
    response: string;
  }> = [{
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
    reportCaughtError(error, { source: 'application/commerce/advisoryReservation.ts', operation: 'pushMeetingEvent' });
    return null;
  }
}

async function insertAdvisoryThread(
  db: Db,
  plan: AdvisoryProvisionPlan,
  meetingId: string,
  reservationId: number,
): Promise<number> {
  const [chat] = await db.insert(brainChats).values({
    tenantId: plan.tenantId,
    userId: plan.thread.ownerUserId,
    origin: BRAIN_ORIGIN,
    title: plan.meeting.title,
    visibility: 'locked',
    mode: 'chat',
    memoryEnabled: false,
  }).returning({ id: brainChats.id });
  if (!chat) throw new Error('advisory thread insert returned no row');

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
 * Idempotent. A retry of the same confirmed reservation reuses the meeting
 * stamped `advisory-reservation:<id>` rather than minting a second one.
 * No-op for any mode other than `one_to_one`, a non-confirmed row, or a
 * reservation with no host.
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

  let linked = await findAdvisoryMeeting(db, plan.tenantId, reservation.id, reservation.meetingUrl);
  if (!linked) {
    const [meeting] = await db.insert(meetings).values({
      tenantId: plan.tenantId,
      kind: plan.meeting.kind,
      title: plan.meeting.title,
      description: plan.meeting.description,
      scheduledAt: plan.meeting.scheduledAt,
      durationMinutes: plan.meeting.durationMinutes,
      status: 'scheduled',
      createdBy: plan.meeting.createdBy,
      roomKey: crypto.randomUUID(),
      videoEnabled: true,
    }).returning({ id: meetings.id });
    if (!meeting) throw new Error('advisory meeting insert returned no row');
    linked = { id: meeting.id, chatId: null, calendarEventId: null };
  }

  await ensureAttendees(db, plan, linked.id);
  const joinUrl = reservation.meetingUrl && meetingIdFromJoinUrl(reservation.meetingUrl) === linked.id
    ? reservation.meetingUrl
    : advisoryJoinUrl(env, linked.id);
  if (!reservation.meetingUrl || meetingIdFromJoinUrl(reservation.meetingUrl) !== linked.id) {
    await db.update(bookingReservations).set({
      meetingUrl: joinUrl,
      updatedAt: new Date(),
    }).where(scopedToTenant(bookingReservations, plan.tenantId, eq(bookingReservations.id, reservation.id)));
  }

  let calendarEventId = linked.calendarEventId;
  if (!calendarEventId) {
    calendarEventId = await pushAdvisoryCalendar(db, env, plan, linked.id, joinUrl);
  }

  let chatId = linked.chatId;
  if (!chatId) {
    chatId = await insertAdvisoryThread(db, plan, linked.id, reservation.id);
    await db.update(meetings).set({
      chatId,
      updatedAt: new Date(),
    }).where(scopedToTenant(meetings, plan.tenantId, eq(meetings.id, linked.id)));
  }

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
  if (reservation.status !== 'confirmed' || !reservation.hostRef) return null;
  try {
    const [service] = await db
      .select({ mode: bookingServices.mode, name: bookingServices.name })
      .from(bookingServices)
      .where(scopedToTenant(bookingServices, reservation.tenantId, eq(bookingServices.id, reservation.serviceId)))
      .limit(1);
    if (!service || service.mode !== 'one_to_one') return null;
    return await provisionAdvisorySession(db, env, reservation, service);
  } catch (error) {
    reportCaughtError(error, {
      source: 'application/commerce/advisoryReservation.ts',
      operation: 'provisionConfirmedAdvisory',
    });
    return null;
  }
}

function markerExtra(metadata: string | null): Record<string, unknown> {
  if (!metadata) return {};
  try {
    const raw = JSON.parse(metadata) as Record<string, unknown>;
    const rest = { ...raw };
    delete rest.marker;
    delete rest.confidentiality;
    delete rest.founderInvitedAdvisor;
    delete rest.hostRef;
    return rest;
  } catch {
    return {};
  }
}

/**
 * The only act that admits the thread to aiContext. Does not lower the stored
 * confidentiality, does not copy the thread into another tenant, and refuses
 * an invite for anyone other than the bound advisor.
 */
export async function inviteAdvisorToAdvisoryThread(
  db: Db,
  tenantId: number,
  chatId: number,
  founderUserId: string,
  advisorUserId: string,
): Promise<AdvisoryThreadState | { error: string }> {
  if (!founderUserId || !advisorUserId || founderUserId === advisorUserId) {
    return { error: 'Only the founder can invite the advisor' };
  }
  const [chat] = await db
    .select({ id: brainChats.id, userId: brainChats.userId })
    .from(brainChats)
    .where(scopedToTenant(brainChats, tenantId, eq(brainChats.id, chatId)))
    .limit(1);
  if (!chat || chat.userId !== founderUserId) return { error: 'Only the founder can invite the advisor' };

  const rows = await db
    .select({ id: brainChatMessages.id, metadata: brainChatMessages.metadata })
    .from(brainChatMessages)
    .where(and(eq(brainChatMessages.chatId, chatId), eq(brainChatMessages.role, 'system')));
  const marker = rows
    .map((row) => ({ id: row.id, metadata: row.metadata, state: readAdvisoryThreadState(row.metadata) }))
    .find((row) => row.state);
  if (!marker?.state) return { error: 'Not an advisory thread' };
  if (marker.state.hostRef !== advisorUserId) return { error: 'That person is not the advisor on this thread' };

  const [member] = await db
    .select({ id: chatMembers.id })
    .from(chatMembers)
    .where(scopedToTenant(
      chatMembers,
      tenantId,
      eq(chatMembers.chatId, chatId),
      eq(chatMembers.userId, advisorUserId),
    ))
    .limit(1);
  if (!member) {
    try {
      await db.insert(chatMembers).values({
        chatId,
        tenantId,
        userId: advisorUserId,
        status: 'active',
        invitedBy: founderUserId,
        role: 'participant',
      });
    } catch (error) {
      reportCaughtError(error, {
        source: 'application/commerce/advisoryReservation.ts',
        operation: 'inviteAdvisorToAdvisoryThread',
      });
      return { error: 'Advisor could not be invited' };
    }
  }

  const next: AdvisoryThreadState = {
    confidentiality: ADVISORY_THREAD_CONFIDENTIALITY,
    founderInvitedAdvisor: true,
    hostRef: marker.state.hostRef,
  };
  await db.update(brainChatMessages).set({
    metadata: encodeAdvisoryThreadMarker(next, markerExtra(marker.metadata)),
  }).where(eq(brainChatMessages.id, marker.id));
  return next;
}
