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
import { and, count, desc, eq, gte, inArray, sql, sum } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import {
  approvals,
  agentHosts,
  llmUsageLog,
  projects,
  projectRepositories,
  segments,
  tasks,
  teams,
  teamMembers,
  tenants,
  users,
  workflows,
} from '../../infrastructure/database/schema';
import { agentHostOnlineCondition } from '../../infrastructure/database/agentHostOnline';
import { getLimits } from '../../domain/tenant/PlanLimits';
import { TenantPlan, TenantRole } from '../../domain/shared/types';
import { effectivePlanOf, loadTenantPlanRow } from '../../application/tenant/tenantPlanSnapshot';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { USAGE_KIND } from '../../application/llm/usageSource';
import { resolveUsageDatabase } from '../../application/llm/usageLedger';
import { millicentsToUsd } from '../../domain/shared/money';

/** Millicents (1/100000 USD) → USD. */
function mcToUsd(millicents: unknown): number {
  return millicentsToUsd(millicents as number | null | undefined);
}

/**
 * Token + cost breakdown over the window, split by kind (cloud / on-prem / web),
 * by model, and by agent host. Cost is the authoritative `cost_usd_millicents`
 * stamped at write time (0097) — summed here, not re-priced from the catalog.
 */
/** The aggregate every breakdown groups: tokens, cost and request count. */
const usageTotals = () => ({
  totalTokens: sum(llmUsageLog.totalTokens),
  costMc: sum(llmUsageLog.costUsdMillicents),
  requests: count(),
});

interface UsageTotals { totalTokens: number; costMc: number; requests: number }

function totalsOf(row: { totalTokens: unknown; costMc: unknown; requests: unknown }): UsageTotals {
  return { totalTokens: Number(row.totalTokens ?? 0), costMc: Number(row.costMc ?? 0), requests: Number(row.requests ?? 0) };
}

function addTotals(into: UsageTotals, t: UsageTotals): void {
  into.totalTokens += t.totalTokens;
  into.costMc += t.costMc;
  into.requests += t.requests;
}

/** Largest spend first, capped at the 50 rows the single-database queries returned. */
function topByCost<T extends UsageTotals>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.costMc - a.costMc).slice(0, 50);
}

/** An `IN (…)` read in bounded chunks, so a month of task ids stays under the driver's parameter limit. */
async function readInChunks<K, R>(ids: readonly K[], read: (chunk: K[]) => PromiseLike<R[]>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < ids.length; i += 500) out.push(...(await read(ids.slice(i, i + 500))));
  return out;
}

/**
 * `usageDb` is the database that OWNS `llm_usage_log` ({@link resolveUsageDatabase}) —
 * the operational one in production. The names these rollups display (projects,
 * workspaces, users, teams, repos) live in the core `db`, and the two are different
 * Neon accounts, so the usage side is aggregated there by id and the names are joined
 * here. These queries used to join both in one statement against the core database,
 * whose `llm_usage_log` stopped receiving rows at the split — every figure was frozen.
 */
async function buildUsageBreakdown(db: Db, usageDb: Db, tenantId: number, windowStart: Date) {
  const where = and(eq(llmUsageLog.tenantId, tenantId), gte(llmUsageLog.createdAt, windowStart));
  // Team membership matches the heterogeneous member ref (human→userId,
  // cloud_agent→cloudAgentRef, host_agent→agentHostId-as-text).
  const memberRef = sql<string | null>`coalesce(${llmUsageLog.userId}, ${llmUsageLog.cloudAgentRef}, cast(${llmUsageLog.agentHostId} as text))`;

  const [byKind, perModel, perAgentHost, byProject, byUser, byMemberRef, byTask, totalRow] = await Promise.all([
    usageDb.select({
      kind: USAGE_KIND,
      promptTokens: sum(llmUsageLog.promptTokens),
      completionTokens: sum(llmUsageLog.completionTokens),
      ...usageTotals(),
    }).from(llmUsageLog).where(where).groupBy(USAGE_KIND),

    usageDb.select({ model: llmUsageLog.model, ...usageTotals() })
      .from(llmUsageLog).where(where).groupBy(llmUsageLog.model).orderBy(desc(sum(llmUsageLog.totalTokens))).limit(50),

    // Real per-agent-host breakdown (was a tenantId stand-in before 0096).
    usageDb.select({ agentHostId: llmUsageLog.agentHostId, ...usageTotals() })
      .from(llmUsageLog).where(and(where, sql`${llmUsageLog.agentHostId} is not null`))
      .groupBy(llmUsageLog.agentHostId).orderBy(desc(sum(llmUsageLog.totalTokens))).limit(50),

    // Per-project spend (0103), uncapped: the workspace rollup below needs every project.
    usageDb.select({ projectId: llmUsageLog.projectId, ...usageTotals() })
      .from(llmUsageLog).where(and(where, sql`${llmUsageLog.projectId} is not null`))
      .groupBy(llmUsageLog.projectId),

    // Per-user spend — the human / SDK caller that initiated the request (nullable
    // for fully autonomous agent rows). Jellyfish-parity "by individual".
    usageDb.select({ userId: llmUsageLog.userId, ...usageTotals() })
      .from(llmUsageLog).where(and(where, sql`${llmUsageLog.userId} is not null`))
      .groupBy(llmUsageLog.userId).orderBy(desc(sum(llmUsageLog.costUsdMillicents))).limit(50),

    usageDb.select({ memberRef, ...usageTotals() })
      .from(llmUsageLog).where(and(where, sql`${memberRef} is not null`)).groupBy(memberRef),

    usageDb.select({ taskId: llmUsageLog.taskId, ...usageTotals() })
      .from(llmUsageLog).where(and(where, sql`${llmUsageLog.taskId} is not null`))
      .groupBy(llmUsageLog.taskId),

    usageDb.select({
      totalTokens: sum(llmUsageLog.totalTokens),
      totalRequests: count(),
      costMc: sum(llmUsageLog.costUsdMillicents),
    }).from(llmUsageLog).where(where),
  ]);

  const projectIds = byProject.flatMap((r) => (r.projectId == null ? [] : [r.projectId]));
  const userIds = byUser.flatMap((r) => (r.userId == null ? [] : [r.userId]));
  const memberRefs = byMemberRef.flatMap((r) => (r.memberRef == null ? [] : [r.memberRef]));
  const taskIds = byTask.flatMap((r) => (r.taskId == null ? [] : [r.taskId]));

  const [projectRows, userRows, membershipRows, taskRepoRows] = await Promise.all([
    projectIds.length === 0 ? [] : db
      .select({ id: projects.id, name: projects.name, segmentId: projects.segmentId })
      .from(projects).where(and(eq(projects.tenantId, tenantId), inArray(projects.id, projectIds))),
    userIds.length === 0 ? [] : db
      .select({ id: users.id, displayName: users.displayName, email: users.email })
      .from(users).where(inArray(users.id, userIds)),
    memberRefs.length === 0 ? [] : db
      .select({ teamId: teams.id, teamName: teams.name, memberRef: teamMembers.memberRef })
      .from(teamMembers)
      .innerJoin(teams, and(eq(teams.id, teamMembers.teamId), eq(teams.tenantId, tenantId)))
      .where(inArray(teamMembers.memberRef, memberRefs)),
    readInChunks(taskIds, (chunk) => db
      .select({ id: tasks.id, repoId: tasks.explicitRepoId })
      .from(tasks)
      .where(and(eq(tasks.tenantId, tenantId), inArray(tasks.id, chunk), sql`${tasks.explicitRepoId} is not null`))),
  ]);

  const segmentIds = [...new Set(projectRows.flatMap((p) => (p.segmentId == null ? [] : [p.segmentId])))];
  const repoIds = [...new Set(taskRepoRows.flatMap((t) => (t.repoId == null ? [] : [t.repoId])))];
  const [segmentRows, repoRows] = await Promise.all([
    segmentIds.length === 0 ? [] : db
      .select({ id: segments.id, name: segments.displayName })
      .from(segments).where(inArray(segments.id, segmentIds)),
    repoIds.length === 0 ? [] : db
      .select({ id: projectRepositories.id, owner: projectRepositories.owner, repo: projectRepositories.repo })
      .from(projectRepositories).where(inArray(projectRepositories.id, repoIds)),
  ]);

  const projectById = new Map(projectRows.map((p) => [p.id, p]));
  const perProject = topByCost(byProject.flatMap((r) => (r.projectId == null ? [] : [{
    projectId: r.projectId,
    projectName: projectById.get(r.projectId)?.name ?? null,
    ...totalsOf(r),
  }])));

  // Per-SEGMENT (workspace) spend — the dimension above project. `llm_usage_log`
  // carries no segment column, and deliberately shouldn't: a segment is a property of
  // the PROJECT, so a copy on every usage row would go stale the moment a project moves
  // between workspaces. Rows with no project are excluded rather than bucketed as
  // "unknown" — a workspace rollup that included untargeted spend would overstate it.
  const segmentName = new Map(segmentRows.map((s) => [s.id, s.name]));
  const bySegment = new Map<(typeof segmentIds)[number], UsageTotals>();
  for (const r of byProject) {
    const segmentId = r.projectId == null ? null : projectById.get(r.projectId)?.segmentId ?? null;
    if (segmentId == null) continue;
    const acc = bySegment.get(segmentId) ?? { totalTokens: 0, costMc: 0, requests: 0 };
    addTotals(acc, totalsOf(r));
    bySegment.set(segmentId, acc);
  }
  const perSegment = topByCost([...bySegment].map(([segmentId, t]) => ({
    segmentId, segmentName: segmentName.get(segmentId) ?? null, ...t,
  })));

  const userById = new Map(userRows.map((u) => [u.id, u]));
  const perUser = byUser.flatMap((r) => (r.userId == null ? [] : [{
    userId: r.userId,
    userName: userById.get(r.userId)?.displayName ?? null,
    userEmail: userById.get(r.userId)?.email ?? null,
    ...totalsOf(r),
  }]));

  // A usage row counts once per team its member ref belongs to; refs in no tenant
  // team are excluded. Jellyfish-parity "by team".
  const totalsByRef = new Map(byMemberRef.map((r) => [r.memberRef, totalsOf(r)]));
  const byTeam = new Map<string, { teamId: (typeof membershipRows)[number]['teamId']; teamName: string } & UsageTotals>();
  for (const m of membershipRows) {
    const t = totalsByRef.get(m.memberRef);
    if (!t) continue;
    const key = String(m.teamId);
    const acc = byTeam.get(key) ?? { teamId: m.teamId, teamName: m.teamName, totalTokens: 0, costMc: 0, requests: 0 };
    addTotals(acc, t);
    byTeam.set(key, acc);
  }
  const perTeam = topByCost([...byTeam.values()]);

  // Per-repo spend — the explicit repo of the originating task
  // (tasks.explicitRepoId → project_repositories). Jellyfish-parity "by repo".
  const repoByTask = new Map(taskRepoRows.map((t) => [t.id, t.repoId]));
  const repoById = new Map(repoRows.map((r) => [r.id, r]));
  const byRepo = new Map<string, { repoId: string; owner: string; repo: string } & UsageTotals>();
  for (const r of byTask) {
    const repoId = r.taskId == null ? null : repoByTask.get(r.taskId) ?? null;
    const repo = repoId == null ? undefined : repoById.get(repoId);
    if (!repo) continue;
    const acc = byRepo.get(repo.id) ?? { repoId: repo.id, owner: repo.owner, repo: repo.repo, totalTokens: 0, costMc: 0, requests: 0 };
    addTotals(acc, totalsOf(r));
    byRepo.set(repo.id, acc);
  }
  const perRepo = topByCost([...byRepo.values()]);

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
    /** Spend rolled up to the WORKSPACE (segment) each project belongs to. The tier
     *  above `perProject`, so a multi-workspace tenant can see where its AI spend
     *  actually lands without summing projects by hand. */
    perSegment: perSegment.map((sg) => ({
      segmentId: sg.segmentId,
      segmentName: sg.segmentName ?? 'Workspace',
      totalTokens: Number(sg.totalTokens ?? 0),
      requests: Number(sg.requests ?? 0),
      estimatedCostUsd: mcToUsd(sg.costMc),
    })),
    perUser: perUser.map((u) => ({
      userId: u.userId,
      userName: u.userName ?? u.userEmail ?? `User ${u.userId}`,
      totalTokens: Number(u.totalTokens ?? 0),
      requests: Number(u.requests ?? 0),
      estimatedCostUsd: mcToUsd(u.costMc),
    })),
    perTeam: perTeam.map((t) => ({
      teamId: t.teamId,
      teamName: t.teamName,
      totalTokens: Number(t.totalTokens ?? 0),
      requests: Number(t.requests ?? 0),
      estimatedCostUsd: mcToUsd(t.costMc),
    })),
    perRepo: perRepo.map((r) => ({
      repoId: r.repoId,
      repoLabel: `${r.owner}/${r.repo}`,
      totalTokens: Number(r.totalTokens ?? 0),
      requests: Number(r.requests ?? 0),
      estimatedCostUsd: mcToUsd(r.costMc),
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

      // Token usage today — read where the ledger is written (operational in production).
      resolveUsageDatabase(c.env as Env, db)
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

      // Tenant plan info — the cached snapshot, one shared resolver
      loadTenantPlanRow(c.env, tenantId, db),
    ]);

    const billingStatus = tenantRow?.billingStatus ?? 'none';
    const effectivePlan: TenantPlan = effectivePlanOf(tenantRow);
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
      `dashboard-usage:v5:${tenantId}:${window}:${windowStart.toISOString().slice(0, 13)}`,
      () => buildUsageBreakdown(db, resolveUsageDatabase(c.env as Env, db), tenantId, windowStart),
      { kvTtlSeconds: 60, l1TtlMs: 30_000 },
    );

    return c.json({ window, windowStart: windowStart.toISOString(), ...payload });
  });

  return router;
}
