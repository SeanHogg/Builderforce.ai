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
 * The publisher paths (PRD 24, migration 0471) are the first callers that need
 * "at least this role" rather than "exactly this role", because a developer is a
 * tenant and a publisher's staff are `tenant_members`. Rather than give that
 * context its OWN three-value ladder — which is precisely what `developer_org
 * _members` did, and precisely what 0471 deleted — the order is declared here,
 * once, against the roles that already exist.
 *
 * Pure data and one query. No HTTP, no caching decisions: a membership read is
 * cheap and a stale authority answer is the one thing a gate must not serve.
 */

import { eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { tenantMembers } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';

/**
 * Ascending. The INDEX is the authority, so a caller asks "at least manager?"
 * instead of listing which roles qualify — one comparison that cannot drift from
 * the list the way an enumeration at each call site does.
 *
 * Mirrors the `tenant_role` Postgres enum in `schema/kernel.ts`. It is not derived
 * from it because pgEnum preserves declaration order, not authority order, and the
 * two happening to match today is not a property worth depending on.
 */
export const TENANT_ROLE_ORDER = ['viewer', 'developer', 'manager', 'owner'] as const;
export type TenantRole = (typeof TENANT_ROLE_ORDER)[number];

export function isTenantRole(value: unknown): value is TenantRole {
  return typeof value === 'string' && (TENANT_ROLE_ORDER as readonly string[]).includes(value);
}

/**
 * Is `role` at or above `minimum`?
 *
 * An unknown role is FALSE, never a lenient default. A row carrying a role this
 * build does not know about is either corruption or a deploy running behind a
 * migration, and both of those should refuse rather than admit.
 */
export function tenantRoleAtLeast(role: string | null | undefined, minimum: TenantRole): boolean {
  const have = TENANT_ROLE_ORDER.indexOf(role as TenantRole);
  return have >= 0 && have >= TENANT_ROLE_ORDER.indexOf(minimum);
}

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

/** True when the caller holds at least `minimum` in the workspace. */
export async function hasTenantRole(
  db: Db,
  tenantId: number,
  userId: string,
  minimum: TenantRole,
): Promise<boolean> {
  return tenantRoleAtLeast(await tenantRoleOf(db, tenantId, userId), minimum);
}
