/**
 * Architecture analysis client (`/api/repo-analysis`).
 *
 * Launched from a project: creates an "Architecture Analysis" Task on the board
 * and kicks off the cloud analysis run. The result is written back as an
 * architecture PRD. A repo must be mapped first — otherwise the API returns 409
 * { error: 'no_repo' }, which the caller handles inline (no global error toast).
 */

import { apiRequest } from './apiClient';

export interface RunArchitectureAnalysisResult {
  taskId: number;
  executionId: number | null;
  runId: string;
}

export async function runArchitectureAnalysis(projectId: number | string): Promise<RunArchitectureAnalysisResult> {
  return apiRequest<RunArchitectureAnalysisResult>(`/api/repo-analysis/projects/${projectId}/architect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
    expectedErrors: [409],
  });
}

/** One artifact of the six-part architecture report. */
export type ArchitectureArtifactKind =
  | 'diagnostic'
  | 'recommendation'
  | 'business'
  | 'arch_4plus1'
  | 'antipatterns'
  | 'principles';

/**
 * A project's most recent analysis run and what repairing it would cover.
 * `retryableKinds` is empty while the run is still moving, so a surface can gate
 * the retry affordance on that one field alone.
 */
export interface ArchitectureRunSummary {
  runId: string;
  projectId: number;
  status: string;
  stage: string | null;
  progress: number;
  retryableKinds: ArchitectureArtifactKind[];
  /** Withheld sections this plan does not cover — an upgrade, not a retry. */
  lockedKinds: ArchitectureArtifactKind[];
  createdAt: string | null;
  finishedAt: string | null;
}

/** The project's last architecture run, or null if it has never been analysed. */
export async function fetchLatestArchitectureRun(
  projectId: number | string,
): Promise<ArchitectureRunSummary | null> {
  const { run } = await apiRequest<{ run: ArchitectureRunSummary | null }>(
    `/api/repo-analysis/projects/${projectId}/latest-run`,
  );
  return run ?? null;
}

/**
 * Re-run only the sections a finished analysis failed on (plus any it withheld
 * that the plan now covers). Far cheaper than a full re-run: the evidence is
 * reused, so it costs the model calls for the broken sections only.
 *
 * 409 (`run_in_progress`) and 400 (`nothing_to_retry`) are expected answers the
 * caller renders inline, not global error toasts.
 */
export async function retryArchitectureAnalysis(
  runId: string,
): Promise<{ runId: string; kinds: ArchitectureArtifactKind[] }> {
  return apiRequest<{ runId: string; kinds: ArchitectureArtifactKind[] }>(
    `/api/repo-analysis/runs/${runId}/retry`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
      expectedErrors: [400, 409],
    },
  );
}
