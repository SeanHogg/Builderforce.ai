/**
 * teamHealthApi.ts — client-side fetch wrapper for /api/team-health.
 *
 * Includes a simple in-memory cache and cache-busting for manual refresh.
 */

import type { TeamHealthData } from './teamHealthTypes';

const cache = new Map<string, TeamHealthData>();

export async function fetchTeamHealth(
  projectId: number,
  signal?: AbortSignal,
): Promise<TeamHealthData> {
  const key = `project:${projectId}`;
  const cached = cache.get(key);
  if (cached && !signal?.aborted) return cached;

  const res = await fetch(`/api/team-health?projectId=${projectId}`, { signal });
  if (!res.ok) {
    throw new Error(`Team Health API error: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  if (!json.success || !json.data) {
    throw new Error(json.error ?? 'Unknown API error');
  }

  const data = json.data as TeamHealthData;
  cache.set(key, data);
  return data;
}

export function clearTeamHealthCache(projectId: number): void {
  cache.delete(`project:${projectId}`);
}
