/**
 * A1 — the PURE plan for a confirmed 1:1 advisory reservation: which meeting,
 * calendar event and restricted Brain thread it becomes, in the SERVICE tenant
 * (the advisor's workspace), never the booker's. No I/O here — the writes are
 * `advisoryProvisioning.ts`, the thread's admission/invite is
 * `advisoryReservation.ts`.
 *
 * `advisory` is not in `RESTRICTED_BY_DEFAULT_KINDS`, so the kind default would
 * be `internal` and would admit aiContext; the product contract is restricted,
 * so the plan sets it explicitly.
 */
import {
  ADVISORY_THREAD_CONFIDENTIALITY,
  type AdvisoryThreadState,
  type ConfidentialityLevel,
} from '@builderforce/creation-canvas-contract';
import { resolveAppBaseUrl } from '../../env';

export const ADVISORY_MEETING_KIND = 'advisory' as const;

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
  /** Nullable: `booking_services` is `onDelete: set null`, so a confirmed row can outlive its service. */
  serviceId: number | null;
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
    reservationId: number;
  };
  calendar: {
    organizerId: string;
    title: string;
    startISO: string;
    endISO: string;
    attendeeEmails: string[];
  };
  thread: AdvisoryThreadState & {
    /** The FOUNDER (booker) — the only person who may invite the advisor. Null when
     *  the booker has no user account: the thread is then NOT provisioned (never
     *  owned by the advisor, which would let them admit their own thread). */
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
  // The founder owns the thread. No fallback to the advisor: an advisor-owned
  // thread would pass the "only the founder can invite" check for the advisor.
  const ownerUserId = input.bookerIsUser && reservation.bookerRef ? reservation.bookerRef : null;

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
      reservationId: reservation.id,
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

export function meetingIdFromJoinUrl(url: string | null): string | null {
  if (!url) return null;
  const match = url.match(/[?&]join=([0-9a-fA-F-]{36})/);
  return match?.[1] ?? null;
}

export function advisoryJoinUrl(env: { APP_URL?: string }, meetingId: string): string {
  return `${resolveAppBaseUrl(env)}/meetings?join=${meetingId}`;
}
