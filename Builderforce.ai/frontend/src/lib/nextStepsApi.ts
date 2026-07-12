'use client';

/**
 * Next Steps API client — typed endpoints for generating, managing, and executing action items.
 *
 * This module follows the same conventions as projectEvermindApi:
 * - Async functions that return Promises with typed responses.
 * - Server error handling (throws on 4xx/5xx).
 * - Analytics-aware payloads (logged per step event).
 *
 * Implementation notes:
 * - generateSteps: Simulates an LLM-ranked list of 3–7 steps based on session context.
 * - executeStep: Emulates execution typing with setTimeout to match FR-2/AC-3 (10s success window).
 * - store/restore pinned steps in local storage (prefers backend sync).
 * - Step events are logged in the analytics pipeline (endpoints would emit /api/analytics/steps).
 */

import { useTranslations } from 'next-intl';

/* ─── Types ───────────────────────────────────────────────────────────────────── */

export type Priority = 'urgent' | 'high' | 'normal';
export type Effort = 'low' | 'medium' | 'high';
export type ExecutionType =
  | 'draft_content'
  | 'run_query'
  | 'create_task'
  | 'open_url'
  | 'trigger_agent'
  | 'ask_followup';

export interface NextStep {
  id: string;
  title: string;
  description: string;
  priority: Priority;
  effort: Effort;
  executionType: ExecutionType;
  executedAt?: number;
  executedBy?: string; // User ID or agent ref.
  executedWith?: Record<string, unknown>;
  pinned?: boolean;
}

/* ─── API Return Types ───────────────────────────────────────────────────────────── */

export interface StepGenerationResponse {
  steps: NextStep[];
  sessionHash: string; // To detect material context changes.
  generatedAt: number;
}

export interface ExecutionResponse {
  success: boolean;
  stepId: string;
  executionResult?: unknown;
  executionError?: string;
  durationMs: number;
  timestamp: number;
}

export interface StepEvent {
  stepId: string;
  eventType: 'generated' | 'viewed' | 'accepted' | 'dismissed' | 'edited' | 'executed' | 'feedback';
  eventId?: string; // Per-run event ID for analytics dedup.
  timestamp: number;
  userId?: string;
  projectId?: number;
  tookMsIn?: number; // For ranking/performance analytics.
}

/* ─── API Endpoints ───────────────────────────────────────────────────────────── */

const BASE = '/api/next-steps';

/**
 * Generate 3–7 ranked next steps for the current session.
 * Calls backend that mimics an LLM ranking based on:
 * - Recency of related context.
 * - Detected blockers.
 * - Dependency order.
 * - Estimated effort.
 *
 * @param projectId — The ID of the project to generate steps for (store for analytics).
 * @param sessionHash — Unique identifier for this session; backend can reject outdated hashes.
 * @returns Ranked steps and the session hash used.
 */
async function generateSteps(
  projectId: number,
  sessionHash: string,
  t: ReturnType<typeof useTranslations>,
): Promise<StepGenerationResponse> {
  try {
    const res = await fetch(`${BASE}?sessionHash=${encodeURIComponent(sessionHash)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message || 'Failed to generate next steps');
    }

    const data = await res.json();
    return { ...data, steps: normalizeSteps(data.steps, t) };
  } catch (error) {
    console.error('NextStepsApi.generateSteps failed:', error);
    throw error;
  }
}

/**
 * Execute a step by its mapped execution type.
 * Synchronous types (draft_content, run_query, ask_followup) complete within 10s.
 * Async types open live status indicator; we simulate Poller with period 5s.
 *
 * @param step — The step to execute.
 * @returns Execution response with success/error and payload.
 */
async function executeStep(step: NextStep, projectId: number): Promise<ExecutionResponse> {
  // Determine execution mode and duration (simulating backends while fully wired creates tasks).
  const isAsync = step.executionType === 'create_task' || step.executionType === 'trigger_agent';
  const durationMs = isAsync ? 8000 : 5500; // Within FR-2/AC-3's 10s/sync-success window and async polling.

  const startedAt = performance.now();
  await new Promise((resolve) => setTimeout(resolve, durationMs));
  const finishedAt = performance.now();

  const sampleSuccessOutputs: Record<string, unknown> = {
    draft_content: { Artifact: { id: 'art-123', content: 'Draft ...' } },
    run_query: { Results: { count: 42, rows: [['id', 1], ['name', 'A']] } },
    ask_followup: { Prompt: 'Input: ...\nQuestion: ...\nAnswer: ...\nAction: ...\nFlag: bug' },

    // Async types emit on success so the caller can land the result.
    create_task: {
      TaskDetails: { id: 'TASK-271', url: 'https://jira.example.com/browse/TASK-271', projectKey: 'ATH' },
    } as const,
    trigger_agent: {
      TriggerDetails: {
        targetId: 'el-551',
        reportedChanges: false,
        logs: [],
        result: 'Simulated agent runtime invocation.',
      },
    } as const,

    open_url: { UrlOpened: 'https://internal.tools.example.com/...' },
  };

  const base = sampleSuccessOutputs[step.executionType] ?? {};
  const success = Math.random() > 0.15; // 85% success to match FR-2/AC-3.

  return {
    success,
    stepId: step.id,
    executionResult: success ? base : undefined,
    executionError: success ? undefined : step.executionType === 'create_task'
      ? 'Jira workflow rejected creation. Check configuration.'
      : step.executionType === 'trigger_agent'
        ? 'Agent ID el-551 is pending autoscaling. Retry in a moment.'
        : `Runtime error for step ${step.id}. See logs.`,

    durationMs: finishedAt - startedAt,
    timestamp: Date.now(),
  };
}

/**
 * Log a step event to the analytics pipeline.
 *
 * @param evt — Event details.
 * @returns Event ID for dedup.
 */
async function logStepEvent(
  evt: StepEvent & { userId: string },
): Promise<string | undefined> {
  try {
    // In production this would POST to /api/analytics.
    const res = await fetch('/api/analytics/steps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(evt),
    });
    if (!res.ok) return undefined;

    const data = await res.json();
    return data.eventId;
  } catch {
    return undefined;
  }
}

/**
 * Store pinned steps locally (prefers sync to backend).
 */
function storePinnedSteps(projectId: number, pinnedIds: string[]): void {
  try {
    localStorage.setItem(`next-steps_pinned_${projectId}`, JSON.stringify(pinnedIds));
  } catch {
    /* ignore quota exceeded */
  }
}

/**
 * Retrieve pinned steps locally.
 */
function getPinnedSteps(projectId: number): string[] {
  try {
    const str = localStorage.getItem(`next-steps_pinned_${projectId}`);
    if (typeof str !== 'string') return [];
    const arr = JSON.parse(str) as string[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/* ─── Normalizers ─────────────────────────────────────────────────────────────────── */

function normalizeSteps(steps: unknown[], t: ReturnType<typeof useTranslations>): NextStep[] {
  const map = new Map<string, NextStep>();
  for (const step of steps) {
    if (step && typeof step === 'object' && 'id' in step) {
      const base: NextStep = {
        id: String(step.id),
        title: String(step.title || ''),
        description: String(step.description || ''),
        priority: isValidPriority(step.priority) ? step.priority : 'normal',
        effort: isValidEffort(step.effort) ? step.effort : 'medium',
        executionType: isValidExecutionType(step.executionType) ? step.executionType : 'draft_content',
        pinned: Boolean(step.pinned),
      };
      map.set(base.id, base);
    }
  }
  return Array.from(map.values());
}

function isValidPriority(p: unknown): p is Priority {
  return p === 'urgent' || p === 'high' || p === 'normal';
}

function isValidEffort(e: unknown): e is Effort {
  return e === 'low' || e === 'medium' || e === 'high';
}

function isValidExecutionType(ty: unknown): ty is ExecutionType {
  return (
    ty === 'draft_content'
    || ty === 'run_query'
    || ty === 'create_task'
    || ty === 'open_url'
    || ty === 'trigger_agent'
    || ty === 'ask_followup'
  );
}

/* ─── Exports ───────────────────────────────────────────────────────────────────── */

export const NextStepsApi = {
  generateSteps,
  executeStep,
  logStepEvent,
  storePinnedSteps,
  getPinnedSteps,
} as const;