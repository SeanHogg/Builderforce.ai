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
  tenants,
  workflows,
} from '../../infrastructure/database/schema';
import { agentHostOnlineCondition } from '../../infrastructure/database/agentHostOnline';
import { getLimits } from '../../domain/tenant/PlanLimits';
import { TenantPlan, TenantRole } from '../../domain/shared/types';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { getCatalogCached } from '../../application/llm/modelCatalog';

/** SQL CASE that classifies a usage row by who produced it (0096 columns). */
const USAGE_KIND = sql<'cloud' | 'on-prem' | 'web'>`
  case
    when ${llmUsageLog.agentHostId} is not null then 'on-prem'
    when ${llmUsageLog.cloudAgentRef} is not null or ${llmUsageLog.executionId} is not null then 'cloud'
    else 'web'
  end`;

/** Estimated USD cost of a token split using catalog per-token prices. */
function estimateCostUsd(priceByModel: Map<string, { prompt: number; completion: number }>, model: string, promptTokens: number, completionTokens: number): number {
  const p = priceByModel.get(model);
  if (!p) return 0;
  return promptTokens * p.prompt + completionTokens * p.completion;
}

/**
 * Token + estimated-cost breakdown over the window, split by kind (cloud /
 * on-prem / web), by model, and by agent host. Cost is derived from catalog
 * per-token prices (estimate, not an authoritative billed amount — there is no
 * cost ledger yet; see gap register).
 */
async function buildUsageBreakdown(db: Db, env: Env, tenantId: number, windowStart: Date) {
  const where = and(eq(llmUsageLog.tenantId, tenantId), gte(llmUsageLog.createdAt, windowStart));

  const [byKindModel, perModel, perAgentHost, totalRow, catalog] = await Promise.all([
    // (kind, model) so cost can be priced per model then rolled up by kind.
    db.select({
      kind: USAGE_KIND,
      model: llmUsageLog.model,
      promptTokens: sum(llmUsageLog.promptTokens),
      completionTokens: sum(llmUsageLog.completionTokens),
      totalTokens: sum(llmUsageLog.totalTokens),
      requests: count(),
    }).from(llmUsageLog).where(where).groupBy(USAGE_KIND, llmUsageLog.model),

    db.select({
      model: llmUsageLog.model,
      totalTokens: sum(llmUsageLog.totalTokens),
      promptTokens: sum(llmUsageLog.promptTokens),
      completionTokens: sum(llmUsageLog.completionTokens),
      requests: count(),
    }).from(llmUsageLog).where(where).groupBy(llmUsageLog.model).orderBy(desc(sum(llmUsageLog.totalTokens))).limit(50),

    // Real per-agent-host breakdown (was a tenantId stand-in before 0096).
    db.select({
      agentHostId: llmUsageLog.agentHostId,
      totalTokens: sum(llmUsageLog.totalTokens),
      promptTokens: sum(llmUsageLog.promptTokens),
      completionTokens: sum(llmUsageLog.completionTokens),
      requests: count(),
    }).from(llmUsageLog).where(and(where, sql`${llmUsageLog.agentHostId} is not null`))
      .groupBy(llmUsageLog.agentHostId).orderBy(desc(sum(llmUsageLog.totalTokens))).limit(50),

    db.select({ totalTokens: sum(llmUsageLog.totalTokens), totalRequests: count() }).from(llmUsageLog).where(where),

    getCatalogCached(env).catch(() => []),
  ]);

  const priceByModel = new Map(catalog.map((m) => [m.id, m.pricing]));

  // Roll (kind, model) rows up to per-kind tokens + estimated cost.
  const kinds = new Map<string, { kind: string; promptTokens: number; completionTokens: number; totalTokens: number; requests: number; estimatedCostUsd: number }>();
  let totalCost = 0;
  for (const r of byKindModel) {
    const promptTokens = Number(r.promptTokens ?? 0);
    const completionTokens = Number(r.completionTokens ?? 0);
    const cost = estimateCostUsd(priceByModel, r.model, promptTokens, completionTokens);
    totalCost += cost;
    const cur = kinds.get(r.kind) ?? { kind: r.kind, promptTokens: 0, completionTokens: 0, totalTokens: 0, requests: 0, estimatedCostUsd: 0 };
    cur.promptTokens += promptTokens;
    cur.completionTokens += completionTokens;
    cur.totalTokens += Number(r.totalTokens ?? 0);
    cur.requests += Number(r.requests ?? 0);
    cur.estimatedCostUsd += cost;
    kinds.set(r.kind, cur);
  }

  // drizzle sum()/count() come back as strings — coerce to numbers for the client.
  const perModelPriced = perModel.map((m) => ({
    model: m.model,
    totalTokens: Number(m.totalTokens ?? 0),
    requests: Number(m.requests ?? 0),
    estimatedCostUsd: estimateCostUsd(priceByModel, m.model, Number(m.promptTokens ?? 0), Number(m.completionTokens ?? 0)),
  }));

  const perAgentHostNum = perAgentHost.map((h) => ({
    agentHostId: h.agentHostId,
    totalTokens: Number(h.totalTokens ?? 0),
    promptTokens: Number(h.promptTokens ?? 0),
    completionTokens: Number(h.completionTokens ?? 0),
    requests: Number(h.requests ?? 0),
  }));

  return {
    totals: {
      tokens: Number(totalRow[0]?.totalTokens ?? 0),
      requests: Number(totalRow[0]?.totalRequests ?? 0),
      estimatedCostUsd: totalCost,
    },
    byKind: [...kinds.values()].sort((a, b) => b.totalTokens - a.totalTokens),
    perModel: perModelPriced,
    perAgentHost: perAgentHostNum,
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
      `dashboard-usage:v1:${tenantId}:${window}:${windowStart.toISOString().slice(0, 13)}`,
      () => buildUsageBreakdown(db, c.env as Env, tenantId, windowStart),
      { kvTtlSeconds: 60, l1TtlMs: 30_000 },
    );

    return c.json({ window, windowStart: windowStart.toISOString(), ...payload });
  });

  return router;
}
