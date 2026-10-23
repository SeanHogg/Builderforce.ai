/**
 * Canvas presence — the cheap path behind `POST /api/creation-sessions/:id/presence`.
 *
 * Every open board polls presence every 8 s, so this endpoint is the single most
 * frequent canvas write. It used to resolve access through `resolveSessionAccess`
 * (which selects the WHOLE `creation_sessions` row, `preview` JSONB included),
 * UPDATE the caller's member row unconditionally, read the active members, and
 * read the tenant's plan row from Neon. Each of those is a round trip that keeps
 * Neon awake.
 *
 * ── ACCESS ────────────────────────────────────────────────────────────────────
 * {@link resolvePresenceAccess} runs the ONE board-role gate (`resolveSessionGrant` in
 * `sessionAccess.ts`, cached under the board's member version token), then ONE read
 * with a narrow projection: the four session fields presence uses plus the caller's
 * own presence row — which is what lets the write throttle below decide without an
 * extra read.
 *
 * ── WHERE PRESENCE LIVES ──────────────────────────────────────────────────────
 * The presence table (`creationSessionPresence`; `creation_session_members` until
 * migration 1270 renames it) — canvas-only realtime state, deliberately NOT on the
 * kernel membership row (migration 1264): every tick writes it, and the row every
 * permission check reads must not be a write target. A member who has never ticked
 * has no row; every reader LEFT JOINs it and defaults.
 *
 * ── WRITE THROTTLE ────────────────────────────────────────────────────────────
 * The member UPDATE is skipped when the caller's stored row already says exactly
 * what this tick would write (revision, viewport, cursor, selection, typing,
 * follow target) AND it was written less than {@link PRESENCE_WRITE_THROTTLE_MS}
 * ago. "Active" means `last_seen_at` within {@link PRESENCE_ACTIVE_WINDOW_MS}; the
 * throttle is half of that window, so a skipped write can never let a present
 * member drop out of the active list. `last_seen_revision` drives the board's
 * unread flag, so a revision change always writes.
 */

import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import {
  creationSessionPresence, creationSessions, memberships, objects, users,
} from '../../infrastructure/database/schema';
import { grantedSessionWhere, resolveSessionGrant } from './sessionAccess';
import { SESSION_OBJECT_KIND, sessionMemberColumns, sessionMemberOn, type SessionKey } from './sessionMembers';

/** A member counts as active (on the presence list, against the realtime editor cap) for this long after their last write. */
export const PRESENCE_ACTIVE_WINDOW_MS = 60_000;

/** An unchanged presence tick is written at most this often. Must stay well under the active window. */
export const PRESENCE_WRITE_THROTTLE_MS = 30_000;

/** The caller's stored presence — what the last write left on their member row. */
export interface StoredPresence {
  lastSeenAt: Date | string | null;
  lastSeenRevision: number | null;
  viewport: unknown;
  cursor: unknown;
  selection: unknown;
  typing: boolean | null;
  followingUserId: string | null;
}

/** What this tick would write. */
export interface NextPresence {
  revision: number;
  viewport: unknown;
  cursor: unknown;
  selection: string[];
  typing: boolean;
  followingUserId: string | null;
}

export interface PresenceAccess {
  session: { id: string; tenantId: number; canvasRevision: number; viewport: unknown };
  role: string;
  self: StoredPresence;
}

const presenceColumns = {
  id: creationSessions.id,
  tenantId: creationSessions.tenantId,
  canvasRevision: creationSessions.canvasRevision,
  sessionViewport: creationSessions.viewport,
  lastSeenAt: creationSessionPresence.lastSeenAt,
  lastSeenRevision: creationSessionPresence.lastSeenRevision,
  viewport: creationSessionPresence.viewport,
  cursor: creationSessionPresence.cursor,
  selection: creationSessionPresence.selection,
  typing: creationSessionPresence.typing,
  followingUserId: creationSessionPresence.followingUserId,
};

type PresenceRow = {
  id: string; tenantId: number; canvasRevision: number; sessionViewport: unknown; role: string;
} & StoredPresence;

function toAccess(row: PresenceRow): PresenceAccess {
  return {
    session: { id: row.id, tenantId: row.tenantId, canvasRevision: row.canvasRevision, viewport: row.sessionViewport },
    role: row.role,
    self: {
      lastSeenAt: row.lastSeenAt,
      lastSeenRevision: row.lastSeenRevision,
      viewport: row.viewport,
      cursor: row.cursor,
      selection: row.selection,
      typing: row.typing,
      followingUserId: row.followingUserId,
    },
  };
}

/** One person's presence row on one board — the join every presence reader uses. */
export function presenceRowOn(userId: string) {
  return and(eq(creationSessionPresence.sessionId, creationSessions.id), eq(creationSessionPresence.userId, userId))!;
}

/**
 * The caller's membership of one board, narrowed to what presence needs, or null.
 * The predicates live once, in `sessionAccess.ts` — this only names the columns.
 */
export async function resolvePresenceAccess(
  db: Db,
  sessionId: string,
  tenantId: number,
  userId: string,
  env?: Env,
): Promise<PresenceAccess | null> {
  const grant = await resolveSessionGrant(db, sessionId, tenantId, userId, env);
  if (!grant) return null;
  const [row] = await db
    .select(presenceColumns)
    .from(creationSessions)
    .leftJoin(creationSessionPresence, presenceRowOn(userId))
    .where(grantedSessionWhere(grant, sessionId, tenantId))
    .limit(1);
  return row ? toAccess({ ...row, role: grant.role }) : null;
}

/** Structural JSON equality, insensitive to object key order (JSONB reorders keys). */
export function jsonEquivalent(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const other = b as unknown[];
    return a.length === other.length && a.every((value, index) => jsonEquivalent(value, other[index]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const leftKeys = Object.keys(left).filter((key) => left[key] !== undefined);
  const rightKeys = Object.keys(right).filter((key) => right[key] !== undefined);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && jsonEquivalent(left[key], right[key]));
}

/**
 * Must this tick write the caller's member row? False only when the stored row is
 * fresh (written < {@link PRESENCE_WRITE_THROTTLE_MS} ago) and already holds every
 * value this tick would write.
 */
export function presenceWriteDue(stored: StoredPresence, next: NextPresence, now: Date): boolean {
  if (!stored.lastSeenAt) return true;
  const lastSeenMs = new Date(stored.lastSeenAt).getTime();
  if (!Number.isFinite(lastSeenMs)) return true;
  const age = now.getTime() - lastSeenMs;
  if (age < 0 || age >= PRESENCE_WRITE_THROTTLE_MS) return true;
  if (Number(stored.lastSeenRevision ?? -1) !== next.revision) return true;
  if ((stored.typing === true) !== next.typing) return true;
  if ((stored.followingUserId ?? null) !== next.followingUserId) return true;
  if (!jsonEquivalent(stored.viewport, next.viewport)) return true;
  if (!jsonEquivalent(stored.cursor ?? null, next.cursor ?? null)) return true;
  if (!jsonEquivalent(stored.selection ?? [], next.selection)) return true;
  return false;
}

/**
 * Everyone on a board, with what the board draws for each — `GET /:id`'s `members`.
 * The roster is the kernel membership; the drawn presence is the canvas-only presence
 * row, absent until a member's first tick, so every presence field defaults exactly as
 * the old member-row columns did.
 */
export function listSessionRoster(db: Db, session: SessionKey) {
  return db.select({
    userId: memberships.memberRef,
    role: memberships.role,
    displayName: users.displayName,
    avatarUrl: users.avatarUrl,
    lastSeenAt: creationSessionPresence.lastSeenAt,
    viewport: sql<unknown>`coalesce(${creationSessionPresence.viewport}, '{"x":0,"y":0,"zoom":1}'::jsonb)`.mapWith(creationSessionPresence.viewport),
    cursor: creationSessionPresence.cursor,
    selection: sql<unknown>`coalesce(${creationSessionPresence.selection}, '[]'::jsonb)`.mapWith(creationSessionPresence.selection),
    typing: sql<boolean>`coalesce(${creationSessionPresence.typing}, false)`,
    watchState: sessionMemberColumns.watchState,
    followingUserId: creationSessionPresence.followingUserId,
  })
    .from(objects)
    .innerJoin(memberships, sessionMemberOn())
    .leftJoin(users, eq(users.id, memberships.memberRef))
    .leftJoin(creationSessionPresence, and(
      eq(creationSessionPresence.sessionId, session.id),
      eq(creationSessionPresence.userId, memberships.memberRef),
    ))
    .where(and(
      eq(objects.tenantId, session.tenantId),
      eq(objects.kind, SESSION_OBJECT_KIND),
      eq(objects.refId, session.id),
    ));
}
