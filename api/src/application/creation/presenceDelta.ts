/**
 * Canvas presence, incremental — what `POST /api/creation-sessions/:id/presence`
 * sends back.
 *
 * Every open board polls presence every 8 s, and the answer used to carry EVERY
 * active member's viewport, cursor and selection JSONB on every tick, whether or
 * not anything had moved. A board with five people idle on it shipped the same
 * five JSONB blobs to each of them every eight seconds.
 *
 * The answer is now a delta against what the caller already holds:
 *
 *   • every member row gets a {@link presenceFingerprint} — a short hash of what the
 *     board draws from it (identity, role, revision, viewport, cursor, selection,
 *     typing, follow target). `lastSeenAt` is deliberately NOT in it: the heartbeat
 *     rewrites it every 30 s without anything visible changing;
 *   • the caller sends back `known: { userId: fingerprint }` from its last answer;
 *   • the response carries full rows ONLY for members whose fingerprint differs
 *     (or who are new), plus `present` — every active member id, so a departure is
 *     a missing id — and the current `fingerprints` for the next tick.
 *
 * A caller that sends no `known` (first tick, an older client) gets the full list,
 * exactly as before. The read itself stays one round trip; it is the response that
 * stops shipping unchanged JSONB.
 */

import { and, eq, gte } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { creationSessionPresence, memberships, users } from '../../infrastructure/database/schema';
import { activeSessionMemberWhere, type SessionKey } from './sessionMembers';

/** Ceiling on the `known` map a caller may send — far above any real board's roster. */
export const MAX_KNOWN_PRESENCE = 200;

export interface PresenceMemberRow {
  userId: string;
  role: string;
  displayName: string | null;
  avatarUrl: string | null;
  lastSeenRevision: number | null;
  lastSeenAt: Date | string | null;
  viewport: unknown;
  cursor: unknown;
  selection: unknown;
  typing: boolean | null;
  followingUserId: string | null;
}

/**
 * The active members of one board (seen within the window), with their drawn presence.
 * Presence rows are canvas-only (`creationSessionPresence`); the ROLE comes from the
 * kernel membership, and the inner join is what keeps a removed member's stale row off
 * the list.
 */
export function listActivePresenceMembers(db: Db, session: SessionKey, activeSince: Date): Promise<PresenceMemberRow[]> {
  return db.select({
    userId: creationSessionPresence.userId,
    role: memberships.role,
    displayName: users.displayName,
    // The picture the room puts on this person's figure (`PeerAvatar`).
    avatarUrl: users.avatarUrl,
    lastSeenRevision: creationSessionPresence.lastSeenRevision,
    lastSeenAt: creationSessionPresence.lastSeenAt,
    viewport: creationSessionPresence.viewport,
    cursor: creationSessionPresence.cursor,
    selection: creationSessionPresence.selection,
    typing: creationSessionPresence.typing,
    followingUserId: creationSessionPresence.followingUserId,
  }).from(creationSessionPresence)
    .innerJoin(memberships, and(activeSessionMemberWhere(session.tenantId, session.id), eq(memberships.memberRef, creationSessionPresence.userId)))
    .leftJoin(users, eq(users.id, creationSessionPresence.userId))
    .where(and(eq(creationSessionPresence.sessionId, session.id), gte(creationSessionPresence.lastSeenAt, activeSince)));
}

/** JSON with object keys sorted, so JSONB's key reordering never changes a fingerprint. */
function canonicalJson(value: unknown): string {
  if (value === undefined || value === null) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).filter((key) => record[key] !== undefined).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

/** A short, stable hash (FNV-1a, 32-bit) of everything the board draws from a member row. Pure. */
export function presenceFingerprint(member: PresenceMemberRow): string {
  const text = canonicalJson([
    member.role, member.displayName, member.avatarUrl, member.lastSeenRevision ?? null,
    member.viewport, member.cursor, member.selection, member.typing === true, member.followingUserId ?? null,
  ]);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** Read a caller's `known` map, bounded and string-only. Pure. */
export function parseKnownPresence(raw: unknown): Map<string, string> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const known = new Map<string, string>();
  for (const [userId, fingerprint] of Object.entries(raw as Record<string, unknown>)) {
    if (known.size >= MAX_KNOWN_PRESENCE) break;
    if (typeof fingerprint === 'string' && fingerprint.length <= 16) known.set(userId, fingerprint);
  }
  return known;
}

export interface PresenceDelta {
  /** Full rows — every member without `known`, only the changed or new ones with it. */
  members: PresenceMemberRow[];
  /** Every active member id (delta answers only). A held member missing here has left. */
  present?: string[];
  /** userId → fingerprint for every active member (delta answers only). */
  fingerprints?: Record<string, string>;
}

/** The response body's member part for a caller holding `known` (null ⇒ full list). Pure. */
export function presenceDelta(members: readonly PresenceMemberRow[], known: Map<string, string> | null): PresenceDelta {
  if (!known) return { members: [...members] };
  const fingerprints: Record<string, string> = {};
  const changed: PresenceMemberRow[] = [];
  for (const member of members) {
    const fingerprint = presenceFingerprint(member);
    fingerprints[member.userId] = fingerprint;
    if (known.get(member.userId) !== fingerprint) changed.push(member);
  }
  return { members: changed, present: members.map((member) => member.userId), fingerprints };
}
