/**
 * THE canvas-session access check — "may this person do this to this board".
 *
 * ── WHY IT WAS EXTRACTED ─────────────────────────────────────────────────────────
 * It lived as two private closures inside `creationSessionRoutes`, which was correct
 * while that file was the only thing that answered the question. The sell-motion routes
 * need the identical answer (a call is summarized, a trust packet assembled and a trial
 * provisioned only by somebody who may edit the board), and there is exactly one
 * acceptable way to add a second caller: extract, and have the original read the extraction
 * too. A second copy of an authorization check is not a duplication that gets tidied up
 * later — it is the copy that keeps granting access after the original learns to refuse.
 *
 * The superadmin branch is the part that most needed one home. Platform superadmins
 * collaborate in associate-owned sales canvases ACROSS tenant boundaries, and they must
 * still be explicit board members — a rule that is one `innerJoin` away from being
 * "superadmins can open any board in the product", and that must therefore be written once.
 *
 * ── WHERE THE ROLE IS READ FROM ──────────────────────────────────────────────────
 * A board's members are kernel `memberships` rows on the board's registry object
 * (migration 1264, `sessionMembers.ts`). The gate reads only those.
 */

import { eq, type SQL } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { creationSessions, memberships, objects, users } from '../../infrastructure/database/schema';
import { acrossTenants, scopedToTenant } from '../../infrastructure/database/tenantScope';
import { getCacheVersion, getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { TenantRole } from '../../domain/shared/types';
import { SESSION_MEMBER_KIND, SESSION_OBJECT_KIND, sessionMembersVersionKey } from './sessionMembers';
import { SESSION_ROLE_RANK, isSessionRole, type SessionRole } from './sessionRoles';

// The vocabulary lives in `sessionRoles.ts`; re-exported because every caller has
// always imported it from the gate.
export { SESSION_ROLE_RANK, isSessionRole, type SessionRole };

/** How a caller wants the grant read. `fresh` skips the cache — see {@link grantReadFor}. */
export type GrantRead = { fresh?: boolean };

/**
 * The read a gate with this minimum needs. Anything that WRITES the board (editor and
 * above) reads the grant fresh: a cached grant can outlive a demotion or removal by up
 * to the cache TTL on another isolate, and that window must never cover a write.
 * Viewer / commenter reads take the cache.
 */
export function grantReadFor(minimum: SessionRole): GrantRead {
  return { fresh: SESSION_ROLE_RANK[minimum] >= SESSION_ROLE_RANK.editor };
}

export type SessionAccess = {
  session: typeof creationSessions.$inferSelect;
  role: string;
};

/**
 * One person's grant on one board: their board role, and the tenant the board is in
 * (which differs from the caller's only on the superadmin branch).
 */
export type SessionGrant = { role: SessionRole; sessionTenantId: number };

/** The membership predicates for one person on one board, in any tenant. */
function memberOfBoard(sessionId: string, userId: string): SQL[] {
  return [
    eq(objects.kind, SESSION_OBJECT_KIND),
    eq(objects.refId, sessionId),
    eq(memberships.memberKind, SESSION_MEMBER_KIND),
    eq(memberships.memberRef, userId),
    eq(memberships.state, 'active'),
  ];
}

/** A stored role the gate does not know grants NOTHING — a kernel membership written
 *  with the generic default `member` must never read as "at least a viewer". */
function toGrant(row: { role: string; sessionTenantId: number } | undefined): SessionGrant | null {
  return row && isSessionRole(row.role) ? { role: row.role, sessionTenantId: row.sessionTenantId } : null;
}

/** "Are you a member of a board in YOUR workspace" — the read that is cached. */
async function loadTenantGrant(db: Db, sessionId: string, tenantId: number, userId: string): Promise<SessionGrant | null> {
  const [row] = await db
    .select({ role: memberships.role, sessionTenantId: memberships.tenantId })
    .from(memberships)
    .innerJoin(objects, eq(objects.id, memberships.objectId))
    .where(scopedToTenant(memberships, tenantId, ...memberOfBoard(sessionId, userId)))
    .limit(1);
  return toGrant(row);
}

/**
 * "Are you a platform superadmin who has been added to a board in somebody else's."
 *
 * DECLARED, not forgotten. The whole point of this branch is that the board is in
 * ANOTHER tenant — an associate-owned sales canvas a platform superadmin was added to.
 * Two predicates still govern it and neither is optional: the caller is a superadmin,
 * AND they hold an explicit active membership on this exact board. Drop either one and
 * this becomes "superadmins can open any board in the product". Deliberately uncached:
 * a revoked superadmin flag must stop working on the next request.
 */
async function loadSuperadminGrant(db: Db, sessionId: string, userId: string): Promise<SessionGrant | null> {
  const [row] = await db
    .select({ role: memberships.role, sessionTenantId: memberships.tenantId })
    .from(memberships)
    .innerJoin(objects, eq(objects.id, memberships.objectId))
    .innerJoin(users, eq(users.id, userId))
    .where(acrossTenants(memberships, 'platform_admin', ...memberOfBoard(sessionId, userId), eq(users.isSuperadmin, true)))
    .limit(1);
  return toGrant(row);
}

/** Cache key for one person's in-tenant grant at one version of the board's roster. */
export const sessionGrantCacheKey = (tenantId: number, sessionId: string, userId: string, version: string) =>
  `canvas:grant:${tenantId}:${sessionId}:${userId}:v:${version}`;

/**
 * Resolve one person's grant on one board, or null — THE board-role gate.
 *
 * TWO reads and not one, because they answer different questions (see
 * {@link loadSuperadminGrant}); collapsing them into one query with an OR would make the
 * cross-tenant grant depend on a boolean buried in a join condition, which is precisely
 * the shape nobody re-reads before changing.
 *
 * With `env`, the in-tenant read is cached under the board's member version token,
 * which every membership writer bumps (`sessionMembersChanged`) — every canvas request
 * resolves this, so a READ costs a cache hit. Staleness is bounded, not zero: the token
 * has a 2 s L1 per isolate, and a grant entry lives at most 60 s in KV, so a removal
 * or demotion is seen by the isolate that made it immediately and by others within
 * seconds (or, if a token bump itself fails — reported loudly — within the 60 s TTL).
 * That window is acceptable for reads only: board WRITES pass `{ fresh: true }`
 * ({@link grantReadFor}) and never see a cached grant.
 */
export async function resolveSessionGrant(
  db: Db,
  sessionId: string,
  tenantId: number,
  userId: string,
  env?: Env,
  read: GrantRead = {},
): Promise<SessionGrant | null> {
  const load = () => loadTenantGrant(db, sessionId, tenantId, userId);
  let own: SessionGrant | null;
  if (env && !read.fresh) {
    const version = await getCacheVersion(env, sessionMembersVersionKey(sessionId), { l1TtlMs: 2_000 });
    own = await getOrSetCached(env, sessionGrantCacheKey(tenantId, sessionId, userId, version), load, {
      kvTtlSeconds: 60,
      l1TtlMs: 5_000,
    });
  } else {
    own = await load();
  }
  return own ?? loadSuperadminGrant(db, sessionId, userId);
}

/** The predicate that reads the board a grant was resolved for — tenant-scoped, or the
 *  declared superadmin cross-tenant read when the grant says the board is elsewhere. */
export function grantedSessionWhere(grant: SessionGrant, sessionId: string, tenantId: number): SQL {
  return grant.sessionTenantId === tenantId
    ? scopedToTenant(creationSessions, tenantId, eq(creationSessions.id, sessionId))
    : acrossTenants(
      creationSessions,
      'platform_admin',
      eq(creationSessions.id, sessionId),
      // The grant already proved superadmin + explicit membership on this board.
      eq(creationSessions.tenantId, grant.sessionTenantId),
    );
}

/**
 * Resolve one person's membership of one board, with the board row, or null.
 * Pass `env` on request paths so a read's grant is served from cache; a write passes
 * `grantReadFor(minimum)` so it is not.
 */
export async function resolveSessionAccess(
  db: Db,
  sessionId: string,
  tenantId: number,
  userId: string,
  env?: Env,
  read: GrantRead = {},
): Promise<SessionAccess | null> {
  const grant = await resolveSessionGrant(db, sessionId, tenantId, userId, env, read);
  if (!grant) return null;
  const [session] = await db
    .select()
    .from(creationSessions)
    .where(grantedSessionWhere(grant, sessionId, tenantId))
    .limit(1);
  return session ? { session, role: grant.role } : null;
}

/**
 * The WORKSPACE role a board role implies for somebody whose only reason to be in
 * the workspace is that board.
 *
 * Canvas reads are tenant-scoped, so sharing a board with a stranger has to seat
 * them in the workspace as well ({@link resolveSessionAccess} cannot resolve a
 * board for a non-member). That companion membership used to be granted as
 * `developer` regardless of the board role — so inviting somebody to LOOK at one
 * canvas handed them write access to every project, ticket and agent in the
 * workspace. The board role is the ceiling: a viewer or commenter gets a
 * workspace `viewer`, and a role that edits or runs the board gets `contributor`
 * (operator decision 2026-09-12) — NOT `developer`. The canvas write paths gate on
 * the BOARD role ({@link requireSessionRole}), so the edit grant already lives on
 * the board membership; the workspace seat only has to let the board resolve.
 * `contributor` ranks below `developer`, so every task, project, agent and run
 * gate (`>= developer`) keeps refusing a person shared one canvas.
 */
export function tenantRoleForSessionRole(role: SessionRole): TenantRole {
  return SESSION_ROLE_RANK[role] >= SESSION_ROLE_RANK.editor
    ? TenantRole.CONTRIBUTOR
    : TenantRole.VIEWER;
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
  env?: Env,
): Promise<SessionAccess | null> {
  const access = await resolveSessionAccess(db, sessionId, tenantId, userId, env, grantReadFor(minimum));
  if (!access) return null;
  return SESSION_ROLE_RANK[access.role as SessionRole] >= SESSION_ROLE_RANK[minimum] ? access : null;
}
