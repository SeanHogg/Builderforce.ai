/**
 * Who may replace a meeting's minutes with text their own device wrote (PRD 42 principle 6).
 *
 * A client-supplied summary is the caller's OWN content only. Minutes are shared with every
 * attendee and posted into the team chat, so an attendee who is not the organizer must not
 * overwrite them with text the server never produced. The caller qualifies when they
 * organized the meeting, or are its only human attendee. Anyone else is not refused (the
 * client cannot know): the route simply ignores their result and runs the server path.
 */
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { meetingAttendees } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';

/**
 * When `createdBy` is null (no recorded organizer), the sole human attendee may author the
 * minutes: it is their own meeting content, so that is intended.
 */
export async function mayAuthorMeetingMinutes(
  db: Db,
  meeting: { id: string; tenantId: number; createdBy?: string | null },
  userId: string | null | undefined,
): Promise<boolean> {
  if (!userId) return false;
  if (meeting.createdBy === userId) return true;
  const humans = await db
    .select({ memberRef: meetingAttendees.memberRef })
    .from(meetingAttendees)
    .where(scopedToTenant(meetingAttendees, meeting.tenantId, and(eq(meetingAttendees.meetingId, meeting.id), eq(meetingAttendees.memberKind, 'human'))));
  return humans.length === 1 && humans[0]!.memberRef === userId;
}
