/**
 * Run anomalies lens — the tenant's scored cloud runs read through `run.anomaly`
 * (`runAnomalyIssues.ts`), served by `GET /api/insights/run-anomalies`.
 *
 * The inputs live on two databases: cost and tool failures on `run_model_outcomes`
 * (the operational endpoint, `runTelemetryDatabase`), the run's wall-clock on core
 * `executions`. Each side is read from its own handle and joined in memory by
 * execution id — the cross-database rule. Only LIVE parent runs with both timestamps
 * are read: client runs carry no execution (no duration to judge), rehearsals and
 * sub-agent children are not runs of their own (`liveExecution`).
 *
 * Cached through the canonical read-through cache, keyed on the run-outcome ledger's
 * version token (`outcomesVersionKey`) — the run scorer bumps it whenever a run lands,
 * so a new run re-reads rather than waiting out the TTL.
 */
import { and, desc, eq, gte, inArray, isNotNull } from 'drizzle-orm';
import { getCacheVersion, getOrSetCached, outcomesVersionKey } from '../../infrastructure/cache/readThroughCache';
import type { Db } from '../../infrastructure/database/connection';
import { executions, runModelOutcomes } from '../../infrastructure/database/schema';
import { DAY_MS } from '../../domain/shared/time';
import { liveExecution } from '../rehearsal/executionMode';
import { runTelemetryDatabase } from '../shared/runTelemetryDatabase';
import { summarizeRunAnomalies, type RunAnomalyRun, type RunAnomalySummary } from './runAnomalyIssues';
import type { Env } from '../../env';

/** The most recent scored runs a window reads. Past this the lens is a sample (≈). */
export const RUN_ANOMALY_ROW_LIMIT = 1000;
/** Execution ids per `IN (…)` read on core. */
const ID_CHUNK = 500;

/** Version-invalidated, so the TTL is only a backstop. */
const TTL = { kvTtlSeconds: 600, l1TtlMs: 30_000 };

export interface RunAnomalyInsights extends RunAnomalySummary {
  windowDays: number;
  /** The window held more scored runs than were read — every count is a sample. */
  sampled: boolean;
}

/** Read the window's runs, oldest first, with cost, duration and tool failures. */
async function readRuns(db: Db, tenantId: number, days: number, projectId: number | undefined): Promise<{ runs: RunAnomalyRun[]; sampled: boolean }> {
  const since = new Date(Date.now() - days * DAY_MS);
  const outcomes = await runTelemetryDatabase(db)
    .select({
      executionId: runModelOutcomes.executionId,
      taskId: runModelOutcomes.taskId,
      model: runModelOutcomes.resolvedModel,
      costUsdMillicents: runModelOutcomes.costUsdMillicents,
      toolErrors: runModelOutcomes.toolErrors,
    })
    .from(runModelOutcomes)
    .where(and(
      eq(runModelOutcomes.tenantId, tenantId),
      ...(projectId != null ? [eq(runModelOutcomes.projectId, projectId)] : []),
      gte(runModelOutcomes.createdAt, since),
      isNotNull(runModelOutcomes.executionId),
    ))
    .orderBy(desc(runModelOutcomes.createdAt))
    .limit(RUN_ANOMALY_ROW_LIMIT);

  const ids = outcomes.flatMap((o) => (o.executionId != null ? [o.executionId] : []));
  const timing = new Map<number, { startedAt: Date; completedAt: Date }>();
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const rows = await db
      .select({ id: executions.id, startedAt: executions.startedAt, completedAt: executions.completedAt })
      .from(executions)
      .where(and(eq(executions.tenantId, tenantId), inArray(executions.id, ids.slice(i, i + ID_CHUNK)), liveExecution()));
    for (const r of rows) if (r.startedAt && r.completedAt) timing.set(r.id, { startedAt: r.startedAt, completedAt: r.completedAt });
  }

  const runs: RunAnomalyRun[] = [];
  for (const o of outcomes) {
    const t = o.executionId != null ? timing.get(o.executionId) : undefined;
    // These are cloud runs (execution_id set), whose cost the scorer always writes; a NULL cost would be
    // unknown, not free, and a run with no cost cannot be placed on the cost distribution, so it is left out.
    if (!t || o.costUsdMillicents === null) continue;
    runs.push({
      executionId: o.executionId!,
      taskId: o.taskId,
      model: o.model,
      at: t.completedAt.getTime(),
      costUsd: o.costUsdMillicents / 100_000,
      durationMs: Math.max(0, t.completedAt.getTime() - t.startedAt.getTime()),
      toolFailures: o.toolErrors ?? 0,
    });
  }
  runs.sort((a, b) => a.at - b.at);
  return { runs, sampled: outcomes.length === RUN_ANOMALY_ROW_LIMIT };
}

/** Uncached: read the window and read it through `run.anomaly`. */
export async function computeRunAnomalies(db: Db, tenantId: number, days: number, projectId?: number): Promise<RunAnomalyInsights> {
  const { runs, sampled } = await readRuns(db, tenantId, days, projectId);
  return { windowDays: days, sampled, ...summarizeRunAnomalies(runs) };
}

/** The lens read — cached, invalidated whenever a scored run lands. */
export async function getRunAnomalies(db: Db, env: Env, tenantId: number, days: number, projectId?: number): Promise<RunAnomalyInsights> {
  const ver = await getCacheVersion(env, outcomesVersionKey(tenantId));
  return getOrSetCached(
    env,
    `insights:runanomaly:t:${tenantId}:d:${days}:p:${projectId ?? 0}:v:${ver}`,
    () => computeRunAnomalies(db, tenantId, days, projectId),
    TTL,
  );
}
