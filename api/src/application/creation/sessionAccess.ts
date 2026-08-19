/**
 * THE canvas-session access check — "may this person do this to this board".
 *
 * ── WHY IT WAS EXTRACTED ─────────────────────────────────────────────────────────
 * It lived as two private closures inside `creationSessionRouteService`, which was correct
 * while that file was the only thing that answered the question. The sell-motion routes
 * need the identical answer (a call is summarized, a trust packet assembled and a trial
 * provisioned only by somebody who may edit the board), and there is exactly one
 * acceptable way to add a second caller: extract, and have the original read the extraction
 * too. A second copy of an authorization check is not a duplication that gets tidied up
 * later — it is the copy that keeps granting access after the original learns to refuse.
 *
 * The superadmin branch is the part that most needed one home. Platform superadmins
 * collaborate in associate-owned sales canvases ACROSS tenant boundaries, and they must
 * still be explicit session members — a rule that is one `innerJoin` away from being
 * "superadmins can open any board in the product", and that must therefore be written once.
 */

import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { creationSessionMembers, creationSessions, users } from '../../infrastructure/database/schema';
import { acrossTenants, scopedToTenant } from '../../infrastructure/database/tenantScope';

export type SessionRole = 'viewer' | 'commenter' | 'editor' | 'runner' | 'owner';

/** Ordered, so "at least an editor" is a comparison rather than a set membership test. */
export const SESSION_ROLE_RANK: Record<SessionRole, number> = {
  viewer: 0, commenter: 1, editor: 2, runner: 3, owner: 4,
};

export type SessionAccess = {
  session: typeof creationSessions.$inferSelect;
  role: string;
};

/**
 * Resolve one person's membership of one board, or null.
 *
 * TWO reads and not one, because they answer different questions: the first is "are you a
 * member of a board in YOUR workspace", the second is "are you a platform superadmin who
 * has been added to a board in somebody else's". Collapsing them into one query with an OR
 * would make the cross-tenant grant depend on a boolean buried in a join condition, which
 * is precisely the shape nobody re-reads before changing.
 */
export async function resolveSessionAccess(
  db: Db,
  sessionId: string,
  tenantId: number,
  userId: string,
): Promise<SessionAccess | null> {
  const [row] = await db
    .select({ session: creationSessions, role: creationSessionMembers.role })
    .from(creationSessions)
    .innerJoin(creationSessionMembers, and(
      eq(creationSessionMembers.sessionId, creationSessions.id),
      eq(creationSessionMembers.userId, userId),
    ))
    .where(scopedToTenant(creationSessions, tenantId, eq(creationSessions.id, sessionId)))
    .limit(1);
  if (row) return row;

  // Platform superadmins collaborate in associate-owned sales canvases across tenant
  // boundaries. They must still be explicit session members; this does not grant blanket
  // access to every canvas.
  const [adminMember] = await db
    .select({ session: creationSessions, role: creationSessionMembers.role })
    .from(creationSessions)
    .innerJoin(creationSessionMembers, and(
      eq(creationSessionMembers.sessionId, creationSessions.id),
      eq(creationSessionMembers.userId, userId),
    ))
    .innerJoin(users, eq(users.id, userId))
    // DECLARED, not forgotten. The whole point of this branch is that the board is in
    // ANOTHER tenant — an associate-owned sales canvas a platform superadmin was added to.
    // Two predicates still govern it and neither is optional: the caller is a superadmin,
    // AND they hold an explicit `creation_session_members` row on this exact board. Drop
    // either one and this becomes "superadmins can open any board in the product".
    .where(acrossTenants(
      creationSessions,
      'platform_admin',
      eq(creationSessions.id, sessionId),
      eq(users.isSuperadmin, true),
    ))
    .limit(1);
  return adminMember ?? null;
}

/** The same resolution, with a minimum role applied. Null means "no, and do not say why" —
 *  the caller answers 404 for both "no such board" and "not yours", so an id cannot be
 *  probed for existence. */
export async function requireSessionRole(
  db: Db,
  sessionId: string,
  tenantId: number,
  userId: string,
  minimum: SessionRole,
): Promise<SessionAccess | null> {
  const access = await resolveSessionAccess(db, sessionId, tenantId, userId);
  if (!access) return null;
  return SESSION_ROLE_RANK[access.role as SessionRole] >= SESSION_ROLE_RANK[minimum] ? access : null;
}
