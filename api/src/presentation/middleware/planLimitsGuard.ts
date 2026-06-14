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

import { count, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import {
  tenants,
  agentHosts,
  tenantMembers,
  projects,
} from '../../infrastructure/database/schema';
import { canAddAgentHost, canAddProject, canAddSeat, getLimits } from '../../domain/tenant/PlanLimits';
import { TenantPlan } from '../../domain/shared/types';

interface LimitError {
  error: string;
  upgradeRequired: true;
  currentPlan: string;
}

async function getTenantPlan(db: Db, tenantId: number): Promise<TenantPlan> {
  const [row] = await db
    .select({ plan: tenants.plan, billingStatus: tenants.billingStatus })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  if (!row) return TenantPlan.FREE;
  // Only active billing counts
  if (row.billingStatus !== 'active') return TenantPlan.FREE;
  return (row.plan as TenantPlan) ?? TenantPlan.FREE;
}

export function buildPlanLimitsGuard(db: Db) {
  return {
    /** Returns an error payload if the tenant has reached their agentHost limit, otherwise null. */
    async checkAgentHostLimit(tenantId: number): Promise<LimitError | null> {
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

    /**
     * Returns an error payload if a Pro-only feature is used by a non-paid plan,
     * otherwise null. The single gate for entitlement-gated features (e.g. Voice
     * Cloning) — callers pass a human feature name for the 402 message instead of
     * re-deriving "is this tenant paid" themselves.
     */
    async checkProFeature(tenantId: number, featureName: string): Promise<LimitError | null> {
      const plan = await getTenantPlan(db, tenantId);
      if (plan !== TenantPlan.FREE) return null;
      return {
        error: `${featureName} requires a paid plan. Upgrade to unlock it.`,
        upgradeRequired: true,
        currentPlan: plan,
      };
    },

    /** Returns an error payload if the tenant has reached their seat limit, otherwise null. */
    async checkSeatLimit(tenantId: number): Promise<LimitError | null> {
      const plan = await getTenantPlan(db, tenantId);
      const [row] = await db
        .select({ total: count() })
        .from(tenantMembers)
        .where(eq(tenantMembers.tenantId, tenantId));
      const current = Number(row?.total ?? 0);
      if (canAddSeat(plan, current)) return null;
      const { maxSeats } = getLimits(plan);
      return {
        error: `Plan limit reached: your ${plan} plan allows ${maxSeats} seat${maxSeats === 1 ? '' : 's'}. Upgrade to Teams to add more members.`,
        upgradeRequired: true,
        currentPlan: plan,
      };
    },
  };
}
