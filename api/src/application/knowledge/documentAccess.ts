import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { knowledgeDocumentCollaborators, knowledgeDocuments } from '../../infrastructure/database/schema';
import { TenantRole, hasMinRole } from '../../domain/shared/types';

/**
 * WHO MAY OPEN A KNOWLEDGE DOCUMENT — one answer, for every door into it.
 *
 * ── WHY IT LEFT THE ROUTER ───────────────────────────────────────────────────
 * `resolveAccess` / `canEditAccess` / `loadCollabRole` / `accessFor` were four
 * things inside `createKnowledgeRoutes`, two of them closures over that router's
 * `db`. That was fine while the REST routes were the only way in. They are not:
 * the co-editing room (`/api/collab/knowledge:<id>`) admits a socket to the SAME
 * document, and a socket admitted on a weaker rule than the PATCH it replaces is
 * a permission check that exists only on paper — the second person in the room
 * types straight into the shared document.
 *
 * So the rule is an application module both callers depend on, rather than a
 * closure one of them could only approximate.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ─────────────────────────────────────────
 * It does not read the request. The caller passes the tenant, the user and the
 * role it already resolved from the session, because the two callers get them
 * from different middleware and a module that reached for a Hono context could
 * not serve the DO-relay path at all.
 */

export type DocAccess = 'manager' | 'editor' | 'viewer' | 'none';

/**
 * A user's effective access to a single document. Workspace managers always
 * have full access; the document creator and invited 'editor' collaborators can
 * co-edit; invited 'viewer' collaborators are explicitly associated for
 * awareness; everyone else falls back to tenant-level read ('none').
 */
export function resolveAccess(opts: {
  role: TenantRole;
  isCreator: boolean;
  collabRole: string | null;
}): DocAccess {
  if (hasMinRole(opts.role, TenantRole.MANAGER)) return 'manager';
  if (opts.isCreator || opts.collabRole === 'editor') return 'editor';
  if (opts.collabRole === 'viewer') return 'viewer';
  return 'none';
}

export function canEditAccess(access: DocAccess): boolean {
  return access === 'manager' || access === 'editor';
}

/** The current user's collaborator role on a document, or null. */
export async function loadCollabRole(db: Db, documentId: string, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ role: knowledgeDocumentCollaborators.role })
    .from(knowledgeDocumentCollaborators)
    .where(
      and(
        eq(knowledgeDocumentCollaborators.documentId, documentId),
        eq(knowledgeDocumentCollaborators.userId, userId),
      ),
    );
  return row?.role ?? null;
}

/**
 * Effective access when the caller ALREADY holds the document row.
 *
 * The REST routes load the document to serve it anyway, so making them re-read it
 * to learn the author would be a second round-trip for a column they are holding.
 */
export async function documentAccessFor(
  db: Db,
  doc: { id: string; createdBy: string | null },
  actor: { userId: string; role: TenantRole },
): Promise<DocAccess> {
  if (hasMinRole(actor.role, TenantRole.MANAGER)) return 'manager';
  const isCreator = doc.createdBy === actor.userId;
  const collabRole = isCreator ? null : await loadCollabRole(db, doc.id, actor.userId);
  return resolveAccess({ role: actor.role, isCreator, collabRole });
}

/**
 * Effective access when the caller holds only an id — the collab room's case.
 *
 * Tenant-scoped in the same query as the lookup, so a document id from another
 * workspace resolves to `none` rather than to whatever the caller's role would
 * have granted on a document they cannot see. `null` means no such document in
 * this tenant, which the caller reports as 404 rather than 403.
 */
export async function documentAccessById(
  db: Db,
  documentId: string,
  actor: { tenantId: number; userId: string; role: TenantRole },
): Promise<DocAccess | null> {
  const [doc] = await db
    .select({ id: knowledgeDocuments.id, createdBy: knowledgeDocuments.createdBy })
    .from(knowledgeDocuments)
    .where(and(eq(knowledgeDocuments.id, documentId), eq(knowledgeDocuments.tenantId, actor.tenantId)));
  if (!doc) return null;
  return documentAccessFor(db, doc, actor);
}
