/**
 * THE meeting access check — "may this person VIEW/JOIN this meeting".
 *
 * Extracted from `meetingRoutes` (it was a private closure over the request context) so
 * the media-room relay asks the identical question the REST routes do.
 *
 * Cross-tenant is already blocked (meeting rows are fetched by tenantId). Within the
 * tenant a caller may access a meeting when they are: a manager, the organizer, a listed
 * attendee, or — for a project meeting — a member of that project's team. A tenant-wide
 * meeting (no project) is open to any authenticated tenant member holding the link.
 */
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { meetings, meetingAttendees } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { TenantRole, hasMinRole } from '../../domain/shared/types';
import { loadProjectTeamMembers } from '../metrics/assigneeRecommender';

export interface MeetingCaller { tenantId: number; userId: string; role: TenantRole | string | undefined; }
type MeetingRow = typeof meetings.$inferSelect;
type AttendeeRow = typeof meetingAttendees.$inferSelect;

/** Pass `attendees` when the caller already loaded them; otherwise they are read here. */
export async function canAccessMeeting(
  db: Db,
  caller: MeetingCaller,
  meeting: MeetingRow,
  attendees?: AttendeeRow[],
): Promise<boolean> {
  const userId = caller.userId ?? '';
  if (hasMinRole(caller.role as TenantRole, TenantRole.MANAGER)) return true;
  if (meeting.createdBy === userId) return true;
  const listed = attendees
    ?? await db.select().from(meetingAttendees)
      .where(scopedToTenant(meetingAttendees, caller.tenantId, eq(meetingAttendees.meetingId, meeting.id)));
  if (listed.some((a) => a.memberRef === userId)) return true;
  if (meeting.projectId != null) {
    const members = await loadProjectTeamMembers(db, meeting.projectId, caller.tenantId);
    return members.some((m) => m.memberRef === userId);
  }
  return true; // tenant-wide meeting: any tenant member with the link
}

/** The meeting whose media room key this is, in the caller's tenant, or null. */
export async function loadMeetingByRoomKey(db: Db, tenantId: number, roomKey: string): Promise<MeetingRow | null> {
  const [row] = await db.select().from(meetings)
    .where(and(eq(meetings.roomKey, roomKey), eq(meetings.tenantId, tenantId)))
    .limit(1);
  return row ?? null;
}
