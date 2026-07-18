import { apiRequest, apiRequestText } from './apiClient';

/**
 * EMP insight lenses client (cross-team benchmarking, delay taxonomy, dataset
 * export). Mirrors the canonical `*Api.ts` pattern — thin typed wrappers over
 * `apiRequest` / `apiRequestText`.
 */

// ── EMP-5 cross-team benchmarking ─────────────────────────────────────────────
export type CrossTeamMetricKey = 'throughput' | 'avg_cycle_time_hours' | 'rework_rate_pct' | 'effectiveness';

export interface TeamMetricValue {
  metric: CrossTeamMetricKey;
  value: number | null;
  percentile: number | null;
  higherIsBetter: boolean;
}
export interface TeamBenchmarkRow {
  teamId: number;
  teamName: string;
  memberCount: number;
  completed: number;
  metrics: TeamMetricValue[];
  overallPercentile: number | null;
}
export interface CrossTeamBenchmarkResult {
  windowDays: number;
  teamCount: number;
  teams: TeamBenchmarkRow[];
}

// ── EMP-9 delay taxonomy ──────────────────────────────────────────────────────
export type DelayReasonCode =
  | 'blocked_dependency' | 'awaiting_review' | 'scope_change'
  | 'unclear_requirements' | 'external' | 'capacity' | 'other';

export const DELAY_REASON_CODES: DelayReasonCode[] = [
  'blocked_dependency', 'awaiting_review', 'scope_change',
  'unclear_requirements', 'external', 'capacity', 'other',
];

export interface DelayReasonBucket {
  reasonCode: DelayReasonCode;
  label: string;
  taskCount: number;
  manualCount: number;
  inferredCount: number;
  avgDwellHours: number | null;
}
export interface DelayTaxonomyResult {
  windowDays: number;
  taggedTasks: number;
  manualTags: number;
  inferredTasks: number;
  reasons: DelayReasonBucket[];
}

export type ExportDataset = 'dora' | 'finance' | 'allocation' | 'benchmarking';
export type ExportFormat = 'csv' | 'html';

export const empInsightsApi = {
  crossTeam: (days = 30, projectId?: number | null): Promise<CrossTeamBenchmarkResult> =>
    apiRequest<CrossTeamBenchmarkResult>(`/api/insights/benchmarking/cross-team?days=${days}${projectId != null ? `&projectId=${projectId}` : ''}`),

  delayTaxonomy: (days = 90, projectId?: number | null): Promise<DelayTaxonomyResult> =>
    apiRequest<DelayTaxonomyResult>(`/api/insights/delay-taxonomy?days=${days}${projectId != null ? `&projectId=${projectId}` : ''}`),

  tagDelay: (taskId: number, reasonCode: DelayReasonCode, notes?: string): Promise<unknown> =>
    apiRequest(`/api/insights/delay-taxonomy`, {
      method: 'POST', body: JSON.stringify({ taskId, reasonCode, notes }),
    }),

  clearDelay: (taskId: number): Promise<void> =>
    apiRequest<void>(`/api/insights/delay-taxonomy/${taskId}`, { method: 'DELETE' }),

  /** Fetch an export as text (CSV or HTML) so the caller can trigger a download. */
  exportDataset: (dataset: ExportDataset, format: ExportFormat, days = 30, projectId?: number | null): Promise<string> =>
    apiRequestText(`/api/insights/export?dataset=${dataset}&format=${format}&days=${days}${projectId != null ? `&projectId=${projectId}` : ''}`),
};

/** Trigger a browser download of an already-fetched export string. */
export function downloadExport(text: string, dataset: string, format: ExportFormat): void {
  const type = format === 'html' ? 'text/html' : 'text/csv';
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${dataset}-${new Date().toISOString().slice(0, 10)}.${format}`;
  a.click();
  URL.revokeObjectURL(url);
}
