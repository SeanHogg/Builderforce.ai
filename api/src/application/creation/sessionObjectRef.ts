/**
 * A canvas session's entry in the OBJECT REGISTRY — the id everything that points
 * AT a board points at.
 *
 * ── WHY IT IS ITS OWN MODULE ─────────────────────────────────────────────────────
 * These two helpers were private closures in `creationSessionRoutes.ts` while
 * that file was the only thing that needed them. Invite LINKS need the identical
 * answer: a link is a `share_links` row hanging off this object, exactly as an email
 * invitation is an `invitations` row hanging off it, and the two must resolve the
 * same board or a link would grant access to something the invite panel never showed.
 * Copying the upsert into a second module is how the registry comes to hold two rows
 * for one board — one that invitations point at and one that links do.
 *
 * TWO helpers rather than one, because the registry write is an upsert and a GET must
 * not perform one: `ensure` runs on the mint paths, where a board that has never been
 * registered is exactly the case that needs fixing, and `find` runs on list and revoke,
 * where a missing entry means there is nothing to show and a write would be a read
 * path quietly mutating the database.
 */

import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { objects } from '../../infrastructure/database/schema';
import { findObject, invalidateObject, registerObject, type ObjectRef } from '../kernel/ObjectRegistry';
import { SESSION_OBJECT_KIND, sessionMembersChanged, type SessionKey } from './sessionMembers';

/** The three fields of a board any registry write needs. Deliberately not the whole row. */
export type SessionRef = { id: string; tenantId: number; title: string };

export async function ensureSessionObject(db: Db, env: Env, session: SessionRef): Promise<ObjectRef> {
  return registerObject(db, env, {
    tenantId: session.tenantId,
    kind: SESSION_OBJECT_KIND,
    refId: session.id,
    domain: 'canvas',
    title: session.title,
  });
}

export async function findSessionObject(db: Db, session: SessionRef): Promise<ObjectRef | null> {
  return findObject(db, session.tenantId, SESSION_OBJECT_KIND, session.id);
}

/**
 * Drop a board's registry entry — for a board row that is being HARD-deleted (a
 * create race the caller lost). `objects` has no foreign key to the domain row it
 * registers, so without this the entry, and the memberships / shares / invitations
 * that cascade from it, would outlive the board. Soft deletes keep the entry.
 */
export async function deleteSessionObject(db: Db, env: Env | undefined, session: SessionKey): Promise<void> {
  const removed = await db.delete(objects)
    .where(and(eq(objects.tenantId, session.tenantId), eq(objects.kind, SESSION_OBJECT_KIND), eq(objects.refId, session.id)))
    .returning({ id: objects.id });
  await Promise.all(removed.map((row) => invalidateObject(env, session.tenantId, row.id)));
  await sessionMembersChanged(env, session);
}
