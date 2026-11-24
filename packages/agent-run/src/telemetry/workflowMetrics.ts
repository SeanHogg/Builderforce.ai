import type { RunAgentInput } from '../runContext.js';

/** Section 5 of the pipeline map. IDs are diagnostic protocol fields, not UI copy. */
export const WORKFLOW_STAGES = ['surface', 'start', 'route', 'work', 'opening', 'compose', 'kernel', 'dispatch', 'spawn', 'ledger', 'finish', 'settle', 'grade', 'outcome'] as const;
export type WorkflowStage = typeof WORKFLOW_STAGES[number];
export type WorkflowStatus = 'running' | 'completed' | 'failed' | 'blocked' | 'cancelled';

export interface WorkflowMetric {
  schemaVersion: 1;
  id: string;
  stage: WorkflowStage;
  runId?: string;
  entryPoint: string;
  step: number;
  status: WorkflowStatus;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  /** Numeric facts only: never prompts, credentials, paths or tool arguments. */
  counters?: Record<string, number>;
}
export interface WorkflowSink { workflow?(metric: WorkflowMetric): Promise<void> | void }
export interface WorkflowScope { runId?: string; entryPoint: string; step: number }
export function workflowScope(input: Pick<RunAgentInput, 'task' | 'policy'>, step = 0): WorkflowScope {
  return { runId: input.task.runId, entryPoint: input.policy?.entryPoint ?? 'unknown', step };
}
let sequence = 0;

/** Telemetry is best effort and never changes execution, including a rejecting async sink. */
function report(sink: WorkflowSink | undefined, metric: WorkflowMetric): void {
  try { void Promise.resolve(sink?.workflow?.(metric)).catch(() => {}); } catch { /* sink unavailable */ }
}

export function beginWorkflowStage(sink: WorkflowSink | undefined, scope: WorkflowScope, stage: WorkflowStage, now = Date.now) {
  if (!sink?.workflow) return (_status?: Exclude<WorkflowStatus, 'running'>, _counters?: Record<string, number>): void => {};
  const startedAt = now();
  const metric: WorkflowMetric = { schemaVersion: 1, id: `${startedAt}:${++sequence}`, ...scope, stage, status: 'running', startedAt };
  report(sink, metric);
  let ended = false;
  return (status: Exclude<WorkflowStatus, 'running'> = 'completed', counters?: Record<string, number>): void => {
    if (ended) return;
    ended = true;
    const endedAt = now();
    report(sink, { ...metric, status, endedAt, durationMs: Math.max(0, endedAt - startedAt), ...(counters ? { counters } : {}) });
  };
}

function finishMeasurement<T>(done: ReturnType<typeof beginWorkflowStage>, value: T, verdict?: (value: T) => Exclude<WorkflowStatus, 'running'>, counters?: (value: T) => Record<string, number>): void {
  try { done(verdict?.(value) ?? 'completed', counters?.(value)); }
  catch { done('completed'); } // A derived diagnostic fact must not replace a successful operation with an exception.
}

export async function measureWorkflow<T>(sink: WorkflowSink | undefined, scope: WorkflowScope, stage: WorkflowStage, action: () => Promise<T> | T, verdict?: (value: T) => Exclude<WorkflowStatus, 'running'>, signal?: AbortSignal, counters?: (value: T) => Record<string, number>): Promise<T> {
  if (!sink?.workflow) return action();
  const done = beginWorkflowStage(sink, scope, stage);
  try {
    const value = await action();
    finishMeasurement(done, value, signal?.aborted ? () => 'cancelled' : verdict, counters);
    return value;
  } catch (error) { done(signal?.aborted ? 'cancelled' : 'failed'); throw error; }
}

export function measureWorkflowSync<T>(sink: WorkflowSink | undefined, scope: WorkflowScope, stage: WorkflowStage, action: () => T, counters?: (value: T) => Record<string, number>, verdict?: (value: T) => Exclude<WorkflowStatus, 'running'>): T {
  if (!sink?.workflow) return action();
  const done = beginWorkflowStage(sink, scope, stage);
  try {
    const value = action();
    finishMeasurement(done, value, verdict, counters);
    return value;
  } catch (error) { done('failed'); throw error; }
}

export interface WorkflowStageSummary {
  stage: WorkflowStage;
  status: 'not_observed' | 'incomplete' | WorkflowStatus;
  attempts: number;
  completed: number;
  failed: number;
  blocked: number;
  cancelled: number;
  running: number;
  /** Null means unmeasured. Sum/max cover observed finished attempts, excluding gaps. */
  totalMs: number | null;
  maxMs: number | null;
  latestCounters?: Record<string, number>;
}
export interface WorkflowSummary {
  schemaVersion: 1;
  observedStages: number;
  totalStages: number;
  runIds: string[];
  stages: WorkflowStageSummary[];
}

/** Validate untrusted/persisted traces before deriving measurements. Old captures stay unmeasured. */
export function workflowMetricOf(value: unknown): WorkflowMetric | null {
  if (!value || typeof value !== 'object') return null;
  const m = value as WorkflowMetric;
  if (m.schemaVersion !== 1 || typeof m.id !== 'string' || !m.id || m.id.length > 200 || !WORKFLOW_STAGES.includes(m.stage)
    || !['running', 'completed', 'failed', 'blocked', 'cancelled'].includes(m.status)
    || typeof m.entryPoint !== 'string' || !Number.isInteger(m.step) || m.step < 0 || !Number.isFinite(m.startedAt)
    || (m.runId !== undefined && typeof m.runId !== 'string')) return null;
  if (m.status !== 'running' && (!Number.isFinite(m.endedAt) || !Number.isFinite(m.durationMs) || m.durationMs! < 0)) return null;
  const counters = m.counters && typeof m.counters === 'object'
    ? Object.fromEntries(Object.entries(m.counters).filter(([key, value]) => /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key) && typeof value === 'number' && Number.isFinite(value)).slice(0, 32)) : undefined;
  return { schemaVersion: 1, id: m.id, stage: m.stage, status: m.status, step: m.step, entryPoint: m.entryPoint, startedAt: m.startedAt,
    ...(m.runId !== undefined ? { runId: m.runId } : {}),
    ...(m.status !== 'running' ? { endedAt: m.endedAt, durationMs: m.durationMs } : {}), ...(counters ? { counters } : {}) };
}

/** Deduplicate live + durable copies and count each start/finish pair once, even when delivered out of order. */
export function summarizeWorkflow(metrics: readonly WorkflowMetric[]): WorkflowSummary {
  const attempts = new Map<string, WorkflowMetric>();
  for (const metric of metrics) {
    const key = `${metric.runId ?? ''}:${metric.entryPoint}:${metric.id}`;
    const prior = attempts.get(key);
    if (!prior || prior.status === 'running') attempts.set(key, metric);
  }
  const stages = WORKFLOW_STAGES.map((stage): WorkflowStageSummary => {
    const observed = [...attempts.values()].filter((m) => m.stage === stage);
    const durations = observed.flatMap((m) => m.durationMs === undefined ? [] : [m.durationMs]);
    const count = (status: WorkflowStatus) => observed.filter((m) => m.status === status).length;
    const latest = observed.reduce<WorkflowMetric | undefined>((a, b) => !a || b.startedAt >= a.startedAt ? b : a, undefined);
    return {
      stage, status: !observed.length ? 'not_observed' : count('running') ? 'incomplete' : latest!.status,
      attempts: observed.length, completed: count('completed'), failed: count('failed'), blocked: count('blocked'), cancelled: count('cancelled'), running: count('running'),
      totalMs: durations.length ? durations.reduce((sum, ms) => sum + ms, 0) : null,
      maxMs: durations.length ? Math.max(...durations) : null,
      ...(latest?.counters ? { latestCounters: latest.counters } : {}),
    };
  });
  return { schemaVersion: 1, observedStages: stages.filter((s) => s.attempts > 0).length, totalStages: stages.length, runIds: [...new Set(metrics.flatMap((m) => m.runId ? [m.runId] : []))], stages };
}
