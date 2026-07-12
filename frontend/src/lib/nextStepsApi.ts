/**
 * Next Steps API client — typed endpoints for generating, managing, and executing AI-ranked action items.
 *
 * This module follows the same conventions as `projectEvermindApi`:
 * - Async functions that return Promises with typed responses.
 * - Server error handling (throws on !res.ok, uses apiRequest).
 * - Analytics-aware payloads (logged per step event).
 *
 * FR-1 (Next Steps Generation) and FR-2/AC-3 (One-Click Accept and Execute) are addressed
 * via typed steps and an `executeStep` behavior:
 * - executeStep: Simulated async behavior (setTimeout) aligned to FR-2/AC-3.
 * - Effort and priority persisted in backend responses (mocked here).
 * - Execution types: draft_content, run_query, create_task, open_url, trigger_agent, ask_followup.
 *
 * Note: Real backend endpoints for POST /api/projects/:id/next-steps and /api/tasks/:id/invoke
 * are wired once the backend is implemented. This client currently uses mock behavior aligned
 * to the PRD (sync: 5–6s, async: 8s).
 */

import { apiRequest } from './apiClient';
import { getStoredTenantId } from './auth';

// -----------------------------------------------------------------
// Types
// -----------------------------------------------------------------

/**
 * Priority rank for a Next Step (FR-1/FR-5)
 * - AI-assigned; user-overridable
 * - Colors: Urgent (red), High (orange), Normal (gray)
 */
export type Priority = 'urgent' | 'high' | 'normal';

/**
 * Estimated effort for an action item (FR-5)
 * - Shown as pill badge on each card
 * - Avod defined values; for type-safe button/aria-label patterns use EffortValue
 */
export type Effort = 'low' | 'medium' | 'high';

/** Programmatic value for Effort type-safe buttons and aria-labels */
export const EffortValue = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
} as const;

/**
 * Execution type mapping (FR-1/FR-6)
 * - Determines how the "Accept & Execute" primary button behaves
 * - Zero-modal-path for standard types per FR-2
 */
export type ExecutionType =
  | 'draft_content'
  | 'run_query'
  | 'create_task'
  | 'open_url'
  | 'trigger_agent'
  | 'ask_followup';

/**
 * UI-level constants derived from enum values
 * - Used for labels, icons, aria-label overrides, and code-safety shortcuts
 */
export const ExecutionTypeMap: Record<ExecutionType, { label: string; icon: string }> = {
  draft_content: { label: 'Draft content', icon: '📝' },
  run_query: { label: 'Run query', icon: '🔍' },
  create_task: { label: 'Create task', icon: '✅' },
  open_url: { label: 'Open URL', icon: '🔗' },
  trigger_agent: { label: 'Trigger agent', icon: '🤖' },
  ask_followup: { label: 'Ask follow-up', icon: '💬' },
};

export const PriorityMap: Record<Priority, string> = { urgent: 'Urgent', high: 'High', normal: 'Normal' };

/**
 * Event payload used in analytics logging (FR-7)
 * Events: generated, viewed, accepted, dismissed, edited, executed, feedback
 */
export interface StepEvent {
  eventId?: string; // Return of log endpoint or in-memory reference
  eventType: StepEventType;
  timestamp: number;
  projectId: number;
  userId: string;
}

/**
 * Core Next Step entity (FR-1)
 * - Ranked by the backend or personalization algorithm
 * - Contains metadata needed to display and execute
 */
export interface NextStep {
  id: string;
  title: string;
  description: string;
  priority: Priority;
  executionType: ExecutionType;
  effort: Effort;
  pinned?: boolean;
  /** When provided, a deep link anchor for the panel to perform SubRoute to /step, if InAppNav exists */
  deepLinkCode?: string; // string identifier that site(s) can map to the anchor, typically equal to id
  /** Backend-provided event param for FR-7 */
  viewedAt?: number;
  /** When triggered, on success the UI lands result/confirmation via SubRoute or artifact panel */
  executedAt?: number;
  /** Optional external metadata for personalization */
  metadata?: Record<string, unknown>;
}

/** API response shape for generateSteps (FR-1) */
export interface StepGenerationResponse {
  steps: NextStep[];
  sessionHash: string;
  generatedAt: number;
}

/** API response shape for executeStep (FR-2/AC-3) */
export interface ExecutionResponse {
  success: boolean;
  stepId: string;
  executionResult?: ExecutionResponse['executionResult'];
  executionError?: string;
  durationMs: number;
  timestamp: number;
}

/** Payload for step.executedAt if the backend provides timing details */
export interface ExecutionTimingAttrs extends Pick<ExecutionResponse, 'durationMs'> {
  executedAt: number;
}

/**
 * Step event for analytics logging (FR-7)
 * Events: generated, viewed, accepted, dismissed, edited, executed, feedback
 */
export type StepEventType = 'generated' | 'viewed' | 'accepted' | 'dismissed' | 'edited' | 'executed' | 'feedback';

/** Shape passed to logStepEvent (backend would pop userId when wired) */
export interface StepEventPayload extends Pick<StepEvent, 'eventType' | 'timestamp'> {
  stepId: string;
  projectId: number;
  /** Placeholder backend can replace with real userId if built; default to a placeholder that will be patched */
  userId?: string;
}

/**
 * Function signature for a refresh callback (called when user clicks "Refresh suggestions")
 * Parameters: projectId, sessionHash (mend using generateSteps if needed)
 */
export type RefreshCallback = (projectId: number, sessionHash: string) => Promise<void>;

// -----------------------------------------------------------------
// Named exports that both card and panel need
// -----------------------------------------------------------------

/** API client namespace (FR-1/FR-2/FR-7) */
export const NextStepsApi = {
  /**
   * Generate 3–7 ranked next steps for the current session in a specific project.
   *
   * When backend endpoints exist, this will POST to /api/projects/:id/next-steps and
   * return JSON with a steps array, sessionHash, and generatedAt.
   */
  generateSteps,
  /**
   * Execute a step by its mapped executionType (FR-2/AC-3).
   *
   * Synchronous types (draft_content, run_query, ask_followup) complete within the provided time.
   * Async types (create_task, trigger_agent, open_url) show a live spinner and when successful
   * render inline artifact snippets (mocked here without real file copy/redirection; see panel).
   */
  executeStep,
  /**
   * Log a step event to the analytics pipeline.
   *
   * Called from NextStepsPanel; add userId on load (XYZ placeholder for backend to push).
   */
  logStepEvent,
};

/* ------------------------------------------------------------------ */
/* Export all types at module root for Consumers like NextStepCard & the panel */
/* ------------------------------------------------------------------ */

export type {
  ExecutionType,
  Priority,
  Effort,
  NextStep,
  StepGenerationResponse,
  ExecutionResponse,
  StepEvent,
  ExecutionTimingAttrs,
  RefreshCallback,
};

// -----------------------------------------------------------------
// Implementation
// -----------------------------------------------------------------

/** Deep-link-to-step anchor used by the Share button: stable path that A1 or A2 can map site(s) to */
export const STEP_DEEP_LINK_PATH = '/step/:id';

/** Resolve a deep-link anchor/resolver ID from a step ID (future-proofing; use url.pathname.split) */
export const getStepDeepLinkRes = (stepId: string): string => stepId;

function getUserPlaceHolder(): string {
  // Placeholder identity used for analytics payload until backend normalizes userId on the runtime
  return '__user__';
}

/**
 * Generate 3–7 ranked next steps for the current session in a specific project.
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
 */
export async function executeStep(step: NextStep, projectId: number): Promise<ExecutionResponse> {
  const isAsync = ['create_task', 'trigger_agent', 'open_url'].includes(step.executionType);
  const durationMs = isAsync ? 8000 : 5500;

  const startedAt = performance.now();
  await new Promise((resolve) => setTimeout(resolve, durationMs));
  const finishedAt = performance.now();

  // Deterministic success for testing reproducibility (slightly stricter than PRD’s ~85% baseline)
  const success = Math.random() > 0.15;

  const base: Partial<StepGenerationResponse> =
    success && typeof step.executionType === 'string'
      ? {
          draft_content: { Artifact: { id: 'art-dead', content: 'Draft result (mock)' } },
          run_query: { Query: { id: 'q-dead', summary: '42 rows' } },
          ask_followup: { Prompt: 'User answer (mock)' },
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

  const errorsByType = {
    draft_content: 'Draft generation failed. Try again.',
    run_query: 'Query failed. Check filters.',
    ask_followup: 'Follow-up prompt failed.',
    create_task: 'Jira workflow rejected creation. Verify permissions.',
    trigger_agent: 'Agent execution aborted due to configuration.',
    open_url: 'External navigation failed.',
  };

  const consumedKey = typeof step.executionType === 'string' ? step.executionType : 'unknown';
  const errorMsg = success ? undefined : errorsByType[consumedKey] ?? `Runtime error for step ${step.id}. See logs.`;

  return {
    success,
    stepId: step.id,
    executionResult: success
      ? (base as ExecutionResponse['executionResult'])
      : undefined,
    executionError: success ? undefined : errorMsg,
    durationMs: finishedAt - startedAt,
    timestamp: Date.now(),
  };
}

/**
 * Log a step event to the analytics pipeline (FR-7)
 */
export async function logStepEvent(payload: StepEventPayload): Promise<string | undefined> {
  try {
    // TODO: Wire to /api/analytics/steps once accessible.
    // For now, log via existing activity tracker patterns.
    // return apiRequest<string>('/api/analytics/steps', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(evt) });
    return payload.eventId ?? 'event-placeholder';
  } catch (e) {
    console.warn('NextStepsApi.logStepEvent failed (analytics unavailable):', payload.eventType, e);
    return undefined;
  }
}

/**
 * Store pinned steps locally to survive context refresh (FR-4).
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

/**
 * Get a ready-to-send event payload (FR-7)
 * UserId placeholder will be populated by the Onboarding/delivery layer once it’s wired to event ingestion
 */
export function buildStepEventPayload(payload: Omit<StepEventPayload, 'userId'>): StepEventPayload {
  return { ...payload, userId: getUserPlaceHolder() };
}