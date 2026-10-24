/**
 * The presence row's WRITES — canvas-only realtime state (viewport, cursor, selection,
 * typing, follow target, last-seen revision/time).
 *
 * Its own module, importing nothing but the schema, so both the member store
 * (`sessionMembers.ts`, which seeds a new board's owner row) and the presence reads
 * (`sessionPresence.ts`) can use it without importing each other.
 */

import type { Db } from '../../infrastructure/database/connection';
import { creationSessionPresence } from '../../infrastructure/database/schema';

/** What a presence write may set. Every column has a default, so a first write inserts. */
export type PresenceWrite = Partial<Omit<
  typeof creationSessionPresence.$inferInsert,
  'sessionId' | 'userId'
>>;

/**
 * Upsert one person's presence row, as a statement — batchable (the commands route
 * folds the personal-viewport write into its graph batch). The caller has already
 * proved membership; this is not an access check.
 */
export function writePresenceStatement(db: Db, sessionId: string, userId: string, values: PresenceWrite) {
  return db.insert(creationSessionPresence)
    .values({ sessionId, userId, ...values })
    .onConflictDoUpdate({
      target: [creationSessionPresence.sessionId, creationSessionPresence.userId],
      set: values,
    });
}
