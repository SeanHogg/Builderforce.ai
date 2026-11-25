/**
 * THE per-edit board write — one object, one connection or one session field, at a
 * new revision.
 *
 * `creationGraphWriter` replaces a whole graph at a revision the CALLER computed and
 * checked (`PUT /:id/graph` carries `expectedRevision`). A sync push carries no such
 * guard: it is a stream of small edits from a device that may be hours behind, and each
 * one has to land on whatever revision the board is at NOW. So this reads the board's
 * revision under a row lock, builds the edit's own statements, and ends with the same
 * two bookkeeping statements every board write ends with
 * (`revisionBookkeepingStatements`): the session moves to the new revision and the event
 * that names it is appended, carrying the idempotency key.
 *
 * The lock is what serialises two edits of one board inside one push chunk; the event's
 * unique constraints (`uq_creation_events_revision`, `uq_creation_events_idempotency`)
 * are what serialise this write against the route writers, which do not take it.
 *
 * It runs in a SAVEPOINT of the caller's transaction, so an edit that is refused (the
 * content statements say the row is not this board's) or fails rolls back only itself.
 *
 * The snapshot (`creation_session_snapshots`) is deliberately NOT written here: it holds
 * the whole graph, and writing it per edit would make a chunk of 25 edits write 25
 * copies of the board. `boardSnapshotWriter.ts` writes it once per board, after the
 * chunk commits.
 */

import { and, eq } from 'drizzle-orm';
import type { Db, Tx } from '../../infrastructure/database/connection';
import { creationSessionEvents, creationSessions } from '../../infrastructure/database/schema';
import { revisionBookkeepingStatements, type RevisionBookkeeping } from './creationGraphWriter';

export interface BoardEdit extends Omit<RevisionBookkeeping, 'revision' | 'now' | 'actorType' | 'actorRef'> {
  /** The edit's own statements (an upsert, a delete ...), in the order they must run. */
  content(db: Db, now: Date): unknown[];
  /**
   * Decide, from what each content statement returned, whether the edit is this board's.
   * A code refuses it and rolls the edit back; null accepts. Default: accept.
   */
  refuse?(results: unknown[]): string | null;
}

export type BoardEditResult =
  | { status: 'applied'; revision: number }
  /** An event with this idempotency key is already on the board: nothing was written. */
  | { status: 'replayed'; revision: number }
  | { status: 'missing' }
  | { status: 'refused'; code: string };

/** Thrown inside the savepoint to roll the edit back; never leaves this module. */
class BoardEditRefused extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export async function applyBoardEdit(tx: Tx, edit: BoardEdit): Promise<BoardEditResult> {
  const lockDb = tx as unknown as Db;
  const [board] = await lockDb
    .select({ revision: creationSessions.canvasRevision })
    .from(creationSessions)
    .where(and(eq(creationSessions.id, edit.sessionId), eq(creationSessions.tenantId, edit.tenantId)))
    .for('update')
    .limit(1);
  if (!board) return { status: 'missing' };

  if (edit.idempotencyKey) {
    const [seen] = await lockDb
      .select({ revision: creationSessionEvents.revision })
      .from(creationSessionEvents)
      .where(and(eq(creationSessionEvents.sessionId, edit.sessionId), eq(creationSessionEvents.idempotencyKey, edit.idempotencyKey)))
      .limit(1);
    if (seen) return { status: 'replayed', revision: Number(seen.revision) };
  }

  const revision = Number(board.revision) + 1;
  try {
    await tx.transaction(async (savepoint) => {
      const db = savepoint as unknown as Db;
      const now = new Date();
      const results: unknown[] = [];
      for (const statement of edit.content(db, now)) results.push(await (statement as PromiseLike<unknown>));
      const code = edit.refuse?.(results) ?? null;
      if (code) throw new BoardEditRefused(code);
      const bookkeeping = revisionBookkeepingStatements(db, {
        ...edit,
        revision,
        actorType: 'user',
        actorRef: edit.authorUserId ?? 'sync',
        now,
      });
      for (const statement of bookkeeping) await (statement as PromiseLike<unknown>);
    });
  } catch (error) {
    if (error instanceof BoardEditRefused) return { status: 'refused', code: error.code };
    throw error;
  }
  return { status: 'applied', revision };
}
