import { apiRequest } from './apiClient';

/**
 * Run anomalies — client mirror of api/src/application/insights/runAnomalyInsights.ts
 * (`GET /api/insights/run-anomalies`).
 *
 * The tenant's scored cloud runs read through Evermind's `run.anomaly` task: runs that
 * cost, took or failed far outside the range of the runs before them, grouped into one
 * issue per reason. `typical` is the median of the earlier runs — an estimate, shown ≈.
 *
 * Manager + premium-insights gated server-side, like the AI Effectiveness lens it
 * renders inside.
 */

/** Index-aligned with the engine's `RUN_ANOMALY_METRICS`. */
export type RunAnomalyMetric = 'cost' | 'duration' | 'toolFailures';

export interface RunAnomalyExample {
  executionId: number;
  taskId: number | null;
  model: string;
  /** ISO time the run finished. */
  at: string;
  /** cost: USD · duration: ms · toolFailures: count. */
  value: number;
  typical: number;
  score: number;
}

export interface RunAnomalyIssue {
  metric: RunAnomalyMetric;
  runs: number;
  sharePct: number;
  excessCostUsd: number;
  examples: RunAnomalyExample[];
}

export interface RunAnomalyInsights {
  windowDays: number;
  /** More runs than were read — every count is a sample. */
  sampled: boolean;
  runs: number;
  scored: number;
  flagged: number;
  /** History a run needs before it is scored. */
  minRuns: number;
  issues: RunAnomalyIssue[];
}

export const runAnomalyApi = {
  get: (days = 30, projectId?: number | null): Promise<RunAnomalyInsights> => {
    const q = new URLSearchParams({ days: String(days) });
    if (projectId != null) q.set('projectId', String(projectId));
    return apiRequest<RunAnomalyInsights>(`/api/insights/run-anomalies?${q.toString()}`);
  },
};
