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

import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { findObject, registerObject, type ObjectRef } from '../kernel/ObjectRegistry';

/** The three fields of a board any registry write needs. Deliberately not the whole row. */
export type SessionRef = { id: string; tenantId: number; title: string };

export async function ensureSessionObject(db: Db, env: Env, session: SessionRef): Promise<ObjectRef> {
  return registerObject(db, env, {
    tenantId: session.tenantId,
    kind: 'creation_session',
    refId: session.id,
    domain: 'canvas',
    title: session.title,
  });
}

export async function findSessionObject(db: Db, session: SessionRef): Promise<ObjectRef | null> {
  return findObject(db, session.tenantId, 'creation_session', session.id);
}
