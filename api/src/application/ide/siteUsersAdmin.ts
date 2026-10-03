/**
 * The owner's view of a generated app's END USERS (`site_users`): who signed
 * up, and the two levers an owner needs — suspend someone, or remove them.
 *
 * `siteAuth.ts` owns the sign-in flow and already refuses any user whose
 * `status` is not `active`; this module is the one writer of that column.
 * Suspending also ends every live session, so the change takes effect on the
 * user's next request rather than when their 30-day cookie runs out.
 *
 * Uncached by design: an owner's admin list must reflect the suspension they
 * just made, and it is read by one person, a page at a time.
 */

import { and, desc, eq, lt } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { siteUsers, siteUserSessions } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { appsDatabaseOf } from './appsDatabase';

export const SITE_USER_STATUSES = ['active', 'suspended'] as const;
export type SiteUserStatus = (typeof SITE_USER_STATUSES)[number];

export interface SiteUserView {
  id: number;
  email: string;
  displayName: string | null;
  status: string;
  lastSeenAt: Date | null;
  createdAt: Date;
}

const PAGE_MAX = 200;

/** Newest first, a page at a time (`beforeId` is the last id of the previous page). */
export async function listSiteUsers(
  db: Db,
  tenantId: number,
  siteId: number,
  limit = 50,
  beforeId?: number,
): Promise<SiteUserView[]> {
  const bounded = Math.min(Math.max(1, Math.trunc(limit)), PAGE_MAX);
  return appsDatabaseOf(db)
    .select({
      id: siteUsers.id,
      email: siteUsers.email,
      displayName: siteUsers.displayName,
      status: siteUsers.status,
      lastSeenAt: siteUsers.lastSeenAt,
      createdAt: siteUsers.createdAt,
    })
    .from(siteUsers)
    .where(scopedToTenant(
      siteUsers,
      tenantId,
      eq(siteUsers.siteId, siteId),
      beforeId && beforeId > 0 ? lt(siteUsers.id, beforeId) : undefined,
    ))
    .orderBy(desc(siteUsers.id))
    .limit(bounded);
}

/** Suspend or reinstate. Suspending ends the user's sessions too. Null when the user is not on this site. */
export async function setSiteUserStatus(
  db: Db,
  tenantId: number,
  siteId: number,
  userId: number,
  status: SiteUserStatus,
): Promise<SiteUserView | null> {
  const apps = appsDatabaseOf(db);
  const [row] = await apps
    .update(siteUsers)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(siteUsers.id, userId), eq(siteUsers.siteId, siteId), eq(siteUsers.tenantId, tenantId)))
    .returning({
      id: siteUsers.id,
      email: siteUsers.email,
      displayName: siteUsers.displayName,
      status: siteUsers.status,
      lastSeenAt: siteUsers.lastSeenAt,
      createdAt: siteUsers.createdAt,
    });
  if (!row) return null;
  if (status !== 'active') {
    await apps
      .delete(siteUserSessions)
      .where(scopedToTenant(siteUserSessions, tenantId, eq(siteUserSessions.siteUserId, userId)));
  }
  return row;
}

/**
 * Remove an end user. Their sessions and subscriptions go with them (cascade);
 * rows they wrote stay, with the owner link cleared (`set null`), because the
 * submissions belong to the app owner, not to the account that made them.
 */
export async function deleteSiteUser(db: Db, tenantId: number, siteId: number, userId: number): Promise<boolean> {
  const deleted = await appsDatabaseOf(db)
    .delete(siteUsers)
    .where(and(eq(siteUsers.id, userId), eq(siteUsers.siteId, siteId), eq(siteUsers.tenantId, tenantId)))
    .returning({ id: siteUsers.id });
  return deleted.length > 0;
}
