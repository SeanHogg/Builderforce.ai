/**
 * ceremonyMeeting — a ceremony's companion `meetings` row (0366).
 *
 * WHY THIS EXISTS. `meetings` (0292) and `ceremony_sessions` (0119) were two independent
 * models of the same event. `meetings.kind` already accepted 'standup'|'planning', and
 * `meeting_attendees` carried join/leave timestamps — so a team that scheduled a standup
 * meeting AND ran the ceremony produced two unrelated attendance records that disagreed
 * by construction, because joining the video call did not mark you present at the
 * ceremony.
 *
 * THE SPLIT, decided in 0366 and enforced here:
 *   • `ceremony_sessions` owns ATTENDANCE. It is the only side that resolves a verdict,
 *     journals it, and feeds the autonomy rules that can move someone's work.
 *   • `meetings` owns the CALENDAR ENTRY and the MEDIA ROOM.
 *
 * So every ceremony gets exactly one meeting, the FK points ceremony → meeting, and
 * `POST /meetings/:id/join` writes through to `recordCeremonyPresence` — the same single
 * writer the round-table heartbeat uses. There is no second attendance path to drift.
 *
 * It also retires an ad-hoc key. The round table synthesised its own relay room name
 * (`ceremony-<projectId>`, never persisted, per-PROJECT so two consecutive standups
 * shared one room) while meetings used a stored per-meeting `room_key`. Both now resolve
 * ONE room from ONE column, and the ceremony inherits what the meetings join path
 * already provides: TURN credentials and the calendar mirror.
 *
 * Best-effort throughout: a ceremony whose meeting could not be created is still a valid
 * ceremony that records attendance. The shell is an affordance, not a precondition.
 */

import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { ceremonyParticipants, ceremonySessions, meetings, meetingAttendees } from '../../infrastructure/database/schema';

/** Human-readable meeting titles per ceremony kind. Mirrors meetingRoutes' defaults. */
const TITLES: Record<string, string> = { standup: 'Daily Standup', planning: 'Planning Session' };

export interface CeremonyMeetingRef {
  meetingId: string;
  /** The media relay key — clients join `media:<roomKey>` via the meetings room socket. */
  roomKey: string;
}

/**
 * Ensure a session has its companion meeting, returning the ref either way.
 *
 * Idempotent: an already-linked session short-circuits without a write, so this is safe
 * to call from the scheduled sweep, the manual start route and a reconnecting client.
 * The `roomKey` is DERIVED from the session id rather than random — the room is the
 * ceremony, so the two cannot get out of step, and a client that already knows the
 * session can predict it.
 */
export async function ensureCeremonyMeeting(
  db: Db,
  session: Pick<
    typeof ceremonySessions.$inferSelect,
    'id' | 'tenantId' | 'segmentId' | 'projectId' | 'kind' | 'facilitatorId' | 'startedAt' | 'meetingId'
  >,
): Promise<CeremonyMeetingRef | null> {
  if (session.meetingId) {
    const [existing] = await db
      .select({ id: meetings.id, roomKey: meetings.roomKey })
      .from(meetings)
      .where(eq(meetings.id, session.meetingId))
      .limit(1);
    if (existing) return { meetingId: existing.id, roomKey: existing.roomKey };
    // The meeting was deleted (the FK is ON DELETE SET NULL by design — losing the shell
    // must never delete the attendance record). Fall through and mint a fresh one.
  }

  const roomKey = `ceremony-${session.id}`.slice(0, 64);
  const [meeting] = await db
    .insert(meetings)
    .values({
      tenantId: session.tenantId,
      segmentId: session.segmentId ?? undefined,
      projectId: session.projectId,
      kind: session.kind,
      title: TITLES[session.kind] ?? 'Ceremony',
      // 'live' rather than 'scheduled': the ceremony session it shadows already exists
      // and is open, so there is no future instant left to schedule.
      status: 'live',
      createdBy: session.facilitatorId,
      roomKey,
      videoEnabled: true,
      startedAt: session.startedAt,
      updatedAt: new Date(),
    })
    .returning({ id: meetings.id, roomKey: meetings.roomKey });
  if (!meeting) return null;

  // Seed the meeting roster from the ceremony's, so the two surfaces show one guest list.
  // Attendance verdicts stay on the ceremony side — these rows carry only join/leave.
  const roster = await db
    .select({
      memberKind: ceremonyParticipants.memberKind,
      memberRef: ceremonyParticipants.memberRef,
      memberName: ceremonyParticipants.memberName,
    })
    .from(ceremonyParticipants)
    .where(eq(ceremonyParticipants.sessionId, session.id));

  if (roster.length > 0) {
    await db.insert(meetingAttendees).values(
      roster.map((p) => ({
        tenantId: session.tenantId,
        meetingId: meeting.id,
        memberKind: p.memberKind,
        memberRef: p.memberRef,
        memberName: p.memberName,
        role: p.memberRef === session.facilitatorId ? 'host' : 'attendee',
        response: 'invited',
      })),
    );
  }

  await db
    .update(ceremonySessions)
    .set({ meetingId: meeting.id, updatedAt: new Date() })
    .where(eq(ceremonySessions.id, session.id));

  return { meetingId: meeting.id, roomKey: meeting.roomKey };
}

/**
 * End a ceremony's companion meeting when the ceremony concludes.
 *
 * Without this the shell sits `status='live'` forever and every future "upcoming
 * meetings" list shows yesterday's standup as still running — the meetings list filters
 * on exactly that status.
 */
export async function endCeremonyMeeting(db: Db, meetingId: string | null, at: Date): Promise<void> {
  if (!meetingId) return;
  await db
    .update(meetings)
    .set({ status: 'ended', endedAt: at, updatedAt: at })
    .where(and(eq(meetings.id, meetingId), eq(meetings.status, 'live')));
}

/**
 * The ACTIVE ceremony session a meeting is the shell for, or null.
 *
 * Backs the write-through in `POST /meetings/:id/join`: joining a standup's video room is
 * attending that standup. Only an active session is returned — a late joiner to an ended
 * call must not reopen a concluded attendance record.
 */
export async function findActiveCeremonyForMeeting(
  db: Db,
  tenantId: number,
  meetingId: string,
): Promise<typeof ceremonySessions.$inferSelect | null> {
  const [session] = await db
    .select()
    .from(ceremonySessions)
    .where(and(
      eq(ceremonySessions.meetingId, meetingId),
      eq(ceremonySessions.tenantId, tenantId),
      eq(ceremonySessions.status, 'active'),
    ))
    .limit(1);
  return session ?? null;
}
