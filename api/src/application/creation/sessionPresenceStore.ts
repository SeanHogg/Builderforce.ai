/**
 * The presence row's WRITES — canvas-only realtime state (viewport, cursor, selection,
 * typing, follow target, last-seen revision/time).
 *
 * Its own module, importing nothing but the schema, so both the member store
 * (`sessionMembers.ts`, which seeds a new board's owner row and mirrors roles during
 * the 1264 → 1270 window) and the presence reads (`sessionPresence.ts`) can use it
 * without importing each other.
 *
 * ── THE EXPAND / CONTRACT WINDOW ────────────────────────────────────────────────
 * Until migration 1270 lands, the presence row still lives in the table the previous
 * Worker reads ACCESS from (`creation_session_members`, with its `role` column). The
 * new Worker never reads that column — access is kernel `memberships` only — but it
 * keeps it truthful with {@link mirrorLegacyRoleStatement} so a previous-Worker isolate
 * still serving during the deploy resolves the same role. 1270 renames the table to
 * `creation_session_presence` and drops the access columns; the mirror goes with them
 * (see `held-migrations/1270_drizzle.patch.md`).
 */

import type { Db } from '../../infrastructure/database/connection';
import { creationSessionPresence } from '../../infrastructure/database/schema';

/** What a presence write may set. Every column has a default, so a first write inserts. */
export type PresenceWrite = Partial<Omit<
  typeof creationSessionPresence.$inferInsert,
  'sessionId' | 'userId' | 'role' | 'invitedBy' | 'pinned' | 'watchState' | 'joinedAt'
>>;

/**
 * Upsert one person's presence row, as a statement — batchable (the commands route
 * folds the personal-viewport write into its graph batch). The caller has already
 * proved membership; this is not an access check. A first insert takes the legacy
 * `role` column's default (`viewer`), which satisfies its NOT NULL during the window.
 */
export function writePresenceStatement(db: Db, sessionId: string, userId: string, values: PresenceWrite) {
  return db.insert(creationSessionPresence)
    .values({ sessionId, userId, ...values })
    .onConflictDoUpdate({
      target: [creationSessionPresence.sessionId, creationSessionPresence.userId],
      set: values,
    });
}

/**
 * WINDOW-ONLY (1264 → 1270): copy a member's effective board role onto the legacy
 * `role` column, so the previous Worker — which still gates on it — agrees with the
 * kernel membership. Never read by this Worker. Deleted with the column in 1270.
 */
export function mirrorLegacyRoleStatement(db: Db, sessionId: string, userId: string, role: string) {
  return db.insert(creationSessionPresence)
    .values({ sessionId, userId, role })
    .onConflictDoUpdate({
      target: [creationSessionPresence.sessionId, creationSessionPresence.userId],
      set: { role },
    });
}
