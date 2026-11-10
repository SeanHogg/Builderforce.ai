/**
 * Who the signed-in editor user is, as `GET /api/vscode/me` answers it.
 *
 * The editor filters its task tree to "assigned to me" by `userId`, and names who reviewed a
 * knowledge pack by `displayName`. Never the email. The display-name lookup is best-effort:
 * a failed read is reported and the answer degrades to the id alone (the id is what the
 * editor cannot work without, and it comes from the session, not the database).
 */
import { eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { users } from '../../infrastructure/database/schema';
import { reportCaughtError } from '../observability/caughtErrorReporter';

export interface EditorIdentity {
  userId: string;
  displayName?: string;
}

export async function resolveEditorIdentity(db: Db, userId: string): Promise<EditorIdentity> {
  const [who] = await db
    .select({ displayName: users.displayName })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
    .catch((error: unknown) => {
      reportCaughtError(error, { source: 'application/vscode/editorIdentity.ts', operation: 'resolveEditorIdentity displayName lookup' });
      return [];
    });
  return { userId, ...(who?.displayName ? { displayName: who.displayName } : {}) };
}
