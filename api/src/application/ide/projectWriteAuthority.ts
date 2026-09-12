/**
 * WHO MAY WRITE A PROJECT'S FILES — the gate on the IDE write routes.
 *
 * The IDE file routes (`/api/ide/projects/:id/files/*`, history restore) used to
 * check only that the project belongs to the caller's workspace, so ANY member —
 * a viewer, or a person seated by one shared canvas — could overwrite or delete a
 * project's source. Writing code is the developer tier's job, and that is the
 * default here.
 *
 * The one other writer is the CANVAS: a Builder object on a board is bound to a
 * storage project, and the canvas BUILD tools (`frontend/src/lib/canvasBuildTools.ts`)
 * write its files through these same routes. A board's write authority is its BOARD
 * role (`application/creation/sessionAccess.ts`), so a canvas `contributor` who is an
 * editor on a board LINKED to the project (`creation_session_project_links`) may
 * write that project — and no other.
 */

import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import {
  creationSessionMembers,
  creationSessionProjectLinks,
  creationSessions,
} from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { hasMinRole, TenantRole } from '../../domain/shared/types';
import { SESSION_ROLE_RANK, type SessionRole } from '../creation/sessionAccess';

/** Board roles that edit a board — derived from the rank, not restated. */
const BOARD_EDIT_ROLES = (Object.keys(SESSION_ROLE_RANK) as SessionRole[])
  .filter((role) => SESSION_ROLE_RANK[role] >= SESSION_ROLE_RANK.editor);

/**
 * May this caller write files in `projectId`? The caller's tenant ownership of the
 * project is checked by the route BEFORE this; this answers only the authority.
 * An unknown role, or a caller with no user id, fails closed.
 */
export async function mayWriteProjectFiles(
  db: Db,
  tenantId: number,
  userId: string | null | undefined,
  role: string | null | undefined,
  projectId: number,
): Promise<boolean> {
  if (hasMinRole(role, TenantRole.DEVELOPER)) return true;
  if (!userId || !hasMinRole(role, TenantRole.VIEWER)) return false;
  const [link] = await db
    .select({ sessionId: creationSessionProjectLinks.sessionId })
    .from(creationSessionProjectLinks)
    .innerJoin(creationSessions, eq(creationSessions.id, creationSessionProjectLinks.sessionId))
    .innerJoin(creationSessionMembers, and(
      eq(creationSessionMembers.sessionId, creationSessionProjectLinks.sessionId),
      eq(creationSessionMembers.userId, userId),
    ))
    .where(scopedToTenant(
      creationSessions,
      tenantId,
      eq(creationSessionProjectLinks.projectId, projectId),
      inArray(creationSessionMembers.role, BOARD_EDIT_ROLES),
    ))
    .limit(1);
  return !!link;
}
