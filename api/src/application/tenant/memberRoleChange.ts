/**
 * Changing a workspace member's role — by a manager of that workspace, or by a
 * platform superadmin overriding it.
 *
 * `PATCH /api/tenants/:id/members/:userId/role` and
 * `PATCH /api/admin/tenants/:tenantId/members/:userId/role` were two handlers
 * with two different sets of consequences: the workspace one cleared the
 * task-assignee cache, the admin one did not, so an operator's override left
 * every assignee picker showing the old role until its TTL. The consequences are
 * now one list, below.
 *
 * What legitimately differs is the AUTHORITY, so that is what the scope carries:
 *   - `tenant_manager` goes through the Tenant aggregate, which enforces who may
 *     promote/demote whom (an owner cannot be demoted by a manager, etc.);
 *   - `platform_admin` is a cross-tenant override that bypasses those member
 *     rules by design — the operator is not a member — and is therefore audited.
 */
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import type { TenantRole } from '../../domain/shared/types';
import type { Tenant } from '../../domain/tenant/Tenant';
import { tenantMembers } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { writeAdminAudit } from '../../infrastructure/audit/adminAudit';
import { invalidateTaskAssignees } from '../task/taskAssigneeCache';
import { membershipChanged } from './membershipChanged';
import type { TenantService } from './TenantService';

export type MemberRoleChangeScope =
  | { kind: 'tenant_manager'; tenantService: Pick<TenantService, 'changeMemberRole'> }
  | { kind: 'platform_admin'; ipAddress: string | null };

export type MemberRoleChange =
  | { ok: true; tenant: Tenant | null }
  | { ok: false; reason: 'not_member' };

export async function changeMemberRole(
  db: Db,
  env: Env,
  scope: MemberRoleChangeScope,
  input: { tenantId: number; actorUserId: string; targetUserId: string; role: TenantRole },
): Promise<MemberRoleChange> {
  const { tenantId, actorUserId, targetUserId, role } = input;
  let tenant: Tenant | null = null;

  if (scope.kind === 'tenant_manager') {
    // The aggregate enforces the member rules and announces the membership change.
    tenant = await scope.tenantService.changeMemberRole(tenantId, actorUserId, targetUserId, role);
  } else {
    const [row] = await db
      .select({ id: tenantMembers.id })
      .from(tenantMembers)
      .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, targetUserId)))
      .limit(1);
    if (!row) return { ok: false, reason: 'not_member' };
    await db.update(tenantMembers).set({ role }).where(scopedToTenant(tenantMembers, tenantId, eq(tenantMembers.id, row.id)));
    // The footer roster label AND the gateway's cached claim — one announcement.
    await membershipChanged(env, tenantId, [targetUserId]);
    await writeAdminAudit(db, 'USER_PERSONA_CHANGED', actorUserId, {
      targetUserId,
      tenantId,
      metadata: { newRole: role },
      ipAddress: scope.ipAddress,
    });
  }

  // Both scopes: the assignee pickers show the role beside each person.
  await invalidateTaskAssignees(env, tenantId);
  return { ok: true, tenant };
}
