/**
 * QaQualityService — the per-project "quality trend" rollup.
 *
 * The collectors already exist; this is the role-based lens on top (the QA / Tech-
 * Lead view). It joins three signals already written on every run into one trend:
 *
 *   • Escaped defects — qa_findings (runtime errors the Agentic Tester caught in the
 *     running app), by severity + day.
 *   • Caught defects — pull_requests.build_status='failure' (defects stopped at the
 *     build), by day.
 *   • Producing model/agent quality — run_model_outcomes (the only place in the
 *     stack that scores "did this AI approach actually ship"): per resolved_model
 *     and per cloud_agent_ref, the merge / CI-green / degraded rates and avg score.
 *     A low ci-green rate or score is the model that PRODUCES the defects.
 *
 * Tenant + project + window scoped, behind the read-through cache. Findings (the
 * QA-owned write) bump the version token for instant invalidation; PR/outcome
 * changes age out via the 5-min KV TTL backstop. With no project selected the
 * rollup is workspace-wide (all of the tenant's projects).
 */

import { and, desc, eq, gte, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { getCacheVersion, getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { pullRequests, qaFindings, runModelOutcomes } from '../../infrastructure/database/schema';

const DAY_MS = 86_400_000;
const TOP_N = 12;

/** Version token for a tenant's quality rollups — bumped when a finding lands so
 *  the trend re-reads immediately (PR/outcome drift is covered by the TTL). */
export function QA_QUALITY_VERSION_KEY(tenantId: number): string {
  return `qa-quality:tenant:${tenantId}`;
}

export interface QaModelQuality {
  /** resolved_model or cloud_agent_ref. */
  key: string;
  runs: number;
  avgScore: number;       // 0..1 mean run_model_outcomes.score
  mergedRate: number;     // 0..1 share merged
  ciGreenRate: number;    // 0..1 share CI-green
  degradedRate: number;   // 0..1 share degraded
  /** Runs that ended in a CI-failing / unmerged state — defects caught at build. */
  defects: number;
  /** Runtime findings (escaped defects) attributed to this producer — the most
   *  recent in-window merged run before each finding in the same project. */
  escapedDefects: number;
}

export interface QaQualityTrend {
  windowDays: number;
  range: { from: string; to: string };
  /** Composite 0..1 project quality (mean run outcome score; null when no scored runs). */
  qualityScore: number | null;
  findings: {
    total: number;
    open: number;
    bySeverity: Record<string, number>;
    byType: Record<string, number>;
    autoRouted: number;
    /** Escaped defects with no in-window merged run to attribute them to. */
    escapedUnattributed: number;
  };
  ci: {
    builds: number;
    failures: number;
    failureRate: number;  // 0..1
  };
  /** Which model produced the work — quality descending defects first. */
  byModel: QaModelQuality[];
  /** Which agent produced the work. */
  byAgent: QaModelQuality[];
  /** Daily series: findings detected + CI failures + mean outcome score that day. */
  daily: Array<{ date: string; findings: number; ciFailures: number; avgScore: number | null }>;
}

/** Roll the raw (key, score, merged, ciGreen, degraded) rows into per-producer
 *  quality, folding in escaped-defect attribution (findings per producer). */
export function summarizeProducers(
  rows: Array<{ key: string | null; runs: number; avgScore: number; merged: number; ciGreen: number; degraded: number }>,
  escapedByKey: Record<string, number> = {},
): QaModelQuality[] {
  return rows
    .filter((r) => r.key)
    .map((r) => {
      const runs = Number(r.runs) || 0;
      const merged = Number(r.merged) || 0;
      const ciGreen = Number(r.ciGreen) || 0;
      const degraded = Number(r.degraded) || 0;
      const key = r.key as string;
      return {
        key,
        runs,
        avgScore: Number(r.avgScore) || 0,
        mergedRate: runs > 0 ? merged / runs : 0,
        ciGreenRate: runs > 0 ? ciGreen / runs : 0,
        degradedRate: runs > 0 ? degraded / runs : 0,
        // A completed run that did not go CI-green shipped a defect.
        defects: runs - ciGreen,
        escapedDefects: escapedByKey[key] ?? 0,
      };
    })
    // Worst producers first (most total defects caught+escaped, then lowest score).
    .sort((a, b) => (b.defects + b.escapedDefects) - (a.defects + a.escapedDefects) || a.avgScore - b.avgScore);
}

/**
 * Attribute escaped defects (runtime findings) to the producer most likely to have
 * shipped them: the most recent *in-window merged* run in the same project that
 * completed at or before the finding. A coarse, project-scoped blame (not route-
 * precise — see the gap register) computed set-based via a LATERAL join, so it is
 * one query, not an N+1 per finding.
 */
async function attributeEscapedDefects(
  db: Db,
  tenantId: number,
  projectId: number | null,
  since: Date,
): Promise<{ byModel: Record<string, number>; byAgent: Record<string, number>; attributed: number }> {
  const projectFilter = projectId != null ? sql`AND f.project_id = ${projectId}` : sql``;
  const res = await db.execute(sql`
    SELECT o.model AS model, o.agent AS agent, count(*)::int AS c
    FROM qa_findings f
    JOIN LATERAL (
      SELECT r.resolved_model AS model, r.cloud_agent_ref AS agent
      FROM run_model_outcomes r
      WHERE r.project_id = f.project_id
        AND r.merged = true
        AND r.created_at <= f.created_at
        AND r.created_at >= ${since}
      ORDER BY r.created_at DESC
      LIMIT 1
    ) o ON true
    WHERE f.tenant_id = ${tenantId}
      AND f.created_at >= ${since}
      ${projectFilter}
    GROUP BY o.model, o.agent
  `);
  const rows = ((res as unknown as { rows?: Array<{ model: string | null; agent: string | null; c: number }> }).rows) ?? [];
  const byModel: Record<string, number> = {};
  const byAgent: Record<string, number> = {};
  let attributed = 0;
  for (const r of rows) {
    const c = Number(r.c) || 0;
    attributed += c;
    if (r.model) byModel[r.model] = (byModel[r.model] ?? 0) + c;
    if (r.agent) byAgent[r.agent] = (byAgent[r.agent] ?? 0) + c;
  }
  return { byModel, byAgent, attributed };
}

export async function computeProjectQualityTrend(
  db: Db,
  tenantId: number,
  projectId: number | null,
  days: number,
): Promise<QaQualityTrend> {
  const since = new Date(Date.now() - days * DAY_MS);

  const findingScope = and(
    eq(qaFindings.tenantId, tenantId),
    gte(qaFindings.createdAt, since),
    ...(projectId != null ? [eq(qaFindings.projectId, projectId)] : []),
  );
  const prScope = and(
    eq(pullRequests.tenantId, tenantId),
    gte(pullRequests.createdAt, since),
    isNotNull(pullRequests.buildStatus),
    ...(projectId != null ? [eq(pullRequests.projectId, projectId)] : []),
  );
  const outcomeScope = and(
    eq(runModelOutcomes.tenantId, tenantId),
    gte(runModelOutcomes.createdAt, since),
    ...(projectId != null ? [eq(runModelOutcomes.projectId, projectId)] : []),
  );

  const [
    findingTotals, findingBySeverity, findingByType,
    ciTotals,
    byModelRows, byAgentRows,
    overallScore,
    findingDaily, ciDaily, scoreDaily,
    escaped,
  ] = await Promise.all([
    db.select({
      total: sql<number>`count(*)::int`,
      open: sql<number>`count(*) filter (where ${qaFindings.status} = 'open')::int`,
      autoRouted: sql<number>`count(*) filter (where ${qaFindings.autoRouted})::int`,
    }).from(qaFindings).where(findingScope),
    db.select({ k: qaFindings.severity, c: sql<number>`count(*)::int` }).from(qaFindings).where(findingScope).groupBy(qaFindings.severity),
    db.select({ k: qaFindings.type, c: sql<number>`count(*)::int` }).from(qaFindings).where(findingScope).groupBy(qaFindings.type),
    db.select({
      builds: sql<number>`count(*)::int`,
      failures: sql<number>`count(*) filter (where ${pullRequests.buildStatus} = 'failure')::int`,
    }).from(pullRequests).where(prScope),
    db.select({
      key: runModelOutcomes.resolvedModel,
      runs: sql<number>`count(*)::int`,
      avgScore: sql<number>`coalesce(avg(${runModelOutcomes.score}), 0)`,
      merged: sql<number>`count(*) filter (where ${runModelOutcomes.merged})::int`,
      ciGreen: sql<number>`count(*) filter (where ${runModelOutcomes.ciGreen})::int`,
      degraded: sql<number>`count(*) filter (where ${runModelOutcomes.degraded})::int`,
    }).from(runModelOutcomes).where(outcomeScope).groupBy(runModelOutcomes.resolvedModel).orderBy(desc(sql`count(*)`)).limit(TOP_N),
    db.select({
      key: runModelOutcomes.cloudAgentRef,
      runs: sql<number>`count(*)::int`,
      avgScore: sql<number>`coalesce(avg(${runModelOutcomes.score}), 0)`,
      merged: sql<number>`count(*) filter (where ${runModelOutcomes.merged})::int`,
      ciGreen: sql<number>`count(*) filter (where ${runModelOutcomes.ciGreen})::int`,
      degraded: sql<number>`count(*) filter (where ${runModelOutcomes.degraded})::int`,
    }).from(runModelOutcomes).where(and(outcomeScope, isNotNull(runModelOutcomes.cloudAgentRef))).groupBy(runModelOutcomes.cloudAgentRef).orderBy(desc(sql`count(*)`)).limit(TOP_N),
    db.select({ avg: sql<number | null>`avg(${runModelOutcomes.score})`, n: sql<number>`count(*)::int` }).from(runModelOutcomes).where(outcomeScope),
    db.select({ d: sql<string>`to_char(date_trunc('day', ${qaFindings.createdAt}), 'YYYY-MM-DD')`, c: sql<number>`count(*)::int` })
      .from(qaFindings).where(findingScope).groupBy(sql`date_trunc('day', ${qaFindings.createdAt})`),
    db.select({ d: sql<string>`to_char(date_trunc('day', ${pullRequests.createdAt}), 'YYYY-MM-DD')`, c: sql<number>`count(*) filter (where ${pullRequests.buildStatus} = 'failure')::int` })
      .from(pullRequests).where(prScope).groupBy(sql`date_trunc('day', ${pullRequests.createdAt})`),
    db.select({ d: sql<string>`to_char(date_trunc('day', ${runModelOutcomes.createdAt}), 'YYYY-MM-DD')`, avg: sql<number | null>`avg(${runModelOutcomes.score})` })
      .from(runModelOutcomes).where(outcomeScope).groupBy(sql`date_trunc('day', ${runModelOutcomes.createdAt})`),
    attributeEscapedDefects(db, tenantId, projectId, since),
  ]);

  const bySeverity: Record<string, number> = {};
  for (const r of findingBySeverity) bySeverity[r.k] = Number(r.c);
  const byType: Record<string, number> = {};
  for (const r of findingByType) byType[r.k] = Number(r.c);

  const builds = Number(ciTotals[0]?.builds ?? 0);
  const failures = Number(ciTotals[0]?.failures ?? 0);
  const scoredRuns = Number(overallScore[0]?.n ?? 0);
  const findingsTotal = Number(findingTotals[0]?.total ?? 0);

  // Stitch the three daily series onto one date axis.
  const dayMap = new Map<string, { findings: number; ciFailures: number; avgScore: number | null }>();
  for (const r of findingDaily) dayMap.set(r.d, { findings: Number(r.c), ciFailures: 0, avgScore: null });
  for (const r of ciDaily) {
    const e = dayMap.get(r.d) ?? { findings: 0, ciFailures: 0, avgScore: null };
    e.ciFailures = Number(r.c); dayMap.set(r.d, e);
  }
  for (const r of scoreDaily) {
    const e = dayMap.get(r.d) ?? { findings: 0, ciFailures: 0, avgScore: null };
    e.avgScore = r.avg != null ? Number(r.avg) : null; dayMap.set(r.d, e);
  }
  const daily = [...dayMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, ...v }));

  return {
    windowDays: days,
    range: { from: since.toISOString(), to: new Date().toISOString() },
    qualityScore: scoredRuns > 0 && overallScore[0]?.avg != null ? Number(overallScore[0].avg) : null,
    findings: {
      total: findingsTotal,
      open: Number(findingTotals[0]?.open ?? 0),
      bySeverity,
      byType,
      autoRouted: Number(findingTotals[0]?.autoRouted ?? 0),
      escapedUnattributed: Math.max(0, findingsTotal - escaped.attributed),
    },
    ci: { builds, failures, failureRate: builds > 0 ? failures / builds : 0 },
    byModel: summarizeProducers(byModelRows, escaped.byModel),
    byAgent: summarizeProducers(byAgentRows, escaped.byAgent),
    daily,
  };
}

/** Cached read-through wrapper. Version-token keyed (findings bump it); 5-min TTL backstop. */
export async function getProjectQualityTrend(
  env: Env,
  db: Db,
  tenantId: number,
  projectId: number | null,
  days: number,
): Promise<QaQualityTrend> {
  const version = await getCacheVersion(env, QA_QUALITY_VERSION_KEY(tenantId));
  const key = `qa-quality:rollup:tenant:${tenantId}:p:${projectId ?? 'all'}:v:${version}:days:${days}`;
  return getOrSetCached(env, key, () => computeProjectQualityTrend(db, tenantId, projectId, days), { kvTtlSeconds: 300 });
}
