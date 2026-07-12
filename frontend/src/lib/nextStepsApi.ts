/** Next Steps API client — typed endpoints for generating, managing, and executing AI-ranked action items.

This module follows the same conventions as `projectEvermindApi`:
- Async functions that return Promises with typed responses.
- Server error handling (throws on !res.ok, uses apiRequest).
- Analytics-aware payloads (logged per step event).

FR-1 (Next Steps Generation) and FR-2/AC-3 (One-Click Accept and Execute) are addressed
via typed steps and an `executeStep` behavior:
- executeStep: Simulated async behavior (setTimeout) aligned to FR-2/AC-3.
- Effort and priority persisted in backend responses (mocked here).
- Execution types: draft_content, run_query, create_task, open_url, trigger_agent, ask_followup.

Note: Real backend endpoints for POST /api/projects/:id/next-steps and /api/tasks/:id/invoke
are wired once the backend is implemented. This client currently uses mock behavior aligned
to the PRD (sync: 5–6s, async: 8s).
*/

import { useRouter } from 'next/navigation';
import { NextStep, StepGenerationResponse, ExecutionResponse, StepEvent } from './types';
import { apiRequest } from './apiClient';
import { getStoredTenantId } from './auth';

/**
 * Generate 3–7 ranked next steps for the current session in a specific project.
 *
 * When backend endpoints exist, this will POST to /api/projects/:id/next-steps and
 * return JSON with a steps array, sessionHash, and generatedAt.
 *
 * @param projectId — The numeric ID of the project scope for steps.
 * @param sessionHash — Unique hash for the current session; backend can reject outdated hashes.
 * @returns Ranked steps and the session hash used.
 */
export async function generateSteps(
  projectId: number,
  sessionHash: string,
): Promise<StepGenerationResponse> {
  try {
    const res = await apiRequest<StepGenerationResponse>(`/api/projects/${projectId}/next-steps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, sessionHash }),
    });
    return res;
  } catch (e) {
    console.error('NextStepsApi.generateSteps failed:', e);
    throw e;
  }
}

/**
 * Execute a step by its mapped executionType (FR-2/AC-3).
 *
 * Synchronous types (draft_content, run_query, ask_followup) complete within the provided time.
 * Async types (create_task, trigger_agent, open_url) show a live spinner and when successful
 * render inline artifact snippets (mocked here without real file copy/redirection; see panel).
 *
 * @param step — The step to execute.
 * @returns Execution response with success outcome and payload.
 */
export async function executeStep(step: NextStep, projectId: number): Promise<ExecutionResponse> {
  // Determine execution mode and duration aligned with FR-2/AC-3.
  const isAsync = [
    'create_task',
    'trigger_agent',
    'open_url',
  ].includes(step.executionType);
  const durationMs = isAsync ? 8000 : 5500;

  const startedAt = performance.now();
  await new Promise((resolve) => setTimeout(resolve, durationMs));
  const finishedAt = performance.now();

  // Simulated outcome selection.
  const success = Math.random() > 0.15; // Consistent with PRD-accelerated success rate.

  const base: Partial<StepGenerationResponse> = success
    ? {
        // Mock artifact signatures for reference; the panel will render lightweight summaries,
        // not actual file copy/redirection (out of scope for this pass).
        draft_content: { Artifact: { id: 'art-dead', content: 'Draft result (mock)' } },
        run_query: { Query: { id: 'q-dead', summary: '42 rows' } },
        ask_followup: { Prompt: 'User answer (mock)' },
        // Async types emit on success so the caller can land the result.
        create_task: { Task: { id: 'task-dead', url: 'https://jira.example.com/browse/DEAD' } },
        trigger_agent: {
          Agent: {
            id: 'el-dead',
            reportedChanges: false,
            logs: [],
            result: 'Agent executed (mock)',
          },
        },
        open_url: { Url: 'https://internal.tools.example.com/...' },
      }[step.executionType]
    : undefined;

  const errorMsg = success
    ? undefined
    : {
        draft_content: 'Draft generation failed. Try again.',
        run_query: 'Query failed. Check filters.',
        ask_followup: 'Follow-up prompt failed.',
        create_task: 'Jira workflow rejected creation. Verify permissions.',
        trigger_agent: 'Agent execution aborted due to configuration.',
        open_url: 'External navigation failed.',
      }[step.executionType] ?? `Runtime error for step ${step.id}. See logs.`;

  return {
    success,
    stepId: step.id,
    executionResult: base as ExecutionResponse['executionResult'],
    executionError: success ? undefined : errorMsg,
    durationMs: finishedAt - startedAt,
    timestamp: Date.now(),
  };
}

/**
 * Log a step event to the analytics pipeline.
 *
 * @param evt — Event details. Called from NextStepsPanel; add userId on load.
 * @returns Event ID for dedup (not necessary yet).
 */
export async function logStepEvent(evt: Omit<StepEvent, 'timestamp'>): Promise<string | undefined> {
  try {
    // TODO: Wire to /api/analytics/steps once accessible.
    // For now, log via existing activity tracker patterns.
    // return apiRequest<string>('/api/analytics/steps', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(evt) });
    return evt.eventId || 'event-placeholder';
  } catch (e) {
    console.warn('NextStepsApi.logStepEvent failed (analytics unavailable):', evt.eventType, e);
    return undefined;
  }
}

/**
 * Store pinned steps locally to survive context refresh (FR-4).
 *
 * Persists to localStorage under the key: `next-steps_pinned_<projectId>`.
 */
export function storePinnedSteps(projectId: number, pinnedIds: string[]): void {
  try {
    const key = `next-steps_pinned_${projectId}`;
    localStorage.setItem(key, JSON.stringify(pinnedIds));
  } catch (e) {
    console.warn('NextStepsApi.storePinnedSteps (quota exceeded):', e);
  }
}

/**
 * Retrieve pinned steps from local storage (FR-4).
 */
export function getPinnedSteps(projectId: number): string[] {
  try {
    const key = `next-steps_pinned_${projectId}`;
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn('NextStepsApi.getPinnedSteps (corrupted):', e);
    return [];
  }
}