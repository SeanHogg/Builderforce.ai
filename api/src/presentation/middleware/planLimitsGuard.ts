/**
 * Plan limits guard helpers.
 *
 * Usage — inline inside route handlers (not Hono middleware) so each guard
 * can return the appropriate 402 error message tailored to the resource being created.
 *
 * Pattern:
 *   const guard = buildPlanLimitsGuard(db);
 *   const check = await guard.checkAgentHostLimit(tenantId);
 *   if (check) return c.json(check, 402);
 */

import { and, count, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import {
  agentHosts,
  tenantMembers,
  projects,
} from '../../infrastructure/database/schema';
import { canAddAgentHost, canAddProject, canAddSeat, getLimits } from '../../domain/tenant/PlanLimits';
import { SEAT_KIND } from '../../domain/tenant/SeatKind';
import { countPending } from '../../application/kernel/InvitationService';
import { tenantHasSuperadminMember } from '../../application/llm/tenantTokenAvailability';
import { TenantPlan } from '../../domain/shared/types';
import { resolveTenantEffectivePlan } from '../../application/tenant/tenantPlanSnapshot';
import type { UpgradeRequiredBody } from '../../domain/tenant/paymentRequired';

type LimitError = UpgradeRequiredBody;

/**
 * Seat accounting for a tenant — the single source of truth for "how many seats
 * are taken or promised". A seat is consumed by an ACTIVE member OR a pending
 * invitation (a promise to seat someone on signup). Shared by the invite-time
 * guard ({@link buildPlanLimitsGuard.checkSeatLimit}) and the accept-time
 * re-check in `acceptPendingInvitations`, so both agree on the math.
 *
 * TWO things are deliberately NOT counted, and both used to be:
 *
 *  - A DEACTIVATED member. `is_active = false` is how a member is removed
 *    (`Tenant.removeMember` never deletes the row), so counting them meant
 *    removing somebody never gave the seat back — every membership check in the
 *    product requires `is_active`, and the tally is now the only thing that
 *    agreed the person was still there.
 *  - A CANVAS COLLABORATOR. Their membership exists so a shared board resolves,
 *    not so they can work in the workspace; their cap is
 *    `maxCreationSessionCollaborators`. See `domain/tenant/SeatKind.ts`.
 */
export async function seatCapacityForTenant(
  db: Db,
  env: Env,
  tenantId: number,
): Promise<{ plan: TenantPlan; maxSeats: number; members: number; pendingInvites: number }> {
  // The plan (cached snapshot) and the two counts are independent reads.
  const [plan, [memberRow], [inviteRow]] = await Promise.all([
    resolveTenantEffectivePlan(env, tenantId, db),
    db.select({ total: count() }).from(tenantMembers).where(and(
      eq(tenantMembers.tenantId, tenantId),
      eq(tenantMembers.isActive, true),
      eq(tenantMembers.seatKind, SEAT_KIND.SEAT),
    )),
    // The SAME cached read the members page lists from, so a seat cap and the
    // roster it is derived from can never disagree about what "pending" means.
    countPending(db, env, tenantId, 'tenant', SEAT_KIND.SEAT).then((total) => [{ total }]),
  ]);
  return {
    plan,
    maxSeats: getLimits(plan).maxSeats,
    members: Number(memberRow?.total ?? 0),
    pendingInvites: Number(inviteRow?.total ?? 0),
  };
}

export function buildPlanLimitsGuard(db: Db, env: Env) {
  // A tenant with an active superadmin member is unlimited — the SAME operator
  // bypass the token-cap and cloud-run-count gates use ({@link tenantHasSuperadminMember}),
  // now extended to the plan resource caps (seats, projects, agent hosts) so an
  // operator/white-label account is never blocked by a plan limit. Best-effort:
  // any lookup failure falls through to the normal plan gate.
  const bypass = (tenantId: number): Promise<boolean> =>
    tenantHasSuperadminMember(db, tenantId, env);
  return {
    /** Returns an error payload if the tenant has reached their agentHost limit, otherwise null. */
    async checkAgentHostLimit(tenantId: number): Promise<LimitError | null> {
      if (await bypass(tenantId)) return null;
      const plan = await resolveTenantEffectivePlan(env, tenantId, db);
      const [row] = await db
        .select({ total: count() })
        .from(agentHosts)
        .where(eq(agentHosts.tenantId, tenantId));
      const current = Number(row?.total ?? 0);
      if (canAddAgentHost(plan, current)) return null;
      const { maxAgentHosts } = getLimits(plan);
      return {
        error: `Plan limit reached: your ${plan} plan allows ${maxAgentHosts} AgentHost${maxAgentHosts === 1 ? '' : 's'}. Upgrade to add more.`,
        upgradeRequired: true,
        code: 'plan_limit_reached',
        currentPlan: plan,
      };
    },

    /** Returns an error payload if the tenant has reached their project limit, otherwise null. */
    async checkProjectLimit(tenantId: number): Promise<LimitError | null> {
      if (await bypass(tenantId)) return null;
      // The plan (cached snapshot) and the project count are independent reads.
      const [plan, [row]] = await Promise.all([
        resolveTenantEffectivePlan(env, tenantId, db),
        db
          .select({ total: count() })
          .from(projects)
          .where(eq(projects.tenantId, tenantId)),
      ]);
      const current = Number(row?.total ?? 0);
      if (canAddProject(plan, current)) return null;
      const { maxProjects } = getLimits(plan);
      return {
        error: `Plan limit reached: your ${plan} plan allows ${maxProjects} project${maxProjects === 1 ? '' : 's'}. Upgrade to add more.`,
        upgradeRequired: true,
        code: 'plan_limit_reached',
        currentPlan: plan,
      };
    },

    /** Returns an error payload if the tenant has reached their seat limit, otherwise null.
     *  A PENDING invitation is a promised seat, so it counts toward the tally —
     *  otherwise a manager could queue many invites under the cap and have them
     *  all auto-accept past the limit on signup (see {@link seatCapacityForTenant}). */
    async checkSeatLimit(tenantId: number): Promise<LimitError | null> {
      if (await bypass(tenantId)) return null;
      const { plan, maxSeats, members, pendingInvites } = await seatCapacityForTenant(db, env, tenantId);
      const current = members + pendingInvites;
      if (canAddSeat(plan, current)) return null;
      return {
        error: `Plan limit reached: your ${plan} plan allows ${maxSeats} seat${maxSeats === 1 ? '' : 's'} (${members} member${members === 1 ? '' : 's'} + ${pendingInvites} pending invite${pendingInvites === 1 ? '' : 's'}). Upgrade to Teams to add more members.`,
        upgradeRequired: true,
        code: 'plan_limit_reached',
        currentPlan: plan,
      };
    },
  };
}
