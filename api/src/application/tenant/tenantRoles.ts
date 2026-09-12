/**
 * The tenant role ladder, and the ONE gate that reads it.
 *
 * `tenant_members.role` has been an ordered scale since the schema was written —
 * an owner may do what a manager may do, a manager what a developer may — but the
 * order lived only in people's heads. Every caller that needed it either compared
 * against a literal (`role === 'owner'`) or enumerated the roles it would accept,
 * which is the same rule written twice with two chances to disagree about whether
 * a manager counts.
 *
 * The publisher paths (PRD 24, migration 0472) are the first callers that need
 * "at least this role" rather than "exactly this role", because a developer is a
 * tenant and a publisher's staff are `tenant_members`. Rather than give that
 * context its OWN three-value ladder — which is precisely what `developer_org
 * _members` did, and precisely what 0472 deleted — the order is declared here,
 * once, against the roles that already exist.
 *
 * Pure data and one query. No HTTP, no caching decisions: a membership read is
 * cheap and a stale authority answer is the one thing a gate must not serve.
 */

import { eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { tenantMembers } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { isTenantRole, type TenantRoleName } from '../../domain/shared/types';

/**
 * The ladder itself (`ROLE_ORDER`), its gate (`hasMinRole`) and its guard
 * (`isTenantRole`) live in `domain/shared/types.ts` — ONE declaration. This module
 * used to keep a second `TENANT_ROLE_ORDER` / `tenantRoleAtLeast`, and two ladders
 * is how a new role (e.g. `contributor`) lands in one and not the other.
 */
export type TenantRole = TenantRoleName;

/**
 * The caller's active role in a workspace, or `null` when they are not in it.
 *
 * Inactive members resolve to `null` rather than to their old role: `is_active`
 * is how this platform suspends a seat without deleting its history, so a
 * suspended member who still matched their role would keep every authority the
 * suspension was meant to remove.
 */
export async function tenantRoleOf(db: Db, tenantId: number, userId: string): Promise<TenantRole | null> {
  const [row] = await db
    .select({ role: tenantMembers.role })
    .from(tenantMembers)
    .where(scopedToTenant(
      tenantMembers,
      tenantId,
      eq(tenantMembers.userId, userId),
      eq(tenantMembers.isActive, true),
    ))
    .limit(1);
  return isTenantRole(row?.role) ? row.role : null;
}

/**
 * The role to report for a workspace in the caller's OWN workspace list.
 *
 * Both list projections (`AuthService.myTenants`, `TenantService.listTenantsForUser`)
 * used to write `member?.role ?? 'member'` — the same fallback, twice, naming a role
 * that does not exist on either side of the wire. `'member'` is not in
 * `ROLE_ORDER` and not in the frontend's mirror of it, so a row that
 * ever hit the fallback rendered with NO capabilities at all and no way to tell that
 * apart from a genuine viewer.
 *
 * Least privilege, and a REAL role, so the picker and every gate downstream agree
 * on what it means. A caller who is not a member at all never reaches here: the
 * token mint (`AuthService.tenantToken`) refuses outright.
 */
export function tenantRoleForListing(role: string | null | undefined): TenantRole {
  return isTenantRole(role) ? role : 'viewer';
}
