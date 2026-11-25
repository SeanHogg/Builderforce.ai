/**
 * "May THIS caller write THIS board" for a sync event — the board-role gate, applied.
 *
 * Authorization is the canvas context's own (`sessionAccess.ts` / `sessionRoles.ts`): a
 * board's members are kernel memberships, a write reads the grant FRESH
 * (`grantReadFor`), and a viewer or commenter cannot write. This module only adds what a
 * sync event needs on top: telling "the board has not landed yet" (a hold — the client
 * lists the board's create in `dependsOn`, but a raced child must not be lost) from "the
 * board is not yours" (a refusal), without leaking which boards exist in other tenants.
 *
 * The lookup runs on the push's own transaction handle, so a board an earlier event of the
 * same chunk created (not committed yet) is visible to the events that follow it.
 */

import { and, eq } from 'drizzle-orm';
import type { Db, Tx } from '../../../infrastructure/database/connection';
import { creationSessions } from '../../../infrastructure/database/schema';
import type { BoundedImportOutcome, SyncImportContext } from '../../sync/syncPorts';
import { pending, rejected } from '../../sync/importers';
import { SESSION_ROLE_RANK, grantReadFor, resolveSessionAccess, type SessionAccess, type SessionRole } from '../sessionAccess';

export type BoardForSync =
  | { kind: 'ok'; access: SessionAccess }
  | { kind: 'outcome'; outcome: BoundedImportOutcome };

export interface BoardRequirement {
  /** The lowest board role the event needs. */
  minimum: SessionRole;
  /** A delete may name a board that is already deleted (the outcome it asked for holds). */
  allowDeleted?: boolean;
}

export async function resolveBoardForSync(
  tx: Tx,
  ctx: Pick<SyncImportContext, 'auth'>,
  boardId: string,
  requirement: BoardRequirement,
): Promise<BoardForSync> {
  const db = tx as unknown as Db;
  const { tenantId, userId } = ctx.auth;
  // No `env`: a write never reads a cached grant, and a cache bump is not this push's to make.
  const access = await resolveSessionAccess(db, boardId, tenantId, userId, undefined, grantReadFor(requirement.minimum));
  if (!access) {
    // Nothing the caller may see. A board that is not in THEIR tenant at all (not created yet,
    // or somebody else's) answers the same hold, so an id cannot be probed across tenants.
    const [row] = await db
      .select({ id: creationSessions.id })
      .from(creationSessions)
      .where(and(eq(creationSessions.id, boardId), eq(creationSessions.tenantId, tenantId)))
      .limit(1);
    return { kind: 'outcome', outcome: row ? rejected('canvas_board_forbidden') : pending('canvas_board_pending') };
  }
  if (SESSION_ROLE_RANK[access.role as SessionRole] < SESSION_ROLE_RANK[requirement.minimum]) {
    return { kind: 'outcome', outcome: rejected('canvas_board_forbidden') };
  }
  if (access.session.status === 'deleted' && !requirement.allowDeleted) {
    return { kind: 'outcome', outcome: rejected('canvas_board_deleted') };
  }
  return { kind: 'ok', access };
}
