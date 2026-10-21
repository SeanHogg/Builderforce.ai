/**
 * Run anomalies as ISSUES — `run.anomaly` (the Evermind ML task catalog) over a
 * tenant's scored cloud runs, grouped by WHY each run was out of range.
 *
 * The detector is the engine's (`fitRunAnomaly`: robust z + EWMA, floored per metric)
 * and the feature scale is the engine's (`runAnomalyFeatures`) — nothing here re-derives
 * either. What this module decides is only how the answer is read:
 *
 *  - PREQUENTIAL: each run is scored against a detector fitted on the runs BEFORE it,
 *    never on a history that already contains it — "was this run outside the range of
 *    what came before", which is the question an operator acts on. The first
 *    `RUN_ANOMALY_TASK.train.minSamples` runs have no history and are not scored.
 *  - HIGH SIDE ONLY: robust z is two-sided, but a run that was unusually cheap, fast or
 *    clean is not an issue. The reason is the out-of-range metric that sits ABOVE the
 *    detector's own centre; a run out of range only on the low side is not flagged.
 *  - ISSUES, NOT RECORDS: flagged runs fold into one issue per reason metric, ranked by
 *    how many runs it hit, with the few worst runs as representative examples.
 *
 * Pure (no DB, no env) so the whole reading is unit-testable; `runAnomalyInsights.ts`
 * feeds it rows and caches the answer.
 */
import {
  fitRunAnomaly,
  runAnomalyFeatures,
  RUN_ANOMALY_METRICS,
  RUN_ANOMALY_TASK,
  type MlSample,
  type RunMetrics,
} from '@seanhogg/builderforce-memory-engine';
import { median } from '../shared/stats';

export type RunAnomalyMetric = (typeof RUN_ANOMALY_METRICS)[number];

/** One scored cloud run, in the units the person reads. */
export interface RunAnomalyRun extends RunMetrics {
  executionId: number;
  taskId: number | null;
  model: string;
  /** Epoch ms the run finished — the chronological order the detector walks. */
  at: number;
}

/** A representative flagged run. `typical` is the median of the runs before it — an estimate (≈). */
export interface RunAnomalyExample {
  executionId: number;
  taskId: number | null;
  model: string;
  at: string;
  value: number;
  typical: number;
  /** The detector's normalised score for this run (≥ 1 = anomalous). */
  score: number;
}

export interface RunAnomalyIssue {
  metric: RunAnomalyMetric;
  /** Flagged runs whose reason is this metric. */
  runs: number;
  /** Of the scored runs, in percent. */
  sharePct: number;
  /** Cost above typical across this issue's runs (USD) — the money the outliers took. */
  excessCostUsd: number;
  examples: RunAnomalyExample[];
}

export interface RunAnomalySummary {
  /** Runs read (after the timing filter). */
  runs: number;
  /** Runs that had enough history to be scored. */
  scored: number;
  flagged: number;
  /** History a run needs before it is scored — the task's own `minSamples`. */
  minRuns: number;
  issues: RunAnomalyIssue[];
}

/** How many of each issue's worst runs ride along as examples. */
export const RUN_ANOMALY_EXAMPLES = 3;
/** History each prequential fit sees, newest first — bounds the per-run fit. */
export const RUN_ANOMALY_HISTORY = 200;

const MIN_RUNS = RUN_ANOMALY_TASK.train?.minSamples ?? 5;

function metricValue(run: RunMetrics, metric: RunAnomalyMetric): number {
  switch (metric) {
    case 'cost': return run.costUsd;
    case 'duration': return run.durationMs;
    case 'toolFailures': return run.toolFailures;
  }
}

/** Detect and group. `runs` must be chronological (oldest first). */
export function summarizeRunAnomalies(runs: readonly RunAnomalyRun[]): RunAnomalySummary {
  const samples: MlSample[] = runs.map((r) => ({ x: Float32Array.from(runAnomalyFeatures(r)), y: 0 }));
  const byMetric = new Map<RunAnomalyMetric, { runs: number; excess: number; examples: RunAnomalyExample[] }>();
  let scored = 0;
  let flagged = 0;

  for (let i = MIN_RUNS; i < runs.length; i++) {
    const from = Math.max(0, i - RUN_ANOMALY_HISTORY);
    const detector = fitRunAnomaly(samples.slice(from, i));
    const x = samples[i]!.x;
    scored++;
    const score = detector.predict(x).scores[0] ?? 0;
    if (score < 1) continue;
    // The reason: the out-of-range metric ABOVE the detector's centre that is furthest out.
    let worst: { metric: RunAnomalyMetric; level: number } | null = null;
    for (const [m, e] of detector.explain(x).entries()) {
      const level = Math.max(e.population, e.trend);
      if (level < 1 || x[m]! <= detector.population.center[m]!) continue;
      if (!worst || level > worst.level) worst = { metric: e.metric, level };
    }
    if (!worst) continue;
    const reason = worst.metric;
    flagged++;
    const run = runs[i]!;
    const prior = runs.slice(from, i);
    const typical = median(prior.map((r) => metricValue(r, reason))) ?? 0;
    const typicalCost = median(prior.map((r) => r.costUsd)) ?? 0;
    const bucket = byMetric.get(reason) ?? { runs: 0, excess: 0, examples: [] };
    bucket.runs++;
    bucket.excess += Math.max(0, run.costUsd - typicalCost);
    bucket.examples.push({
      executionId: run.executionId,
      taskId: run.taskId,
      model: run.model,
      at: new Date(run.at).toISOString(),
      value: metricValue(run, reason),
      typical,
      score,
    });
    byMetric.set(reason, bucket);
  }

  const issues: RunAnomalyIssue[] = [...byMetric.entries()]
    .map(([metric, b]) => ({
      metric,
      runs: b.runs,
      sharePct: scored > 0 ? Math.round((b.runs / scored) * 1000) / 10 : 0,
      excessCostUsd: Math.round(b.excess * 100) / 100,
      examples: b.examples.sort((a, c) => c.score - a.score).slice(0, RUN_ANOMALY_EXAMPLES),
    }))
    .sort((a, b) => b.runs - a.runs || b.excessCostUsd - a.excessCostUsd);

  return { runs: runs.length, scored, flagged, minRuns: MIN_RUNS, issues };
}
