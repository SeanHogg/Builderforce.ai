import { apiRequest } from './apiClient';
import type { Project360 } from '@seanhogg/builderforce-brain-ui';

/**
 * Project 360 data client — the SAME cached rollup the VS Code panel reads
 * (`GET /api/projects/:id/360`), so the web surface and the editor render one
 * source of truth. `fresh` bypasses the endpoint's short-TTL cache for an explicit
 * refresh (live "who's working").
 */
export function getProject360(projectId: number, opts?: { fresh?: boolean }): Promise<Project360> {
  const qs = opts?.fresh ? '?fresh=1' : '';
  return apiRequest<Project360>(`/api/projects/${projectId}/360${qs}`);
}

export type { Project360 } from '@seanhogg/builderforce-brain-ui';

/** One project's AI spend over a window — `GET /api/projects/:id/spend`. */
export interface ProjectSpend {
  projectId: number;
  window: 'today' | 'week' | 'month';
  windowStart: string;
  /** Platform-funded cost. BYO rows record 0 by design — see `byoTokens`. */
  costUsd: number;
  totalTokens: number;
  /** Tokens paid for by the tenant's OWN connected provider account. Reported
   *  separately so a BYO-heavy project doesn't read as free. */
  byoTokens: number;
  requests: number;
  topModels: Array<{ model: string; totalTokens: number; costUsd: number }>;
}

/**
 * What this project's AI work cost.
 *
 * A dedicated endpoint rather than a slice of `/api/dashboard/usage`: that payload
 * carries every project, user, team and repo in the account, which is a lot to load
 * to answer one question about one project.
 */
export function getProjectSpend(
  projectId: number,
  window: ProjectSpend['window'] = 'month',
): Promise<ProjectSpend> {
  return apiRequest<ProjectSpend>(`/api/projects/${projectId}/spend?window=${window}`);
}
