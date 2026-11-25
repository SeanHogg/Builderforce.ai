/**
 * The few reads the object and edge importers decide on, in one place: which board an
 * object or connection is on (a delete carries no payload to say), which of a set of
 * objects exist on a board, and how many a board holds. Reads only — every write goes
 * through `boardEditWriter` and the statement builders in `creationGraphWriter`.
 *
 * Every read is scoped through the board row's tenant, so an id belonging to another
 * tenant's board resolves to "nothing here", never to somebody else's board.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../../infrastructure/database/connection';
import {
  creationSessionConnections,
  creationSessionObjects,
  creationSessions,
  users,
} from '../../../infrastructure/database/schema';

/** The caller's-tenant board an object lives on, or null (no such object, or not this tenant's). */
export async function boardOfObject(db: Db, tenantId: number, objectId: string): Promise<string | null> {
  const [row] = await db
    .select({ sessionId: creationSessionObjects.sessionId })
    .from(creationSessionObjects)
    .innerJoin(creationSessions, eq(creationSessions.id, creationSessionObjects.sessionId))
    .where(and(eq(creationSessionObjects.id, objectId), eq(creationSessions.tenantId, tenantId)))
    .limit(1);
  return row?.sessionId ?? null;
}

/** The caller's-tenant board a connection lives on, or null. */
export async function boardOfConnection(db: Db, tenantId: number, connectionId: string): Promise<string | null> {
  const [row] = await db
    .select({ sessionId: creationSessionConnections.sessionId })
    .from(creationSessionConnections)
    .innerJoin(creationSessions, eq(creationSessions.id, creationSessionConnections.sessionId))
    .where(and(eq(creationSessionConnections.id, connectionId), eq(creationSessions.tenantId, tenantId)))
    .limit(1);
  return row?.sessionId ?? null;
}

/** Which of `objectIds` are objects of this board. */
export async function objectsOnBoard(db: Db, boardId: string, objectIds: readonly string[]): Promise<Set<string>> {
  if (objectIds.length === 0) return new Set();
  const rows = await db
    .select({ id: creationSessionObjects.id })
    .from(creationSessionObjects)
    .where(and(eq(creationSessionObjects.sessionId, boardId), inArray(creationSessionObjects.id, [...objectIds])));
  return new Set(rows.map((row) => row.id));
}

/** The name a person's transcript messages are attributed to, or null. */
export async function displayNameOf(db: Db, userId: string): Promise<string | null> {
  const [row] = await db.select({ name: users.displayName }).from(users).where(eq(users.id, userId)).limit(1);
  return row?.name ?? null;
}

export async function countBoardObjects(db: Db, boardId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(creationSessionObjects)
    .where(eq(creationSessionObjects.sessionId, boardId));
  return Number(row?.count ?? 0);
}

export async function countBoardConnections(db: Db, boardId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(creationSessionConnections)
    .where(eq(creationSessionConnections.sessionId, boardId));
  return Number(row?.count ?? 0);
}
