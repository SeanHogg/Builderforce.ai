/**
 * The account-wide usage ATTRIBUTION behind `GET /api/dashboard/usage` — spend split
 * by source (cloud / on-prem / web), model, agent host, project, workspace, user,
 * team and repo over a named window.
 *
 * Moved out of `dashboardRoutes.ts`, which issued eight ledger statements inline.
 * Every figure now comes from THE usage query use case (`usageQuery.ts`); this module
 * adds only what that one cannot know: the display names, and the two rollups that
 * hang off a PROJECT or TASK property rather than a ledger column (workspace, repo).
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import {
  projects,
  projectRepositories,
  segments,
  tasks,
  teams,
  teamMembers,
  users,
} from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { millicentsToUsd } from '../../domain/shared/money';
import { readUsageBreakdown, readUsageTotals, tenantScope, type UsageFilter } from './usageQuery';

/** Millicents (1/100000 USD) → USD. */
function mcToUsd(millicents: unknown): number {
  return millicentsToUsd(millicents as number | null | undefined);
}

/** The three figures every attribution row carries. */
interface SpendTotals { totalTokens: number; costMc: number; requests: number }

function spendOf(row: { totalTokens: number; costMc: number; requests: number }): SpendTotals {
  return { totalTokens: row.totalTokens, costMc: row.costMc, requests: row.requests };
}

function addTotals(into: SpendTotals, t: SpendTotals): void {
  into.totalTokens += t.totalTokens;
  into.costMc += t.costMc;
  into.requests += t.requests;
}

/** Largest spend first, capped at the 50 rows the single-database queries returned. */
function topByCost<T extends SpendTotals>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.costMc - a.costMc).slice(0, 50);
}

/** An `IN (…)` read in bounded chunks, so a month of task ids stays under the driver's parameter limit. */
async function readInChunks<K, R>(ids: readonly K[], read: (chunk: K[]) => PromiseLike<R[]>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < ids.length; i += 500) out.push(...(await read(ids.slice(i, i + 500))));
  return out;
}

/**
 * The usage side is aggregated on the ledger's own database (inside the use case) by
 * id, and the names these rollups display (projects, workspaces, users, teams, repos)
 * are read from the core `db` — the two are different Neon accounts, so this cannot
 * be one JOIN. Used to be one statement against the core database, whose
 * `llm_usage_log` stopped receiving rows at the split, so every figure was frozen.
 */
export async function buildUsageAttribution(db: Db, tenantId: number, windowStart: Date) {
  const f: UsageFilter = { scope: tenantScope(tenantId), since: windowStart };
  // Every figure is one call into THE usage query use case; this module only names
  // the ids those breakdowns return. Requests are SUM(calls) there — this page used
  // COUNT(*), which under-reported every day the grain rollup had folded.
  const [byKind, perModel, perAgentHost, byProject, byUser, byMemberRef, byTask, totalRow] = await Promise.all([
    readUsageBreakdown(db, f, 'kind', { orderBy: 'tokens' }),
    readUsageBreakdown(db, f, 'model', { orderBy: 'tokens', limit: 50 }),
    readUsageBreakdown(db, f, 'agentHost', { orderBy: 'tokens', limit: 50 }),
    // Uncapped: the workspace rollup below needs every project.
    readUsageBreakdown(db, f, 'project'),
    // The human / SDK caller that initiated the request (null for fully autonomous
    // agent rows, which are dropped). Jellyfish-parity "by individual".
    readUsageBreakdown(db, f, 'user', { orderBy: 'cost', limit: 50, skipNull: true }),
    // Team membership matches the heterogeneous member ref (human→userId,
    // cloud_agent→cloudAgentRef, host_agent→agentHostId-as-text).
    readUsageBreakdown(db, f, 'memberRef'),
    readUsageBreakdown(db, f, 'task'),
    readUsageTotals(db, f),
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
      .from(segments).where(scopedToTenant(segments, tenantId, inArray(segments.id, segmentIds))),
    repoIds.length === 0 ? [] : db
      .select({ id: projectRepositories.id, owner: projectRepositories.owner, repo: projectRepositories.repo })
      .from(projectRepositories).where(scopedToTenant(projectRepositories, tenantId, inArray(projectRepositories.id, repoIds))),
  ]);

  const projectById = new Map(projectRows.map((p) => [p.id, p]));
  const perProject = topByCost(byProject.flatMap((r) => (r.projectId == null ? [] : [{
    projectId: r.projectId,
    projectName: projectById.get(r.projectId)?.name ?? null,
    ...spendOf(r),
  }])));

  // Per-SEGMENT (workspace) spend — the dimension above project. `llm_usage_log`
  // carries no segment column, and deliberately shouldn't: a segment is a property of
  // the PROJECT, so a copy on every usage row would go stale the moment a project moves
  // between workspaces. Rows with no project are excluded rather than bucketed as
  // "unknown" — a workspace rollup that included untargeted spend would overstate it.
  const segmentName = new Map(segmentRows.map((s) => [s.id, s.name]));
  const bySegment = new Map<(typeof segmentIds)[number], SpendTotals>();
  for (const r of byProject) {
    const segmentId = r.projectId == null ? null : projectById.get(r.projectId)?.segmentId ?? null;
    if (segmentId == null) continue;
    const acc = bySegment.get(segmentId) ?? { totalTokens: 0, costMc: 0, requests: 0 };
    addTotals(acc, spendOf(r));
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
    ...spendOf(r),
  }]));

  // A usage row counts once per team its member ref belongs to; refs in no tenant
  // team are excluded. Jellyfish-parity "by team".
  const totalsByRef = new Map(byMemberRef.map((r) => [r.memberRef, spendOf(r)]));
  const byTeam = new Map<string, { teamId: (typeof membershipRows)[number]['teamId']; teamName: string } & SpendTotals>();
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
  const byRepo = new Map<string, { repoId: string; owner: string; repo: string } & SpendTotals>();
  for (const r of byTask) {
    const repoId = r.taskId == null ? null : repoByTask.get(r.taskId) ?? null;
    const repo = repoId == null ? undefined : repoById.get(repoId);
    if (!repo) continue;
    const acc = byRepo.get(repo.id) ?? { repoId: repo.id, owner: repo.owner, repo: repo.repo, totalTokens: 0, costMc: 0, requests: 0 };
    addTotals(acc, spendOf(r));
    byRepo.set(repo.id, acc);
  }
  const perRepo = topByCost([...byRepo.values()]);

  return {
    totals: {
      tokens: totalRow.totalTokens,
      requests: totalRow.requests,
      estimatedCostUsd: mcToUsd(totalRow.costMc),
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
