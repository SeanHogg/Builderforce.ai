/**
 * packAccess — who may UPLOAD, REPLACE and REMOVE an uploaded knowledge pack (PRD 40, OD-2).
 * One policy for the writer (`writeKnowledge`) and the delete route:
 *
 *   • upload — a PERSON (never a host key or machine token) who is a developer or above, or a
 *     superadmin;
 *   • replace (upload over an existing pack root) and remove — the person who uploaded it
 *     (`provenance.uploadedBy`, recorded by the server, never taken from the client), a manager
 *     or above, or a superadmin.
 *
 * The admin test is the fact-delete rule's own (`factViewer`), not a second copy of it.
 */
import { TenantRole, hasMinRole } from '../../domain/shared/types';
import type { Env } from '../../env';
import { factViewer } from './deleteKnowledgeFact';
import type { KnowledgeStorePort } from './knowledgePorts';

export interface PackActor {
  /** The person acting; null for an agent host or another machine caller. */
  userId: string | null;
  role: string | null;
}

export type PackAccess = { ok: true } | { ok: false; status: 403; error: string };

const OK: PackAccess = { ok: true };
const refuse = (error: string): PackAccess => ({ ok: false, status: 403, error });

/** Replace / remove: the uploader, a manager or above, or a superadmin. */
export async function authorizePackManage(env: Env, store: Pick<KnowledgeStorePort, 'scope'>, actor: PackActor, rootId: string): Promise<PackAccess> {
  if (!actor.userId) return refuse('a knowledge pack is changed by a person, not a host key or machine token');
  const scope = await store.scope(rootId);
  if (scope?.provenance?.uploadedBy === actor.userId) return OK;
  if ((await factViewer(env, actor)).canAdmin) return OK;
  // A pack with no scope row (a stranded upload) has no recorded uploader: a developer may clear it.
  if (!scope && hasMinRole(actor.role, TenantRole.DEVELOPER)) return OK;
  return refuse('Only the person who uploaded this pack or a manager can replace or remove it.');
}

/** Upload: a developer-or-above person (or superadmin); over an existing pack, also {@link authorizePackManage}. */
export async function authorizePackUpload(env: Env, store: Pick<KnowledgeStorePort, 'scope'>, actor: PackActor, rootId: string): Promise<PackAccess> {
  if (!actor.userId) return refuse('a knowledge pack is uploaded by a person, not a host key or machine token');
  if (!hasMinRole(actor.role, TenantRole.DEVELOPER) && !(await factViewer(env, actor)).canAdmin) {
    return refuse('uploading a knowledge pack requires a developer or above');
  }
  return (await store.scope(rootId)) ? authorizePackManage(env, store, actor, rootId) : OK;
}
