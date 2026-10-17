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
 * {@link resolvePresenceAccess} runs the ONE membership check
 * (`resolveSessionMembership` in `sessionAccess.ts`, the same reads and predicates as
 * `resolveSessionAccess`) with a narrow projection: the four session fields presence
 * uses plus the caller's own member row — which is what lets the write throttle below
 * decide without an extra read.
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

import type { Db } from '../../infrastructure/database/connection';
import { creationSessionMembers, creationSessions } from '../../infrastructure/database/schema';
import { resolveSessionMembership } from './sessionAccess';

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
  role: creationSessionMembers.role,
  lastSeenAt: creationSessionMembers.lastSeenAt,
  lastSeenRevision: creationSessionMembers.lastSeenRevision,
  viewport: creationSessionMembers.viewport,
  cursor: creationSessionMembers.cursor,
  selection: creationSessionMembers.selection,
  typing: creationSessionMembers.typing,
  followingUserId: creationSessionMembers.followingUserId,
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

/**
 * The caller's membership of one board, narrowed to what presence needs, or null.
 * The predicates live once, in `resolveSessionMembership` — this only names the columns.
 */
export async function resolvePresenceAccess(
  db: Db,
  sessionId: string,
  tenantId: number,
  userId: string,
): Promise<PresenceAccess | null> {
  const row = await resolveSessionMembership<PresenceRow>(db, sessionId, tenantId, userId, presenceColumns);
  return row ? toAccess(row) : null;
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
