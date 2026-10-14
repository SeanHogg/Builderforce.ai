/**
 * Which workspaces an operator acts for as Builderforce (PRD 33 D17).
 *
 * D17: "Builderforce is customer #1 … Superadmins see Builderforce's recordings as
 * members of that workspace." There is no platform tenant id anywhere in the API
 * (no constant, no setting, no env binding) and D17 rules one out ("no platform
 * scope"), so the Builderforce workspace is identified the way D17 itself puts it:
 * by MEMBERSHIP. An operator-only Insights action — seeding "The method" funnel, the
 * admin visitor erase — may touch only the sites of workspaces the acting superadmin
 * is an active member of. A superadmin flag alone never reaches a customer's site.
 */

import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { tenantMembers } from '../../infrastructure/database/schema';

/** The tenant ids the user is an ACTIVE member of (empty when none). */
export async function operatorWorkspaceTenantIds(db: Db, userId: string): Promise<number[]> {
  if (!userId) return [];
  const rows = await db
    .select({ tenantId: tenantMembers.tenantId })
    .from(tenantMembers)
    .where(and(eq(tenantMembers.userId, userId), eq(tenantMembers.isActive, true)));
  return [...new Set(rows.map((row) => row.tenantId))];
}
