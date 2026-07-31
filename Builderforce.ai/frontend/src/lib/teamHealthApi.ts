/**
 * Team Health Dashboard API client.
 *
 * Fetches aggregated team health data from the `/api/projects/{id}/team-health`
 * endpoint. Falls back to a mock payload when the API is unreachable so the
 * dashboard UI can be developed and reviewed independently.
 */

import type { TeamHealthData, TeamHealthResponse } from './teamHealthTypes';
import { DEFAULT_HEALTH_CONFIG } from './teamHealthUtils';

const BASE_URL = '/api/projects';

/** Cached result keyed by project id (1-minute TTL per FR-5.3). */
const cache = new Map<number, { data: TeamHealthData; ts: number }>();
const TTL_MS = 60_000;

export async function fetchTeamHealth(
  projectId: number,
  signal?: AbortSignal,
): Promise<TeamHealthData> {
  const cached = cache.get(projectId);
  if (cached && Date.now() - cached.ts < TTL_MS) {
    return cached.data;
  }

  try {
    const res = await fetch(`${BASE_URL}/${projectId}/team-health`, {
      signal,
      headers: { Accept: 'application/json' },
    });

    if (!res.ok) {
      throw new Error(`Team Health API returned ${res.status}`);
    }

    const body: TeamHealthResponse = await res.json();

    if (!body.success || !body.data) {
      throw new Error(body.error ?? 'Unknown API error');
    }

    cache.set(projectId, { data: body.data, ts: Date.now() });
    return body.data;
  } catch (err) {
    // If aborted, re-throw so the caller can handle.
    if (err instanceof DOMException && err.name === 'AbortError') throw err;

    // Fall back to a mock payload so the UI is always renderable.
    const mock = buildMockData(projectId);
    cache.set(projectId, { data: mock, ts: Date.now() });
    return mock;
  }
}

/** Clear the cache (e.g. on manual refresh). */
export function clearTeamHealthCache(projectId: number): void {
  cache.delete(projectId);
}

/* ── Mock data (development fallback) ───────────────────────────────────── */

function buildMockData(_projectId: number): TeamHealthData {
  const now = Date.now();

  return {
    healthScore: {
      overall: 72,
      components: { blockers: 0.3, overload: 0.2, aging: 0.4, agentErrors: 0.1 },
      config: DEFAULT_HEALTH_CONFIG,
    },
    contributors: [
      { id: 'u-1', name: 'Alice Chen', type: 'human', assignedUserId: 'u-1', capacity: 40, tasksAssigned: 8, tasksCompleted: 5, avgTaskDurationSeconds: 86400 },
      { id: 'u-2', name: 'Bob Martinez', type: 'human', assignedUserId: 'u-2', capacity: 40, tasksAssigned: 4, tasksCompleted: 3, avgTaskDurationSeconds: 72000 },
      { id: 'u-3', name: 'Carol Wu', type: 'human', assignedUserId: 'u-3', capacity: 30, tasksAssigned: 12, tasksCompleted: 6, avgTaskDurationSeconds: 54000 },
      { id: 'a-1', name: 'Code Creator', type: 'agent', agentRef: 'code-creator', agentHostId: 1, capacity: 999, tasksAssigned: 5, tasksCompleted: 8, avgTaskDurationSeconds: 3600 },
      { id: 'a-2', name: 'Reviewer', type: 'agent', agentRef: 'code-reviewer', agentHostId: 2, capacity: 999, tasksAssigned: 3, tasksCompleted: 6, avgTaskDurationSeconds: 1800 },
    ],
    blockers: [
      {
        task: { id: 1001, title: 'Fix auth token expiry on mobile', status: 'blocked', assigneeId: 'u-1', assigneeName: 'Alice Chen', assigneeType: 'human', priority: 'urgent', blockedSince: now - 26 * 3600_000, blockingNote: 'Waiting on OAuth team to rotate signing keys', lastActivityAt: now - 26 * 3600_000 },
        ageHours: 26,
        blocking: { what: 'Waiting on OAuth team to rotate signing keys', who: 'Alice Chen' },
      },
      {
        task: { id: 1002, title: 'Deploy v2.7 to staging', status: 'blocked', assigneeId: 'u-2', assigneeName: 'Bob Martinez', assigneeType: 'human', priority: 'high', blockedSince: now - 8 * 3600_000, blockingNote: 'CI pipeline failing on integration tests', lastActivityAt: now - 8 * 3600_000 },
        ageHours: 8,
        blocking: { what: 'CI pipeline failing on integration tests', who: 'Bob Martinez' },
      },
    ],
    agingWip: [
      {
        task: { id: 2001, title: 'Refactor payment service to use new gateway', status: 'in_progress', assigneeId: 'u-3', assigneeName: 'Carol Wu', assigneeType: 'human', priority: 'medium', storyPoints: 13, lastActivityAt: now - 15 * 86400_000 },
        ageInThresholds: 2,
        staleDays: 15,
      },
      {
        task: { id: 2002, title: 'Add rate-limiting middleware', status: 'in_progress', assigneeId: 'a-1', assigneeName: 'Code Creator', assigneeType: 'agent', priority: 'medium', storyPoints: 5, lastActivityAt: now - 10 * 86400_000 },
        ageInThresholds: 3,
        staleDays: 10,
      },
      {
        task: { id: 2003, title: 'Update onboarding flow copy', status: 'in_progress', assigneeId: 'u-1', assigneeName: 'Alice Chen', assigneeType: 'human', priority: 'low', storyPoints: 3, lastActivityAt: now - 5 * 86400_000 },
        ageInThresholds: 1,
        staleDays: 5,
      },
    ],
    agents: [
      { agentHostId: 1, agentRef: 'code-creator', name: 'Code Creator', agentStatus: 'running', queueDepth: 2, lastRunStart: now - 600_000, completedSinceRestart: 12, avgTaskDurationSeconds: 3600, lastAcknowledgement: now - 60_000, lastKeepAlive: now - 30_000 },
      { agentHostId: 2, agentRef: 'code-reviewer', name: 'Reviewer', agentStatus: 'idle', queueDepth: 0, completedSinceRestart: 8, avgTaskDurationSeconds: 1800, lastAcknowledgement: now - 300_000, lastKeepAlive: now - 60_000 },
      { agentHostId: 3, agentRef: 'test-generator', name: 'Test Generator', agentStatus: 'error', queueDepth: 4, lastError: 'LLM provider returned 429 — rate limit exceeded', completedSinceRestart: 3, avgTaskDurationSeconds: 2400, lastAcknowledgement: now - 600_000, lastKeepAlive: now - 600_000 },
    ],
    alerts: [],
    lastUpdated: now,
  };
}
