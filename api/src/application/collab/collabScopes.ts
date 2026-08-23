import type { Db } from '../../infrastructure/database/connection';
import type { TenantRole } from '../../domain/shared/types';
import { canEditAccess, documentAccessById } from '../knowledge/documentAccess';
import { projectInTenant } from '../project/projectOwnership';

/**
 * WHICH CO-EDITING ROOMS EXIST, AND WHO MAY ENTER ONE.
 *
 * A Yjs room is a shared mutable document with no per-message authorization: once
 * a socket is in, every byte it sends is merged into what everybody else is
 * looking at. So the ONLY place access can be decided is the upgrade, and the
 * only thing the upgrade knows is a room name a browser chose.
 *
 * That makes an open-ended room name a vulnerability rather than a convenience —
 * which is exactly what the standalone `worker/` shipped: `/api/collab/:sessionId/ws`
 * named any Durable Object the caller asked for, with no token at all. This
 * registry is the replacement. A room name is `<scope>:<id>`, a scope that is not
 * declared here does not exist, and every declared scope names the check that
 * admits somebody to it.
 *
 * ── OPEN/CLOSED, ON PURPOSE ──────────────────────────────────────────────────
 * A new co-editable surface is a new ENTRY, not a new branch in the route. The
 * route below never learns what a knowledge document is.
 *
 * ── WHY EDIT RIGHTS AND NOT READ RIGHTS ──────────────────────────────────────
 * There is no read-only membership of a CRDT room. A viewer admitted "to watch"
 * can type, and nothing downstream would know the difference. Viewers therefore
 * read through the ordinary REST route and simply do not get a live room, which
 * is the same answer the editor surface already gives them.
 */

export interface CollabActor {
  tenantId: number;
  userId: string;
  role: TenantRole;
}

/** Why an upgrade was refused. `not-found` is a room whose subject does not exist
 *  in this tenant — reported as 404 so a probe cannot enumerate other workspaces'
 *  document ids by telling 403 from 404. */
export type CollabDenial = 'unknown-scope' | 'not-found' | 'forbidden';

export type CollabAdmission = { ok: true; room: string } | { ok: false; reason: CollabDenial };

interface CollabScope {
  /** Admit this actor to `id` within the scope, or say why not. */
  admit(db: Db, id: string, actor: CollabActor): Promise<Exclude<CollabDenial, 'unknown-scope'> | null>;
}

const SCOPES: Readonly<Record<string, CollabScope>> = {
  /**
   * A Knowledge document body, co-edited block by block. `id` is the document
   * UUID; the tenant check happens inside the lookup so a foreign id is a 404.
   */
  knowledge: {
    async admit(db, id, actor) {
      const access = await documentAccessById(db, id, actor);
      if (access === null) return 'not-found';
      return canEditAccess(access) ? null : 'forbidden';
    },
  },

  /**
   * An IDE project's shared code buffer (`useCollaboration`). Membership of the
   * workspace that owns the project is the whole rule — the IDE has no per-file
   * ACL, and a project this tenant cannot see is a 404.
   */
  project: {
    async admit(db, id, actor) {
      const projectId = Number(id);
      if (!Number.isInteger(projectId) || projectId < 1) return 'not-found';
      return (await projectInTenant(db, actor.tenantId, projectId)) ? null : 'not-found';
    },
  },
};

/** The scope names a client may ask for. Exported so a test can assert the route
 *  and the registry cannot drift apart. */
export const COLLAB_SCOPES = Object.keys(SCOPES);

/**
 * Split `<scope>:<id>`.
 *
 * Only the FIRST colon separates, because a document id is opaque and a future
 * scope may well want one containing colons. A name with no colon, an unknown
 * scope, or an empty id is not a room.
 */
export function parseCollabRoom(name: string): { scope: string; id: string } | null {
  const separator = name.indexOf(':');
  if (separator <= 0) return null;
  const scope = name.slice(0, separator);
  const id = name.slice(separator + 1);
  if (!id) return null;
  return { scope, id };
}

/**
 * The Durable Object instance name for an admitted room.
 *
 * TENANT-PREFIXED, and that is not decoration: `idFromName` is a global namespace,
 * so `knowledge:<uuid>` alone would put two workspaces holding the same id — a
 * copied document, a restored backup, a fixture — into ONE shared document. The
 * prefix is added here rather than at the call site so no route can forget it.
 */
export function collabRoomInstance(tenantId: number, scope: string, id: string): string {
  return `collab:t${tenantId}:${scope}:${id}`;
}

/**
 * Decide whether this actor may open this room, and under what instance name.
 *
 * Returns the INSTANCE name on success so the caller never handles the raw
 * client-supplied string again.
 */
export async function admitToCollabRoom(db: Db, name: string, actor: CollabActor): Promise<CollabAdmission> {
  const parsed = parseCollabRoom(name);
  if (!parsed) return { ok: false, reason: 'unknown-scope' };
  const scope = SCOPES[parsed.scope];
  if (!scope) return { ok: false, reason: 'unknown-scope' };
  const denial = await scope.admit(db, parsed.id, actor);
  if (denial) return { ok: false, reason: denial };
  return { ok: true, room: collabRoomInstance(actor.tenantId, parsed.scope, parsed.id) };
}
