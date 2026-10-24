/**
 * THE canvas member store — who is on a board, and with what board role.
 *
 * ── WHERE MEMBERS LIVE ───────────────────────────────────────────────────────────
 * A board's members are kernel `memberships` rows on the board's registry object
 * (`objects` kind 'creation_session', see `sessionObjectRef.ts`). Migration 1264
 * backfilled them from the old canvas member table, so `/api/objects/:id/members` and
 * the canvas read the same rows and cannot disagree. Per-member preferences that are
 * durable facts about the membership (`invitedBy`, `pinned`, `watchState`) ride in
 * `memberships.metadata`; realtime presence does NOT — it stays canvas-only
 * (`sessionPresenceStore.ts`), because a cursor written every tick has no business on
 * the row every permission check reads.
 *
 * The SQL building blocks (predicates, projections, `boardsOfMember`) live in
 * `sessionMemberSql.ts` and are re-exported here: one import surface.
 *
 * ── CACHE ────────────────────────────────────────────────────────────────────────
 * The board-role gate is cached under a per-board version token
 * ({@link sessionMembersVersionKey}). EVERY writer below ends in
 * {@link sessionMembersChanged}, which bumps it and drops the kernel's cached member
 * listing for the object. Board WRITES never read a cached grant at all
 * (`grantReadFor` in `sessionAccess.ts`), so the residual staleness — bounded by the
 * token's 2 s L1 and the grant's 60 s KV TTL — only ever affects reads.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { creationSessionPresence, creationSessions, memberships, objects } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { bumpCacheVersion } from '../../infrastructure/cache/readThroughCache';
import { findObject, invalidateObject, registerObject } from '../kernel/ObjectRegistry';
import { acceptInvitationStatement, invalidateInvitations } from '../kernel/InvitationService';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import {
  SESSION_MEMBER_KIND, SESSION_OBJECT_KIND, activeSessionMemberWhere, sessionMemberColumns, sessionRoleRankSql,
  type SessionKey,
} from './sessionMemberSql';

export {
  SESSION_MEMBER_KIND, SESSION_OBJECT_KIND, activeSessionMemberWhere, boardsOfMember, sessionHasMemberNamedSql,
  sessionMemberColumns, sessionMemberCountSql, sessionMemberOn, type SessionKey,
} from './sessionMemberSql';

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

/** Version token folded into every cached board-role decision for one board. */
export const sessionMembersVersionKey = (sessionId: string) => `canvas-members:session:${sessionId}`;

/**
 * Orphan every cached grant on the board and the kernel's member listing. Called by
 * every membership writer — in this module, and by batch callers after their batch.
 *
 * `revocation` marks a write that TAKES access away (a removal, a demotion). If its
 * token bump fails, a cached grant keeps answering reads until its TTL, so that
 * failure is reported as an ERROR rather than the safe-bump's routine report.
 */
export async function sessionMembersChanged(
  env: Env | undefined, session: SessionKey, objectId?: string | null, opts: { revocation?: boolean } = {},
): Promise<void> {
  const bump = bumpCacheVersion(env, sessionMembersVersionKey(session.id)).catch((error: unknown) => {
    reportCaughtError(error, {
      source: 'application/creation/sessionMembers.ts',
      operation: opts.revocation ? 'sessionMembersChanged.revocation' : 'sessionMembersChanged',
      level: opts.revocation ? 'error' : 'warning',
      context: { sessionId: session.id, tenantId: session.tenantId, revocation: Boolean(opts.revocation) },
    });
  });
  await Promise.all([
    bump,
    objectId ? invalidateObject(env, session.tenantId, objectId) : Promise.resolve(),
  ]);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export type SessionMemberRow = {
  userId: string; role: string; joinedAt: Date | null; pinned: boolean; watchState: string; invitedBy: string | null;
};

/** Every active member of one board. */
export function listSessionMembers(db: Db, session: SessionKey): Promise<SessionMemberRow[]> {
  return db.select(sessionMemberColumns).from(memberships).where(activeSessionMemberWhere(session.tenantId, session.id));
}

/** One person's active board role, or null. Uncached — writers use it to decide. */
export async function sessionMemberRole(db: Db, session: SessionKey, userId: string): Promise<string | null> {
  const [row] = await db.select({ role: memberships.role }).from(memberships)
    .where(activeSessionMemberWhere(session.tenantId, session.id, userId)).limit(1);
  return row?.role ?? null;
}

/** Which of these people are active members of the board. */
export async function sessionMemberIdsAmong(db: Db, session: SessionKey, userIds: readonly string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const rows = await db.select({ userId: memberships.memberRef }).from(memberships)
    .where(and(activeSessionMemberWhere(session.tenantId, session.id), inArray(memberships.memberRef, [...userIds]))!);
  return rows.map((row) => row.userId);
}

/** How many active members the board has, optionally holding one role. */
export async function countSessionMembers(db: Db, session: SessionKey, role?: string): Promise<number> {
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(memberships)
    .where(and(activeSessionMemberWhere(session.tenantId, session.id), role === undefined ? undefined : eq(memberships.role, role))!);
  return Number(row?.count ?? 0);
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface SessionMemberInput {
  userId: string;
  role: string;
  invitedBy?: string | null;
}

/**
 * What to do when the person already holds a row on the board:
 *  - `keep`        an ACTIVE member keeps their role (a re-claimed link must not demote
 *                  an owner); a removed one rejoins with the new role.
 *  - `keep-higher` an ACTIVE member ends on the HIGHER of the two roles
 *                  (`SESSION_ROLE_RANK`) — an invitation accepted, or a direct invite
 *                  to somebody already on the board, may promote but never demote, so
 *                  it can never take the last owner's ownership away.
 *  - `set-role`    the new role wins (a deliberate grant, a brand-new board's owner).
 */
export type SessionMemberConflict = 'keep' | 'keep-higher' | 'set-role';

function conflictRole(onConflict: SessionMemberConflict) {
  if (onConflict === 'set-role') return sql`excluded.role`;
  if (onConflict === 'keep') {
    return sql`CASE WHEN ${memberships.state} = 'active' THEN ${memberships.role} ELSE excluded.role END`;
  }
  return sql`CASE WHEN ${memberships.state} = 'active'
    AND ${sessionRoleRankSql(sql`${memberships.role}`)} >= ${sessionRoleRankSql(sql`excluded.role`)}
    THEN ${memberships.role} ELSE excluded.role END`;
}

/**
 * One membership upsert, as a statement — batchable; RETURNS the effective role. The
 * caller owns {@link sessionMembersChanged}.
 *
 * REJOIN. When the existing row is RETIRED (the person was removed and is coming
 * back), the membership is re-activated, its `joined_at` restarts, and `invitedBy` is
 * reset to whoever brought them back this time (cleared if nobody did) — the inviter
 * is a fact about THIS stint on the board. Their own preferences, `pinned` and
 * `watchState`, are kept: they are the person's choices about the board, not about
 * how they arrived, and silently forgetting them would be a surprise on return. An
 * ACTIVE row's metadata is never touched by a re-seat.
 */
export function insertSessionMemberStatement(
  db: Db, tenantId: number, objectId: string, input: SessionMemberInput, onConflict: SessionMemberConflict,
) {
  const now = new Date();
  return db.insert(memberships).values({
    tenantId,
    objectId,
    memberKind: SESSION_MEMBER_KIND,
    memberRef: input.userId,
    role: input.role,
    state: 'active',
    joinedAt: now,
    metadata: input.invitedBy ? { invitedBy: input.invitedBy } : {},
  }).onConflictDoUpdate({
    target: [memberships.tenantId, memberships.objectId, memberships.memberKind, memberships.memberRef],
    set: {
      role: conflictRole(onConflict),
      joinedAt: sql`CASE WHEN ${memberships.state} = 'active' THEN ${memberships.joinedAt} ELSE excluded.joined_at END`,
      metadata: sql`CASE WHEN ${memberships.state} = 'active' THEN ${memberships.metadata}
        ELSE (coalesce(${memberships.metadata}, '{}'::jsonb) - 'invitedBy') || excluded.metadata END`,
      state: 'active',
      updatedAt: now,
    },
  }).returning({ role: memberships.role });
}

/**
 * A brand-new board's registry object, its owner's membership, and — when the caller
 * has the owner's camera — the owner's presence row carrying it, as batchable
 * statements to run WITH the session insert. A presence row is optional (every reader
 * LEFT JOINs it), so without a camera none is written. The object id is minted here so the membership can point at it
 * inside the same batch; this session id has never existed, so the registry row
 * cannot already be there. Every creator of a board uses this.
 */
export function newBoardOwnerStatements(
  db: Db,
  input: { sessionId: string; tenantId: number; title: string; ownerUserId: string; ownerViewport?: unknown },
): Array<{ table: string; statement: unknown }> {
  const objectId = crypto.randomUUID();
  return [
    {
      table: 'objects',
      statement: db.insert(objects).values({
        id: objectId,
        tenantId: input.tenantId,
        kind: SESSION_OBJECT_KIND,
        refId: input.sessionId,
        domain: 'canvas',
        title: input.title.slice(0, 300),
      }),
    },
    {
      table: 'memberships',
      statement: insertSessionMemberStatement(db, input.tenantId, objectId, {
        userId: input.ownerUserId, role: 'owner', invitedBy: input.ownerUserId,
      }, 'set-role'),
    },
    ...(input.ownerViewport === undefined ? [] : [{
      table: 'creation_session_members',
      statement: db.insert(creationSessionPresence).values({
        sessionId: input.sessionId, userId: input.ownerUserId, viewport: input.ownerViewport,
      }),
    }]),
  ];
}

/** {@link newBoardOwnerStatements}, statements only — for a caller's own `db.batch`. */
export function newBoardOwnerBatch(db: Db, input: Parameters<typeof newBoardOwnerStatements>[1]): unknown[] {
  return newBoardOwnerStatements(db, input).map((write) => write.statement);
}

/**
 * The registry id of an EXISTING board, registering it if it never was. Every board
 * has one since 1264 (backfill + {@link newBoardOwnerStatements}); the fallback is for
 * a board created by a path that predates that — it reads the title so the registry
 * row is named. Null when the board does not exist in this tenant.
 */
export async function sessionObjectIdFor(
  db: Db, env: Env | undefined, session: SessionKey & { title?: string },
): Promise<string | null> {
  const found = await findObject(db, session.tenantId, SESSION_OBJECT_KIND, session.id);
  if (found) return found.id;
  let title = session.title;
  if (title === undefined) {
    const [row] = await db.select({ title: creationSessions.title }).from(creationSessions)
      .where(scopedToTenant(creationSessions, session.tenantId, eq(creationSessions.id, session.id)))
      .limit(1);
    if (!row) return null;
    title = row.title;
  }
  const registered = await registerObject(db, env, {
    tenantId: session.tenantId, kind: SESSION_OBJECT_KIND, refId: session.id, domain: 'canvas', title,
  });
  return registered.id;
}

/** Seat one person on an existing board. False when the board does not exist here. */
export async function addSessionMember(
  db: Db,
  env: Env | undefined,
  session: SessionKey & { title?: string },
  input: SessionMemberInput,
  onConflict: SessionMemberConflict,
): Promise<boolean> {
  const objectId = await sessionObjectIdFor(db, env, session);
  if (!objectId) return false;
  await insertSessionMemberStatement(db, session.tenantId, objectId, input, onConflict);
  await sessionMembersChanged(env, session, objectId);
  return true;
}

/**
 * Redeem a board invitation: seat the invitee AND mark the invitation accepted in one
 * batch, so a seated invitee can never hold a still-pending token or vice versa.
 * `keep-higher`: an invitation may promote somebody already on the board but never
 * demotes them — accepting a `viewer` invite must not cost the last owner the board.
 * Both accept routes (`/api/creation-sessions/invitations/:token/accept` and the
 * workspace-picker path in `tenantRoutes`) call this — one redemption, two doors.
 */
export async function seatInvitedSessionMember(
  db: Db,
  env: Env | undefined,
  input: {
    tenantId: number; objectId: string; sessionId: string; invitationId: string;
    userId: string; role: string; invitedBy: string | null;
  },
): Promise<string> {
  const [seated] = await db.batch([
    insertSessionMemberStatement(db, input.tenantId, input.objectId, {
      userId: input.userId, role: input.role, invitedBy: input.invitedBy,
    }, 'keep-higher'),
    acceptInvitationStatement(db, { id: input.invitationId, tenantId: input.tenantId, inviteeRef: input.userId }),
  ] as unknown as Parameters<typeof db.batch>[0]) as unknown as [Array<{ role: string }>, unknown];
  const role = seated?.[0]?.role ?? input.role;
  // The batch bypasses `acceptInvitation`, so both cache drops happen here.
  await Promise.all([
    invalidateInvitations(env, input.tenantId),
    sessionMembersChanged(env, { id: input.sessionId, tenantId: input.tenantId }, input.objectId),
  ]);
  return role;
}

/** Change an active member's role. False when they are not an active member. */
export async function setSessionMemberRole(
  db: Db, env: Env | undefined, session: SessionKey, userId: string, role: string,
): Promise<boolean> {
  const rows = await db.update(memberships).set({ role, updatedAt: new Date() })
    .where(activeSessionMemberWhere(session.tenantId, session.id, userId))
    .returning({ objectId: memberships.objectId });
  // A role change may be a demotion; the gate must not keep answering the old role.
  await sessionMembersChanged(env, session, rows[0]?.objectId, { revocation: true });
  return rows.length > 0;
}

/**
 * Take somebody off a board. The membership is RETIRED, not deleted — who was on a
 * thing is the question an audit asks (see `memberships`) — and their presence row,
 * which is meaningless without a membership, is deleted.
 */
export async function removeSessionMember(db: Db, env: Env | undefined, session: SessionKey, userId: string): Promise<boolean> {
  const rows = await db.update(memberships).set({ state: 'removed', updatedAt: new Date() })
    .where(activeSessionMemberWhere(session.tenantId, session.id, userId))
    .returning({ objectId: memberships.objectId });
  await db.delete(creationSessionPresence).where(and(
    eq(creationSessionPresence.sessionId, session.id),
    eq(creationSessionPresence.userId, userId),
  ));
  await sessionMembersChanged(env, session, rows[0]?.objectId, { revocation: true });
  return rows.length > 0;
}

export interface SessionMemberPreferences {
  pinned?: boolean;
  watchState?: 'all' | 'mentions' | 'muted';
}

/** Merge a member's own preferences into their membership metadata. */
export async function setSessionMemberPreferences(
  db: Db, env: Env | undefined, session: SessionKey, userId: string, patch: SessionMemberPreferences,
): Promise<boolean> {
  const rows = await db.update(memberships).set({
    metadata: sql`coalesce(${memberships.metadata}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`,
    updatedAt: new Date(),
  })
    .where(activeSessionMemberWhere(session.tenantId, session.id, userId))
    .returning({ objectId: memberships.objectId });
  // Preferences are not part of a grant, so only the kernel listing is dropped.
  if (rows[0]) await invalidateObject(env, session.tenantId, rows[0].objectId);
  return rows.length > 0;
}
