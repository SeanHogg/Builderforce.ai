/**
 * Manager dashboard routes — /api/dashboard
 *
 * Provides aggregate data for the Builderforce manager portal home screen.
 * All endpoints require a tenant-scoped JWT and MANAGER+ role.
 *
 * GET /api/dashboard          — overview: pending approvals, token usage today, active agentHosts, recent workflows
 * GET /api/dashboard/usage    — detailed token usage breakdown (per-agentHost, per-model, selectable window)
 *
 * Naming — five "dashboard" paths, five distinct resources (none serves another's
 * data; the near-identical names are history, kept because they are public paths):
 *   /api/dashboard            the manager HOME snapshot + usage attribution (computed)
 *   /api/dashboards           SAVED, editable KPI dashboards and their widgets
 *   /api/dashboard-pins       one member's pinned insight widgets
 *   /api/runtime/dashboard    execution status totals per agent host (live console)
 *   /api/governance/stakeholder-alignment/projects/:id/dashboard
 *                             one project's stakeholder-alignment summary
 */

import { Hono } from 'hono';
import { and, count, desc, eq, notInArray, sql } from 'drizzle-orm';
import { SELF_OWNED_ACTION_TYPES } from '../../domain/approval/selfOwned';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { approvals, agentHosts, workflows } from '../../infrastructure/database/schema';
import { agentHostOnlineCondition } from '../../infrastructure/database/agentHostOnline';
import { TenantPlan, TenantRole } from '../../domain/shared/types';
import { effectivePlanOf, loadTenantPlanRow } from '../../application/tenant/tenantPlanSnapshot';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { cachedUsage, namedWindowStart } from '../../application/llm/usageQuery';
import { buildUsageAttribution } from '../../application/llm/usageAttribution';
import { sumTenantTextTokens } from '../../application/llm/tokenUsage';
import { resolveTenantTokenLimits } from '../../application/llm/tenantTokenAvailability';

export function createDashboardRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);
  router.use('*', requireRole(TenantRole.MANAGER));

  // ── GET /api/dashboard ───────────────────────────────────────────────────
  // Overview snapshot: pending approvals count, token usage today vs limit,
  // active + total agentHost counts, recent workflow statuses.
  router.get('/', async (c) => {
    const tenantId = c.get('tenantId') as number;

    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    // Run all queries in parallel
    const [
      pendingApprovalsResult,
      agentHostCountsResult,
      tokenUsageResult,
      recentWorkflowsResult,
      tenantRow,
      tokenLimits,
    ] = await Promise.all([
      // Pending approvals count
      db
        .select({ total: count() })
        .from(approvals)
        // Someone's own desktop steps (self-owned) are not the team's queue.
        .where(and(eq(approvals.tenantId, tenantId), eq(approvals.status, 'pending'), notInArray(approvals.actionType, [...SELF_OWNED_ACTION_TYPES]))),

      // AgentHost counts: total and online
      db
        .select({
          total: count(),
          online: sql<number>`count(*) filter (where ${agentHostOnlineCondition()})`,
        })
        .from(agentHosts)
        .where(and(eq(agentHosts.tenantId, tenantId), eq(agentHosts.status, 'active'))),

      // Token usage today — THE plan-allowance counter (cache-weighted, billable rows
      // only), so the "% of daily limit" shown here is the number the gateway gate
      // enforces. It used to be a raw SUM(total_tokens), which counted image rows and
      // free own-machine BYO rows the gate exempts, so a tenant could read 100% here
      // and still have budget.
      sumTenantTextTokens(db, tenantId, todayStart),

      // Last 10 workflows
      db
        .select({
          id: workflows.id,
          status: workflows.status,
          workflowType: workflows.workflowType,
          createdAt: workflows.createdAt,
          completedAt: workflows.completedAt,
          agentHostId: workflows.agentHostId,
        })
        .from(workflows)
        .where(eq(workflows.tenantId, tenantId))
        .orderBy(desc(workflows.createdAt))
        .limit(10),

      // Tenant plan info — the cached snapshot, one shared resolver
      loadTenantPlanRow(c.env, tenantId, db),

      // The daily cap the gateway ENFORCES — override, credits and the superadmin
      // bypass applied (getLimits(plan) alone ignores all three). -1 = unlimited.
      resolveTenantTokenLimits(db, tenantId, { actingUserId: c.get('userId') ?? null }, c.env as Env),
    ]);

    const billingStatus = tenantRow?.billingStatus ?? 'none';
    const effectivePlan: TenantPlan = effectivePlanOf(tenantRow);
    const tokenUsedToday = tokenUsageResult;
    const dailyLimit = tokenLimits.dailyLimit;

    return c.json({
      approvals: {
        pending: Number(pendingApprovalsResult[0]?.total ?? 0),
      },
      agentHosts: {
        total: Number(agentHostCountsResult[0]?.total ?? 0),
        online: Number(agentHostCountsResult[0]?.online ?? 0),
      },
      tokens: {
        usedToday: tokenUsedToday,
        dailyLimit,
        unlimited: dailyLimit <= 0,
        percentUsed: dailyLimit > 0 ? Math.round((tokenUsedToday / dailyLimit) * 100) : 0,
      },
      plan: {
        effective: effectivePlan,
        billingStatus,
      },
      recentWorkflows: recentWorkflowsResult,
    });
  });

  // ── GET /api/dashboard/usage ─────────────────────────────────────────────
  // Detailed token + estimated-cost usage breakdown, split CLOUD vs ON-PREM vs
  // WEB (now that llm_usage_log carries the agent attribution columns, 0096).
  // Query params:
  //   window = "today" | "week" | "month"  (default: "today")
  //
  // A thin adapter: the attribution is application/llm/usageAttribution over THE
  // usage query use case, cached via its shared short-TTL read-through (keyed by the
  // window START, so a window rolling over never serves the previous day's totals).
  router.get('/usage', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const window = c.req.query('window') ?? 'today';
    const windowStart = namedWindowStart(window);
    const payload = await cachedUsage(
      c.env as Env,
      `dashboard:${tenantId}:${windowStart.toISOString()}`,
      () => buildUsageAttribution(db, tenantId, windowStart),
    );
    return c.json({ window, windowStart: windowStart.toISOString(), ...payload });
  });

  return router;
}
