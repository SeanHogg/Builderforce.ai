/**
 * Per-(action_type, model) quality-drift report over the eval-scored outcomes
 * ledger.
 *
 * WHY IT MOVED. This function lived in `presentation/routes/evalRoutes.ts`, and
 * two application modules imported it FROM there — `alerts/metricEvaluators.ts`
 * and `eval/runEvalDriftSweep.ts`. That is the layering rule inverted: a cron
 * sweep and an alert evaluator depended on an HTTP route module, so deleting or
 * renaming a route would have broken a scheduled job, and the route file could
 * never be treated as a leaf. It belongs beside `driftMonitor.ts`, which it is
 * the tenant-scoped reader for.
 */
import { and, desc, eq, gte, isNotNull } from 'drizzle-orm';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { runModelOutcomes } from '../../infrastructure/database/schema';
import { detectGroupDrift, type ScoredSample } from './driftMonitor';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

/** Last 60 days of eval-scored outcomes — enough for a baseline-vs-recent split. */
const WINDOW_MS = 60 * 24 * 60 * 60 * 1000;

/** Loads recent eval-scored runs for a tenant and computes per-group drift. */
export async function buildTenantDriftReport(db: Db, tenantId: number) {
  const sinceMs = Date.now() - WINDOW_MS;
  const rows = await db
    .select({
      actionType: runModelOutcomes.actionType,
      model: runModelOutcomes.resolvedModel,
      faithfulness: runModelOutcomes.faithfulness,
      answerRelevance: runModelOutcomes.answerRelevance,
      createdAt: runModelOutcomes.createdAt,
    })
    .from(runModelOutcomes)
    .where(
      and(
        eq(runModelOutcomes.tenantId, tenantId),
        isNotNull(runModelOutcomes.faithfulness),
        gte(runModelOutcomes.createdAt, new Date(sinceMs)),
      ),
    )
    .orderBy(desc(runModelOutcomes.createdAt))
    .limit(2000);

  // Drift the overall quality proxy (mean of faithfulness + answer-relevance).
  const samples: ScoredSample[] = rows.map((r) => ({
    group: `${r.actionType}:${r.model}`,
    score: ((r.faithfulness ?? 0) + (r.answerRelevance ?? 0)) / 2,
    ts: r.createdAt instanceof Date ? r.createdAt.getTime() : Number(new Date(r.createdAt as never)),
  }));

  const groups = detectGroupDrift(samples, { minSamples: 8 });
  return {
    generatedAt: new Date().toISOString(),
    totalScored: rows.length,
    drifting: groups.filter((g) => g.result.drifted),
    groups,
  };
}

/** The cached read the HTTP surface serves: a scan over an append-only ledger
 *  that need not be to-the-second. The sweep and the alert evaluator call the
 *  uncached function above — a scheduled job wants the current number, not a
 *  five-minute-old one. */
export function getTenantDriftReport(db: Db, env: Env, tenantId: number) {
  return getOrSetCached(
    env,
    `eval-drift:v1:${tenantId}`,
    () => buildTenantDriftReport(db, tenantId),
    { kvTtlSeconds: 300, l1TtlMs: 60_000 },
  );
}
