/**
 * The SQL that says "this person is on this board" — predicates, projections and
 * correlated subqueries over kernel `memberships` on a board's registry object
 * (migration 1264). Read-only building blocks; the store that writes members, and
 * the cache around the gate, are `sessionMembers.ts`, which re-exports all of this so
 * callers have one import surface.
 *
 * The four facts every board-member read must spell identically — the object kind,
 * the `ref_id` ⇄ session id cast, `member_kind = 'user'`, `state = 'active'` — are
 * written here once. A reader that went around this module could forget `state` and
 * resurrect somebody who was removed.
 */

import { and, eq, sql, type SQL } from 'drizzle-orm';
import { creationSessions, memberships, objects } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { SESSION_ROLE_RANK } from './sessionRoles';

/** The registry kind of a board. One spelling for the registry write and every join. */
export const SESSION_OBJECT_KIND = 'creation_session';
/** A board member is a person; agents reach a board through dispatch, not membership. */
export const SESSION_MEMBER_KIND = 'user';

/** The two fields of a board that address its members. */
export type SessionKey = { id: string; tenantId: number };

/** The board's registry id as a scalar subquery — so a writer can address a member
 *  row without a prior read, and the statement stays batchable. */
export function sessionObjectIdSql(session: SessionKey): SQL {
  return sql`(SELECT ${objects.id} FROM ${objects} WHERE ${objects.tenantId} = ${session.tenantId} AND ${objects.kind} = ${SESSION_OBJECT_KIND} AND ${objects.refId} = ${session.id})`;
}

/** `objects` ⋈ `memberships`: the board's ACTIVE members. For a roster read that starts
 *  FROM the board's registry row (`listSessionRoster`). */
export function sessionMemberOn(): SQL {
  return and(
    eq(memberships.objectId, objects.id),
    eq(memberships.memberKind, SESSION_MEMBER_KIND),
    eq(memberships.state, 'active'),
  )!;
}

/** The member-row columns the canvas reads, under the names it always used. */
export const sessionMemberColumns = {
  userId: memberships.memberRef,
  role: memberships.role,
  joinedAt: memberships.joinedAt,
  pinned: sql<boolean>`coalesce((${memberships.metadata} ->> 'pinned')::boolean, false)`,
  watchState: sql<string>`coalesce(${memberships.metadata} ->> 'watchState', 'mentions')`,
  invitedBy: sql<string | null>`${memberships.metadata} ->> 'invitedBy'`,
};

/** Every member row of one board (any state), or one person's. Tenant-scoped on the
 *  membership itself, so a board id from another workspace addresses nothing. The
 *  tenant is the first argument so every call site names it (`check:tenant-scope`). */
function sessionMemberWhere(tenantId: number, sessionId: string, userId?: string): SQL {
  return scopedToTenant(
    memberships,
    tenantId,
    eq(memberships.objectId, sessionObjectIdSql({ id: sessionId, tenantId })),
    eq(memberships.memberKind, SESSION_MEMBER_KIND),
    userId === undefined ? undefined : eq(memberships.memberRef, userId),
  );
}

/** {@link sessionMemberWhere}, active rows only — what "is a member" means. */
export function activeSessionMemberWhere(tenantId: number, sessionId: string, userId?: string): SQL {
  return and(sessionMemberWhere(tenantId, sessionId, userId), eq(memberships.state, 'active'))!;
}

/**
 * A correlated subquery over the active members of the board in the SURROUNDING
 * `creation_sessions` row (or of an aliased one, for raw SQL). `select` is raw SQL
 * over the aliases `bm` (membership) and `bo` (registry object).
 */
function boardMembershipSubquery(
  select: SQL,
  where: SQL,
  board: { id: SQL; tenantId: SQL } = { id: sql`${creationSessions.id}`, tenantId: sql`${creationSessions.tenantId}` },
): SQL {
  return sql`(
    SELECT ${select} FROM ${memberships} bm
    JOIN ${objects} bo ON bo.id = bm.object_id
    WHERE bo.tenant_id = ${board.tenantId}
      AND bo.kind = ${SESSION_OBJECT_KIND}
      AND bo.ref_id = ${board.id}::text
      AND bm.member_kind = ${SESSION_MEMBER_KIND}
      AND bm.state = 'active'
      ${where})`;
}

/**
 * THE "boards this person is on" helper — every list, search and lookup that starts
 * from `creation_sessions` and must only see the caller's boards uses it, so the
 * membership rule has one spelling. `isMember` goes in the WHERE; `role` and `pinned`
 * are the caller's own membership facts, as select fields. `roles` narrows `isMember`
 * to those board roles (the IDE write gate's "editor or above").
 */
export function boardsOfMember(userId: string, opts: { roles?: readonly string[] } = {}) {
  const mine = sql`AND bm.member_ref = ${userId}`;
  const roleFilter = opts.roles?.length
    ? sql` AND bm.role IN (${sql.join(opts.roles.map((role) => sql`${role}`), sql`, `)})`
    : sql``;
  return {
    isMember: sql`EXISTS ${boardMembershipSubquery(sql`1`, sql`${mine}${roleFilter}`)}`,
    role: sql<string>`${boardMembershipSubquery(sql.raw('bm.role'), sql`${mine} LIMIT 1`)}`,
    pinned: sql<boolean>`coalesce(${boardMembershipSubquery(sql.raw(`(bm.metadata ->> 'pinned')::boolean`), sql`${mine} LIMIT 1`)}, false)`,
  };
}

/**
 * SQL: the active member count of a board. Defaults to the surrounding
 * `creation_sessions` row; a raw-SQL caller that aliases the table passes its own id /
 * tenant expressions (e.g. `sql.raw('s.id')`).
 */
export function sessionMemberCountSql(
  sessionId: SQL = sql`${creationSessions.id}`,
  tenantId: SQL = sql`${creationSessions.tenantId}`,
): SQL<number> {
  return sql<number>`${boardMembershipSubquery(sql.raw('COUNT(*)::int'), sql``, { id: sessionId, tenantId })}`;
}

/** SQL: EXISTS an active member of the surrounding board whose display name matches. */
export function sessionHasMemberNamedSql(pattern: string): SQL {
  return sql`EXISTS ${boardMembershipSubquery(
    sql`1`,
    sql`AND EXISTS (SELECT 1 FROM users named_user WHERE named_user.id = bm.member_ref AND named_user.display_name ILIKE ${pattern})`,
  )}`;
}

/** SQL: a board role's rank (`SESSION_ROLE_RANK`), -1 for anything unknown. */
export function sessionRoleRankSql(role: SQL): SQL<number> {
  const branches = Object.entries(SESSION_ROLE_RANK).map(([name, rank]) => sql`WHEN ${sql.raw(`'${name}'`)} THEN ${sql.raw(String(rank))}`);
  return sql<number>`(CASE ${role} ${sql.join(branches, sql` `)} ELSE -1 END)`;
}
