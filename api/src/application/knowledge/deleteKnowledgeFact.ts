/**
 * deleteKnowledgeFact — `DELETE …/facts/:key` (PRD 38 §8.3): retire one fact AND every
 * relation that names it, then invalidate the project's cached graphs.
 *
 * Who may delete:
 *   • a project admin (tenant role manager or above, or a superadmin) — any fact;
 *   • the fact's author — a fact whose `created_by` is them;
 *   • for a fact with NO recorded author (an agent's, a host's, or any pre-1278 row) — any
 *     caller of the route, as before: the writer removing what it owns (`memory_forget`).
 * A person's fact is never deleted by another non-admin person, nor by a machine.
 *
 * {@link factViewer} states the same rule for a reader (`GET …/knowledge/facts`), so a host
 * offers Delete exactly where this use case would allow it and computes nothing itself.
 */
import { factRef } from '@seanhogg/builderforce-memory/knowledge';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { TenantRole, hasMinRole } from '../../domain/shared/types';
import { resolveIsSuperadmin } from '../../infrastructure/auth/superadminFlag';
import { deleteProjectFact } from '../llm/projectFactsWrite';
import type { KnowledgeStorePort } from './knowledgePorts';
import { bumpKnowledgeVersion } from './knowledgeVersion';

export interface FactDeleteActor {
  /** The person deleting; null for an agent host or another machine caller. */
  userId: string | null;
  role: string | null;
}

export type FactDeleteResult =
  | { ok: true; removed: boolean; relationsRemoved: number }
  | { ok: false; status: 403; error: string };

/** A project admin may delete any fact: tenant role manager or above, or a superadmin. */
function isFactAdmin(role: string | null, isSuperadmin: boolean): boolean {
  return isSuperadmin || hasMinRole(role, TenantRole.MANAGER);
}

export function mayDeleteFact(actor: FactDeleteActor, author: string | null, isSuperadmin = false): boolean {
  if (isFactAdmin(actor.role, isSuperadmin)) return true;
  if (author == null) return true;
  return actor.userId != null && actor.userId === author;
}

/** The reader as the delete rule sees them: who they are and whether they administer facts. */
export interface FactViewer {
  userId: string | null;
  canAdmin: boolean;
}

export async function factViewer(env: Env, actor: FactDeleteActor): Promise<FactViewer> {
  // The superadmin flag is read (cached) only for a person the role did not already admit.
  const canAdmin = isFactAdmin(actor.role, false)
    || (actor.userId != null && isFactAdmin(actor.role, await resolveIsSuperadmin(env, actor.userId)));
  return { userId: actor.userId, canAdmin };
}

export async function deleteKnowledgeFact(
  deps: { env: Env; db: Db; tenantId: number; projectId: number; store: KnowledgeStorePort },
  actor: FactDeleteActor,
  key: string,
): Promise<FactDeleteResult> {
  const k = key.trim().slice(0, 255);
  const author = await deps.store.factAuthor(k);
  // The superadmin flag is read (cached) only when the cheaper rules already refused.
  if (author !== undefined && !mayDeleteFact(actor, author)
    && !(actor.userId && mayDeleteFact(actor, author, await resolveIsSuperadmin(deps.env, actor.userId)))) {
    return { ok: false, status: 403, error: 'only the fact’s author or a project admin may delete it' };
  }
  // Relations first: a fact gone with its edges left behind would draw them dangling.
  const relationsRemoved = await deps.store.deleteRelationsOf(factRef(k));
  const removed = await deleteProjectFact(deps.env, deps.db, deps.tenantId, deps.projectId, k);
  // deleteProjectFact bumps on a removal; relations removed without a fact still need one.
  if (!removed && relationsRemoved > 0) await bumpKnowledgeVersion(deps.env, deps.tenantId, deps.projectId);
  return { ok: true, removed, relationsRemoved };
}
