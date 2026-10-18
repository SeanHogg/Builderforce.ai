/**
 * A1 — a confirmed 1:1 advisory reservation plans a meeting, a calendar event
 * for both attendees, and a restricted Brain thread that is absent from
 * aiContext until the founder invites the advisor.
 *
 * Admission is the canvas contract's own `boundaryAdmits`. The kind default for
 * `advisory` is internal (it is not in RESTRICTED_BY_DEFAULT_KINDS); the thread
 * must not inherit that, or it would be in aiContext the moment it was created.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  boundaryAdmits,
  defaultConfidentialityForKind,
  type CanvasBoundary,
} from '@builderforce/creation-canvas-contract';
import {
  ADVISORY_MEETING_KIND,
  ADVISORY_THREAD_CONFIDENTIALITY,
  advisoryThreadAdmitted,
  advisoryThreadConfidentiality,
  advisoryThreadInAiContext,
  calendarAttendeeEmails,
  encodeAdvisoryThreadMarker,
  planAdvisorySession,
  readAdvisoryThreadState,
  sealedAdvisoryThread,
  type ConfirmedReservation,
} from './advisoryReservation';

const read = (name: string) => readFileSync(resolve(__dirname, name), 'utf8').split(String.fromCharCode(13)).join('');
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');

const fn = (src: string, name: string): string => {
  const match = new RegExp(`(?:export )?(?:async )?function ${name}\\b`).exec(src);
  expect(match?.index, `${name} should exist`).toBeGreaterThan(-1);
  const rest = src.slice(match!.index);
  const next = rest.slice(1).search(/\n(?:export |async function |function )/);
  return next === -1 ? rest : rest.slice(0, next + 1);
};

const CLOSED: CanvasBoundary[] = ['export', 'share', 'guest', 'publicMedia'];

function reservation(overrides: Partial<ConfirmedReservation> = {}): ConfirmedReservation {
  return {
    id: 42,
    tenantId: 7,
    serviceId: 3,
    hostRef: 'advisor-1',
    bookerRef: 'founder-1',
    bookerEmail: 'founder@example.com',
    startsAt: new Date('2026-11-01T15:00:00.000Z'),
    endsAt: new Date('2026-11-01T15:30:00.000Z'),
    status: 'confirmed',
    meetingUrl: null,
    ...overrides,
  };
}

describe('restricted advisory thread is absent from aiContext until invited', () => {
  it('does not inherit the kind default, which would admit aiContext', () => {
    expect(defaultConfidentialityForKind('advisory')).toBe('internal');
    expect(boundaryAdmits(defaultConfidentialityForKind('advisory'), 'aiContext')).toBe(true);
    expect(advisoryThreadConfidentiality(undefined)).toBe('restricted');
    expect(advisoryThreadConfidentiality('public')).toBe('restricted');
    expect(advisoryThreadConfidentiality('internal')).toBe('restricted');
    expect(advisoryThreadConfidentiality(defaultConfidentialityForKind('advisory'))).toBe(ADVISORY_THREAD_CONFIDENTIALITY);
  });

  it('stays out of aiContext, and out of every other boundary, until the founder invites', () => {
    const sealed = sealedAdvisoryThread('advisor-1');
    expect(advisoryThreadInAiContext(sealed)).toBe(false);
    expect(boundaryAdmits('restricted', 'aiContext')).toBe(false);
    expect(advisoryThreadAdmitted(sealed, 'aiContext')).toBe(false);
    for (const boundary of CLOSED) {
      expect(advisoryThreadAdmitted(sealed, boundary)).toBe(false);
    }
  });

  it('admits aiContext only after an explicit invite, and still refuses share, guest, export and publicMedia', () => {
    const invited = { ...sealedAdvisoryThread('advisor-1'), founderInvitedAdvisor: true };
    expect(advisoryThreadInAiContext(invited)).toBe(true);
    expect(advisoryThreadAdmitted(invited, 'aiContext')).toBe(boundaryAdmits('internal', 'aiContext'));
    for (const boundary of CLOSED) {
      expect(advisoryThreadAdmitted(invited, boundary)).toBe(false);
    }
  });

  it('coerces a forged public label back to restricted and does not treat a non-marker as a thread', () => {
    const forged = encodeAdvisoryThreadMarker(
      { confidentiality: 'public', founderInvitedAdvisor: false, hostRef: 'advisor-1' },
      { reservationId: 42, tenantId: 7 },
    );
    const read = readAdvisoryThreadState(forged);
    expect(read?.confidentiality).toBe('restricted');
    expect(read?.founderInvitedAdvisor).toBe(false);
    expect(read?.hostRef).toBe('advisor-1');
    expect(advisoryThreadInAiContext(read!)).toBe(false);
    expect(advisoryThreadAdmitted(read!, 'share')).toBe(false);
    expect(readAdvisoryThreadState('{"confidentiality":"public","founderInvitedAdvisor":true}')).toBeNull();
    expect(readAdvisoryThreadState('not-json')).toBeNull();
  });
});

describe('a confirmed 1:1 plans the three records in the service tenant', () => {
  it('plans an advisory meeting, a calendar event for both attendees, and a sealed thread', () => {
    const plan = planAdvisorySession({
      reservation: reservation(),
      service: { mode: 'one_to_one', name: 'Office hours' },
      hostEmail: 'advisor@example.com',
      bookerAccountEmail: 'founder@example.com',
      hostIsUser: true,
      bookerIsUser: true,
    });
    expect(plan).not.toBeNull();
    expect(plan!.tenantId).toBe(7);
    expect(plan!.meeting.kind).toBe(ADVISORY_MEETING_KIND);
    expect(plan!.meeting.kind).toBe('advisory');
    expect(plan!.meeting.createdBy).toBe('advisor-1');
    expect(plan!.meeting.description).toBe('advisory-reservation:42');
    expect(plan!.calendar.organizerId).toBe('advisor-1');
    expect(plan!.calendar.attendeeEmails).toEqual(['advisor@example.com', 'founder@example.com']);
    expect(plan!.calendar.startISO).toBe('2026-11-01T15:00:00.000Z');
    expect(plan!.calendar.endISO).toBe('2026-11-01T15:30:00.000Z');
    expect(plan!.thread.confidentiality).toBe('restricted');
    expect(plan!.thread.founderInvitedAdvisor).toBe(false);
    expect(plan!.thread.visibility).toBe('locked');
    expect(plan!.thread.memoryEnabled).toBe(false);
    expect(plan!.thread.advisorIsMember).toBe(false);
    expect(plan!.thread.ownerUserId).toBe('founder-1');
    expect(plan!.thread.hostRef).toBe('advisor-1');
    expect(advisoryThreadInAiContext(plan!.thread)).toBe(false);
  });

  it('keeps the thread in the service tenant when the founder is the owner', () => {
    const plan = planAdvisorySession({
      reservation: reservation({ tenantId: 11, bookerRef: 'founder-9' }),
      service: { mode: 'one_to_one', name: 'Intro' },
      bookerIsUser: true,
      hostIsUser: true,
    });
    expect(plan!.tenantId).toBe(11);
    expect(plan!.thread.ownerUserId).toBe('founder-9');
  });

  it('does not plan a group, round-robin, cancelled, or hostless reservation', () => {
    const service = { mode: 'one_to_one', name: 'Intro' };
    expect(planAdvisorySession({ reservation: reservation(), service: { mode: 'one_to_many', name: 'Webinar' } })).toBeNull();
    expect(planAdvisorySession({ reservation: reservation(), service: { mode: 'round_robin', name: 'Pool' } })).toBeNull();
    expect(planAdvisorySession({ reservation: reservation({ status: 'cancelled' }), service })).toBeNull();
    expect(planAdvisorySession({ reservation: reservation({ hostRef: null }), service })).toBeNull();
    expect(planAdvisorySession({ reservation: reservation({ hostRef: '  ' }), service })).toBeNull();
  });

  it('puts both attendee emails on the calendar input, and dedupes a shared address', () => {
    expect(calendarAttendeeEmails('Advisor@Example.com', 'founder@example.com')).toEqual([
      'Advisor@Example.com',
      'founder@example.com',
    ]);
    expect(calendarAttendeeEmails('same@example.com', 'same@example.com')).toEqual(['same@example.com']);
    expect(calendarAttendeeEmails(null, 'founder@example.com')).toEqual(['founder@example.com']);
  });
});

describe('confirm is wired only from the founder booking path', () => {
  const bookings = stripComments(read('bookings.ts'));
  const advisory = stripComments(read('advisoryReservation.ts'));

  it('calls the provisioner from reserveForHost and not from the generic reserve path', () => {
    expect(fn(bookings, 'reserveForHost')).toContain('provisionConfirmedAdvisory');
    expect(fn(bookings, 'reserve')).not.toContain('provisionConfirmedAdvisory');
    expect(fn(bookings, 'setReservationStatus')).not.toContain('provisionConfirmedAdvisory');
  });

  it('writes the three records through the existing meeting, calendar and Brain paths', () => {
    const provision = fn(advisory, 'provisionAdvisorySession');
    expect(provision).toContain('kind: plan.meeting.kind');
    expect(provision).toContain('pushAdvisoryCalendar');
    expect(provision).toContain('insertAdvisoryThread');
    expect(provision).toContain('plan.tenantId');
    expect(provision).not.toContain('getOrCreateTeamChat');
    expect(provision).not.toContain('chatMembers');

    const calendar = fn(advisory, 'pushAdvisoryCalendar');
    expect(calendar).toContain('pushMeetingEvent');
    expect(calendar).toContain('attendeeEmails: plan.calendar.attendeeEmails');
    expect(calendar).toContain('plan.tenantId');

    const thread = fn(advisory, 'insertAdvisoryThread');
    expect(thread).toContain('insert(brainChats)');
    expect(thread).toContain("visibility: 'locked'");
    expect(thread).toContain('memoryEnabled: false');
    expect(thread).toContain('tenantId: plan.tenantId');
    expect(thread).not.toContain('chatMembers');

    expect(advisory).toContain("kind: ADVISORY_MEETING_KIND");
    expect(advisory).not.toContain('getOrCreateTeamChat');
    expect(advisory).not.toContain("kind: 'advisor'");
  });

  it('opens aiContext only from the explicit founder invite, in the same tenant', () => {
    const invite = fn(advisory, 'inviteAdvisorToAdvisoryThread');
    expect(invite).toContain('founderInvitedAdvisor: true');
    expect(invite).toContain('scopedToTenant(brainChats, tenantId');
    expect(invite).toContain('insert(chatMembers)');
    expect(invite).not.toContain('insert(brainChats)');
    expect(invite).not.toContain("confidentiality: 'internal'");
    expect(invite).not.toContain("confidentiality: 'public'");
  });
});
