/**
 * Manager dashboard routes — /api/dashboard
 *
 * Provides aggregate data for the Builderforce manager portal home screen.
 * All endpoints require a tenant-scoped JWT and MANAGER+ role.
 *
 * GET /api/dashboard          — overview: pending approvals, token usage today, active claws, recent workflows
 * GET /api/dashboard/usage    — detailed token usage breakdown (per-claw, per-model, selectable window)
 */

import { Hono } from 'hono';
import { and, count, desc, eq, gte, sql, sum } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import {
  approvals,
  coderclawInstances,
  llmUsageLog,
  tenants,
  workflows,
} from '../../infrastructure/database/schema';
import { getLimits } from '../../domain/tenant/PlanLimits';
import { TenantPlan, TenantRole } from '../../domain/shared/types';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

export function createDashboardRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);
  router.use('*', requireRole(TenantRole.MANAGER));

  // ── GET /api/dashboard ───────────────────────────────────────────────────
  // Overview snapshot: pending approvals count, token usage today vs limit,
  // active + total claw counts, recent workflow statuses.
  router.get('/', async (c) => {
    const tenantId = c.get('tenantId') as number;

    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    // Run all queries in parallel
    const [
      pendingApprovalsResult,
      clawCountsResult,
      tokenUsageResult,
      recentWorkflowsResult,
      tenantRow,
    ] = await Promise.all([
      // Pending approvals count
      db
        .select({ total: count() })
        .from(approvals)
        .where(and(eq(approvals.tenantId, tenantId), eq(approvals.status, 'pending'))),

      // Claw counts: total and online
      db
        .select({
          total: count(),
          online: sql<number>`count(*) filter (where ${coderclawInstances.connectedAt} is not null)`,
        })
        .from(coderclawInstances)
        .where(and(eq(coderclawInstances.tenantId, tenantId), eq(coderclawInstances.status, 'active'))),

      // Token usage today
      db
        .select({ total: sum(llmUsageLog.totalTokens) })
        .from(llmUsageLog)
        .where(and(eq(llmUsageLog.tenantId, tenantId), gte(llmUsageLog.createdAt, todayStart))),

      // Last 10 workflows
      db
        .select({
          id: workflows.id,
          status: workflows.status,
          workflowType: workflows.workflowType,
          createdAt: workflows.createdAt,
          completedAt: workflows.completedAt,
          clawId: workflows.clawId,
        })
        .from(workflows)
        .where(eq(workflows.tenantId, tenantId))
        .orderBy(desc(workflows.createdAt))
        .limit(10),

      // Tenant plan info
      db
        .select({ plan: tenants.plan, billingStatus: tenants.billingStatus })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1),
    ]);

    const rawPlan = (tenantRow[0]?.plan ?? 'free') as TenantPlan;
    const billingStatus = tenantRow[0]?.billingStatus ?? 'none';
    const effectivePlan: TenantPlan = billingStatus === 'active' ? rawPlan : TenantPlan.FREE;
    const limits = getLimits(effectivePlan);

    const tokenUsedToday = Number(tokenUsageResult[0]?.total ?? 0);
    const dailyLimit = limits.tokenDailyLimit;

    return c.json({
      approvals: {
        pending: Number(pendingApprovalsResult[0]?.total ?? 0),
      },
      claws: {
        total: Number(clawCountsResult[0]?.total ?? 0),
        online: Number(clawCountsResult[0]?.online ?? 0),
      },
      tokens: {
        usedToday: tokenUsedToday,
        dailyLimit,
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
  // Detailed token usage breakdown.
  // Query params:
  //   window = "today" | "week" | "month"  (default: "today")
  router.get('/usage', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const window = c.req.query('window') ?? 'today';

    const windowStart = new Date();
    windowStart.setUTCHours(0, 0, 0, 0);
    if (window === 'week') {
      windowStart.setUTCDate(windowStart.getUTCDate() - 6);
    } else if (window === 'month') {
      windowStart.setUTCDate(1);
    }

    // Per-claw breakdown
    const perClaw = await db
      .select({
        clawId: llmUsageLog.tenantId, // approximation; real per-claw requires clawId on log
        model: llmUsageLog.model,
        totalTokens: sum(llmUsageLog.totalTokens),
        promptTokens: sum(llmUsageLog.promptTokens),
        completionTokens: sum(llmUsageLog.completionTokens),
        requests: count(),
      })
      .from(llmUsageLog)
      .where(and(eq(llmUsageLog.tenantId, tenantId), gte(llmUsageLog.createdAt, windowStart)))
      .groupBy(llmUsageLog.tenantId, llmUsageLog.model)
      .orderBy(desc(sum(llmUsageLog.totalTokens)))
      .limit(50);

    // Per-model summary
    const perModel = await db
      .select({
        model: llmUsageLog.model,
        totalTokens: sum(llmUsageLog.totalTokens),
        requests: count(),
      })
      .from(llmUsageLog)
      .where(and(eq(llmUsageLog.tenantId, tenantId), gte(llmUsageLog.createdAt, windowStart)))
      .groupBy(llmUsageLog.model)
      .orderBy(desc(sum(llmUsageLog.totalTokens)));

    const [total] = await db
      .select({ totalTokens: sum(llmUsageLog.totalTokens), totalRequests: count() })
      .from(llmUsageLog)
      .where(and(eq(llmUsageLog.tenantId, tenantId), gte(llmUsageLog.createdAt, windowStart)));

    return c.json({
      window,
      windowStart: windowStart.toISOString(),
      totals: {
        tokens: Number(total?.totalTokens ?? 0),
        requests: Number(total?.totalRequests ?? 0),
      },
      perModel,
      perClaw,
    });
  });

  return router;
}
