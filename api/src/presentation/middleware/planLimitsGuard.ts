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
  tenants,
  agentHosts,
  tenantMembers,
  tenantInvitations,
  projects,
} from '../../infrastructure/database/schema';
import { canAddAgentHost, canAddProject, canAddSeat, getLimits } from '../../domain/tenant/PlanLimits';
import { resolveEffectivePlan } from '../../domain/tenant/effectivePlan';
import { tenantHasSuperadminMember } from '../../application/llm/tenantTokenAvailability';
import { TenantPlan, TenantBillingStatus } from '../../domain/shared/types';

interface LimitError {
  error: string;
  upgradeRequired: true;
  currentPlan: string;
}

/**
 * Seat accounting for a tenant — the single source of truth for "how many seats
 * are taken or promised". A seat is consumed by an active member OR a pending
 * invitation (a promise to seat someone on signup). Shared by the invite-time
 * guard ({@link buildPlanLimitsGuard.checkSeatLimit}) and the accept-time
 * re-check in `acceptPendingInvitations`, so both agree on the math.
 */
export async function seatCapacityForTenant(
  db: Db,
  tenantId: number,
): Promise<{ plan: TenantPlan; maxSeats: number; members: number; pendingInvites: number }> {
  const plan = await getTenantPlan(db, tenantId);
  const [[memberRow], [inviteRow]] = await Promise.all([
    db.select({ total: count() }).from(tenantMembers).where(eq(tenantMembers.tenantId, tenantId)),
    db.select({ total: count() }).from(tenantInvitations)
      .where(and(eq(tenantInvitations.tenantId, tenantId), eq(tenantInvitations.status, 'pending'))),
  ]);
  return {
    plan,
    maxSeats: getLimits(plan).maxSeats,
    members: Number(memberRow?.total ?? 0),
    pendingInvites: Number(inviteRow?.total ?? 0),
  };
}

async function getTenantPlan(db: Db, tenantId: number): Promise<TenantPlan> {
  const [row] = await db
    .select({ plan: tenants.plan, billingStatus: tenants.billingStatus, trialEndsAt: tenants.trialEndsAt })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  if (!row) return TenantPlan.FREE;
  // The single shared resolver: 'active' (paid) OR an unexpired trial → the
  // tenant's plan; everything else → free. Never re-derive this inline.
  return resolveEffectivePlan({
    plan: (row.plan as TenantPlan) ?? TenantPlan.FREE,
    billingStatus: (row.billingStatus as TenantBillingStatus) ?? TenantBillingStatus.NONE,
    trialEndsAt: row.trialEndsAt ?? null,
  });
}

export function buildPlanLimitsGuard(db: Db, env?: Env) {
  // A tenant with an active superadmin member is unlimited — the SAME operator
  // bypass the token-cap and cloud-run-count gates use ({@link tenantHasSuperadminMember}),
  // now extended to the plan resource caps (seats, projects, agent hosts) so an
  // operator/white-label account is never blocked by a plan limit. Best-effort:
  // any lookup failure falls through to the normal plan gate.
  const bypass = (tenantId: number): Promise<boolean> =>
    env ? tenantHasSuperadminMember(db, tenantId, env) : Promise.resolve(false);
  return {
    /** Returns an error payload if the tenant has reached their agentHost limit, otherwise null. */
    async checkAgentHostLimit(tenantId: number): Promise<LimitError | null> {
      if (await bypass(tenantId)) return null;
      const plan = await getTenantPlan(db, tenantId);
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
        currentPlan: plan,
      };
    },

    /** Returns an error payload if the tenant has reached their project limit, otherwise null. */
    async checkProjectLimit(tenantId: number): Promise<LimitError | null> {
      if (await bypass(tenantId)) return null;
      const plan = await getTenantPlan(db, tenantId);
      const [row] = await db
        .select({ total: count() })
        .from(projects)
        .where(eq(projects.tenantId, tenantId));
      const current = Number(row?.total ?? 0);
      if (canAddProject(plan, current)) return null;
      const { maxProjects } = getLimits(plan);
      return {
        error: `Plan limit reached: your ${plan} plan allows ${maxProjects} project${maxProjects === 1 ? '' : 's'}. Upgrade to add more.`,
        upgradeRequired: true,
        currentPlan: plan,
      };
    },

    /** Returns an error payload if the tenant has reached their seat limit, otherwise null.
     *  A PENDING invitation is a promised seat, so it counts toward the tally —
     *  otherwise a manager could queue many invites under the cap and have them
     *  all auto-accept past the limit on signup (see {@link seatCapacityForTenant}). */
    async checkSeatLimit(tenantId: number): Promise<LimitError | null> {
      if (await bypass(tenantId)) return null;
      const { plan, maxSeats, members, pendingInvites } = await seatCapacityForTenant(db, tenantId);
      const current = members + pendingInvites;
      if (canAddSeat(plan, current)) return null;
      return {
        error: `Plan limit reached: your ${plan} plan allows ${maxSeats} seat${maxSeats === 1 ? '' : 's'} (${members} member${members === 1 ? '' : 's'} + ${pendingInvites} pending invite${pendingInvites === 1 ? '' : 's'}). Upgrade to Teams to add more members.`,
        upgradeRequired: true,
        currentPlan: plan,
      };
    },
  };
}
