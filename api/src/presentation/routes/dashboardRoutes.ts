/**
 * Manager dashboard routes — /api/dashboard
 *
 * Provides aggregate data for the Builderforce manager portal home screen.
 * All endpoints require a tenant-scoped JWT and MANAGER+ role.
 *
 * GET /api/dashboard          — overview: pending approvals, token usage today, active agentHosts, recent workflows
 * GET /api/dashboard/usage    — detailed token usage breakdown (per-agentHost, per-model, selectable window)
 */

import { Hono } from 'hono';
import { and, count, desc, eq, gte, sql, sum } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import {
  approvals,
  agentHosts,
  llmUsageLog,
  projects,
  tenants,
  workflows,
} from '../../infrastructure/database/schema';
import { agentHostOnlineCondition } from '../../infrastructure/database/agentHostOnline';
import { getLimits } from '../../domain/tenant/PlanLimits';
import { resolveEffectivePlan } from '../../domain/tenant/effectivePlan';
import { TenantPlan, TenantRole, TenantBillingStatus } from '../../domain/shared/types';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
/** SQL CASE that classifies a usage row by who produced it (0096 columns). */
const USAGE_KIND = sql<'cloud' | 'on-prem' | 'web'>`
  case
    when ${llmUsageLog.agentHostId} is not null then 'on-prem'
    when ${llmUsageLog.cloudAgentRef} is not null or ${llmUsageLog.executionId} is not null then 'cloud'
    else 'web'
  end`;

/** Millicents (1/100000 USD) → USD. */
function mcToUsd(millicents: unknown): number {
  return Number(millicents ?? 0) / 100_000;
}

/**
 * Token + cost breakdown over the window, split by kind (cloud / on-prem / web),
 * by model, and by agent host. Cost is the authoritative `cost_usd_millicents`
 * stamped at write time (0097) — summed here, not re-priced from the catalog.
 */
async function buildUsageBreakdown(db: Db, tenantId: number, windowStart: Date) {
  const where = and(eq(llmUsageLog.tenantId, tenantId), gte(llmUsageLog.createdAt, windowStart));

  const [byKind, perModel, perAgentHost, perProject, totalRow] = await Promise.all([
    db.select({
      kind: USAGE_KIND,
      promptTokens: sum(llmUsageLog.promptTokens),
      completionTokens: sum(llmUsageLog.completionTokens),
      totalTokens: sum(llmUsageLog.totalTokens),
      costMc: sum(llmUsageLog.costUsdMillicents),
      requests: count(),
    }).from(llmUsageLog).where(where).groupBy(USAGE_KIND),

    db.select({
      model: llmUsageLog.model,
      totalTokens: sum(llmUsageLog.totalTokens),
      costMc: sum(llmUsageLog.costUsdMillicents),
      requests: count(),
    }).from(llmUsageLog).where(where).groupBy(llmUsageLog.model).orderBy(desc(sum(llmUsageLog.totalTokens))).limit(50),

    // Real per-agent-host breakdown (was a tenantId stand-in before 0096).
    db.select({
      agentHostId: llmUsageLog.agentHostId,
      totalTokens: sum(llmUsageLog.totalTokens),
      costMc: sum(llmUsageLog.costUsdMillicents),
      requests: count(),
    }).from(llmUsageLog).where(and(where, sql`${llmUsageLog.agentHostId} is not null`))
      .groupBy(llmUsageLog.agentHostId).orderBy(desc(sum(llmUsageLog.totalTokens))).limit(50),

    // Per-project spend (0103) — cost attributed to each project, the rollup
    // beneath the account total. Joined to projects for the display name.
    db.select({
      projectId: llmUsageLog.projectId,
      projectName: projects.name,
      totalTokens: sum(llmUsageLog.totalTokens),
      costMc: sum(llmUsageLog.costUsdMillicents),
      requests: count(),
    }).from(llmUsageLog)
      .leftJoin(projects, eq(projects.id, llmUsageLog.projectId))
      .where(and(where, sql`${llmUsageLog.projectId} is not null`))
      .groupBy(llmUsageLog.projectId, projects.name)
      .orderBy(desc(sum(llmUsageLog.costUsdMillicents))).limit(50),

    db.select({
      totalTokens: sum(llmUsageLog.totalTokens),
      totalRequests: count(),
      costMc: sum(llmUsageLog.costUsdMillicents),
    }).from(llmUsageLog).where(where),
  ]);

  return {
    totals: {
      tokens: Number(totalRow[0]?.totalTokens ?? 0),
      requests: Number(totalRow[0]?.totalRequests ?? 0),
      estimatedCostUsd: mcToUsd(totalRow[0]?.costMc),
    },
    byKind: byKind.map((k) => ({
      kind: k.kind,
      promptTokens: Number(k.promptTokens ?? 0),
      completionTokens: Number(k.completionTokens ?? 0),
      totalTokens: Number(k.totalTokens ?? 0),
      requests: Number(k.requests ?? 0),
      estimatedCostUsd: mcToUsd(k.costMc),
    })).sort((a, b) => b.totalTokens - a.totalTokens),
    perModel: perModel.map((m) => ({
      model: m.model,
      totalTokens: Number(m.totalTokens ?? 0),
      requests: Number(m.requests ?? 0),
      estimatedCostUsd: mcToUsd(m.costMc),
    })),
    perAgentHost: perAgentHost.map((h) => ({
      agentHostId: h.agentHostId,
      totalTokens: Number(h.totalTokens ?? 0),
      requests: Number(h.requests ?? 0),
      estimatedCostUsd: mcToUsd(h.costMc),
    })),
    perProject: perProject.map((p) => ({
      projectId: p.projectId,
      projectName: p.projectName ?? `Project ${p.projectId}`,
      totalTokens: Number(p.totalTokens ?? 0),
      requests: Number(p.requests ?? 0),
      estimatedCostUsd: mcToUsd(p.costMc),
    })),
  };
}

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
    ] = await Promise.all([
      // Pending approvals count
      db
        .select({ total: count() })
        .from(approvals)
        .where(and(eq(approvals.tenantId, tenantId), eq(approvals.status, 'pending'))),

      // AgentHost counts: total and online
      db
        .select({
          total: count(),
          online: sql<number>`count(*) filter (where ${agentHostOnlineCondition()})`,
        })
        .from(agentHosts)
        .where(and(eq(agentHosts.tenantId, tenantId), eq(agentHosts.status, 'active'))),

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
          agentHostId: workflows.agentHostId,
        })
        .from(workflows)
        .where(eq(workflows.tenantId, tenantId))
        .orderBy(desc(workflows.createdAt))
        .limit(10),

      // Tenant plan info
      db
        .select({ plan: tenants.plan, billingStatus: tenants.billingStatus, trialEndsAt: tenants.trialEndsAt })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1),
    ]);

    const billingStatus = tenantRow[0]?.billingStatus ?? 'none';
    const effectivePlan: TenantPlan = resolveEffectivePlan({
      plan: (tenantRow[0]?.plan ?? 'free') as TenantPlan,
      billingStatus: billingStatus as TenantBillingStatus,
      trialEndsAt: tenantRow[0]?.trialEndsAt ?? null,
    });
    const limits = getLimits(effectivePlan);

    const tokenUsedToday = Number(tokenUsageResult[0]?.total ?? 0);
    const dailyLimit = limits.tokenDailyLimit;

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
  // Cached read-through (60s): an aggregate scan over the append-heavy usage log
  // that doesn't need to be to-the-second. Keyed by tenant+window; the short TTL
  // bounds staleness without an invalidate-on-write hook (impractical for a
  // per-call append table).
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

    const payload = await getOrSetCached(
      c.env as Env,
      `dashboard-usage:v2:${tenantId}:${window}:${windowStart.toISOString().slice(0, 13)}`,
      () => buildUsageBreakdown(db, tenantId, windowStart),
      { kvTtlSeconds: 60, l1TtlMs: 30_000 },
    );

    return c.json({ window, windowStart: windowStart.toISOString(), ...payload });
  });

  return router;
}
