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
