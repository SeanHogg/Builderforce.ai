/**
 * WHICH ROLE AN IMPERSONATION TOKEN MAY CARRY.
 *
 * Impersonation (PRD §4.2) lets a superadmin see the product AS a user — and,
 * through the persona switcher, as that user would look in a LOWER role, to check
 * what a viewer or a canvas contributor sees. Both endpoints used to sign whatever
 * `role` string the request carried: an unknown string became a token no gate
 * understood, and `owner` could be minted for a viewer, which is not "seeing what
 * they see" but a different person's authority in their name.
 *
 * The rule: the role must be one the ladder knows, and no higher than the target's
 * real, active membership. A target who is not a member of that workspace can only
 * be previewed as `viewer`. The token stays read-only (`emu_readonly`) regardless;
 * this bounds what it can READ as well.
 */

import type { Db } from '../../infrastructure/database/connection';
import { hasMinRole, isTenantRole, TenantRole, type TenantRoleName } from '../../domain/shared/types';
import { tenantRoleOf } from '../tenant/tenantRoles';

export type ImpersonationRoleResult =
  | { ok: true; role: TenantRole }
  | { ok: false; status: 400 | 403; error: string };

/**
 * Decide the role for an impersonation token. `requested` absent (or blank) means
 * "as they are": the target's own role, or `viewer` for a non-member.
 */
export function capImpersonationRole(
  requested: string | null | undefined,
  targetRole: TenantRoleName | null,
): ImpersonationRoleResult {
  const ceiling: TenantRole = (targetRole as TenantRole | null) ?? TenantRole.VIEWER;
  const wanted = requested?.trim();
  if (!wanted) return { ok: true, role: ceiling };
  if (!isTenantRole(wanted)) return { ok: false, status: 400, error: `Unknown role '${wanted}'` };
  if (!hasMinRole(ceiling, wanted)) {
    return { ok: false, status: 403, error: `Cannot impersonate as '${wanted}': the user's role in this workspace is '${ceiling}'` };
  }
  return { ok: true, role: wanted };
}

/** {@link capImpersonationRole} against the target's live membership. */
export async function resolveImpersonationRole(
  db: Db,
  tenantId: number,
  targetUserId: string,
  requested: string | null | undefined,
): Promise<ImpersonationRoleResult> {
  return capImpersonationRole(requested, await tenantRoleOf(db, tenantId, targetUserId));
}
