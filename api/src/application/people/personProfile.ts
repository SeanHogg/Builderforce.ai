/**
 * personProfile - ONE person, as a teammate sees them.
 *
 * The board hovercard already reads personality through the tenant's cached
 * assignee-profile map (`kanban/assigneeProfiles`); this is the page-sized read for a
 * single person: who they are, their role in THIS workspace, their personality
 * (parsed the same way, `parseJsonOr`) and a summary of the work assigned to them.
 *
 * Tenant-scoped by construction: the person is found through `tenant_members`, so a
 * user the caller shares no workspace with is indistinguishable from one who does not
 * exist - the route answers 404 for both and never confirms an id.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { tasks, tenantMembers, users } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { parseJsonOr } from '../../domain/shared/json';
import { NON_TERMINAL_TASK_STATUSES } from '../../domain/shared/types';

/** "Recent" = tickets touched in this window. */
export const RECENT_WORK_DAYS = 30;

export interface PersonProfile {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  /** The person's role in the caller's workspace (one membership per tenant). */
  roles: string[];
  /** Parsed psychometric profile; null when none is on file. */
  psychometric: unknown;
  work: {
    /** Tickets assigned to them still workable (not done, cancelled, archived), in this workspace. */
    openAssigned: number;
    /** Assigned tickets updated within {@link RECENT_WORK_DAYS}. */
    recentAssigned: number;
    /** Assigned tickets they have finished. */
    completed: number;
  };
}

export async function readPersonProfile(db: Db, tenantId: number, userId: string): Promise<PersonProfile | null> {
  const [person] = await db
    .select({
      id: users.id, displayName: users.displayName, username: users.username, email: users.email,
      avatarUrl: users.avatarUrl, psychometric: users.psychometric, role: tenantMembers.role,
    })
    .from(tenantMembers)
    .innerJoin(users, eq(users.id, tenantMembers.userId))
    .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, userId), eq(tenantMembers.isActive, true)))
    .limit(1);
  if (!person) return null;

  const since = new Date(Date.now() - RECENT_WORK_DAYS * 86_400_000);
  const [counts] = await db
    .select({
      open: sql<number>`count(*) filter (where ${tasks.completedAt} is null and ${inArray(tasks.status, NON_TERMINAL_TASK_STATUSES)})`,
      recent: sql<number>`count(*) filter (where ${tasks.updatedAt} >= ${since})`,
      done: sql<number>`count(*) filter (where ${tasks.completedAt} is not null)`,
    })
    .from(tasks)
    .where(scopedToTenant(tasks, tenantId, eq(tasks.assignedUserId, userId)));

  return {
    userId: person.id,
    displayName: person.displayName?.trim() || person.username?.trim() || person.email,
    avatarUrl: person.avatarUrl,
    roles: [person.role],
    psychometric: parseJsonOr<unknown>(person.psychometric, null),
    work: {
      openAssigned: Number(counts?.open ?? 0),
      recentAssigned: Number(counts?.recent ?? 0),
      completed: Number(counts?.done ?? 0),
    },
  };
}
