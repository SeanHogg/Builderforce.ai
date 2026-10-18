/**
 * An executor reports where its run is — THE one execution-state use case.
 *
 * Two doors reach it: the tenant-JWT callback (`PATCH /api/runtime/executions/:id/state`)
 * and the host-key callback a deployed agent host makes
 * (`PATCH /api/agent-hosts/:id/executions/:eid/state`). The host door used to write
 * the `executions` row directly, which skipped everything a state change is FOR:
 * the domain transition guard (a late "completed" could resurrect a cancelled run),
 * the ticket-lane sync and lifecycle narration in `RuntimeService.update`, the live
 * stream notification, and the code-change insight. Both doors are now adapters that
 * only authenticate and scope; this function is the state change.
 *
 * DUPLICATE AND LATE REPORTS ARE ACKNOWLEDGED, NOT REFUSED (when `tolerateLate`).
 * A host in the field retries and races the platform's own cancel; answering its
 * second "completed" with an error teaches it nothing and may make it retry forever.
 * The row is left as the domain says it is and returned unchanged.
 */
import { and, eq } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { executions, projectInsightEvents, projects, tasks } from '../../infrastructure/database/schema';
import { ExecutionStatus } from '../../domain/shared/types';
import type { Execution } from '../../domain/execution/Execution';
import type { RuntimeService } from './RuntimeService';
import { notifyExecutionSubscribers } from './executionEvents';
import { settleLateSteersSafely } from './lateSteerFollowUp';

export interface ExecutionStateReport {
  executionId: number;
  tenantId: number;
  status: ExecutionStatus;
  result?: string | null;
  errorMessage?: string | null;
  /** Explicit changed-line count; a numeric string from older hosts is accepted. */
  codeChanges?: number | string | null;
  /** The person behind the report, when there is one (tenant-JWT door). */
  userId?: string | null;
}

export interface ReportExecutionStateDeps {
  env: Env;
  db: Db;
  runtimeService: RuntimeService;
  /** `executionCtx.waitUntil` — follow-up work that must not delay the reply. */
  waitUntil: (task: Promise<unknown>) => void;
  /** Acknowledge a report the domain refuses (already terminal) instead of throwing. */
  tolerateLate?: boolean;
}

function isTerminalStatus(status: ExecutionStatus): boolean {
  return status === ExecutionStatus.COMPLETED || status === ExecutionStatus.FAILED || status === ExecutionStatus.CANCELLED;
}

/** Apply one state report. The caller has already proved the run is theirs. */
export async function reportExecutionState(
  deps: ReportExecutionStateDeps,
  report: ExecutionStateReport,
): Promise<Execution> {
  const { env, db, runtimeService } = deps;
  const current = await runtimeService.getExecution(report.executionId);
  if (deps.tolerateLate && current.isTerminal) return current;

  // CANCELLED is not a transition `update` makes; an executor reporting it is
  // acknowledging a stop, attributed to the run's own submitter.
  const execution = report.status === ExecutionStatus.CANCELLED
    ? await runtimeService.cancel(report.executionId, current.submittedBy)
    : await runtimeService.update(report.executionId, {
      status: report.status,
      ...(report.result != null ? { result: report.result } : {}),
      ...(report.errorMessage != null ? { errorMessage: report.errorMessage } : {}),
    });

  const terminal = isTerminalStatus(report.status);
  // Every steer still pending on a run that just ended is LATE: it starts a
  // follow-up run under the person who sent it (lateSteerFollowUp.ts).
  if (terminal) {
    deps.waitUntil(settleLateSteersSafely({ env, db, runtimeService }, { executionId: report.executionId, tenantId: report.tenantId }));
  }

  notifyExecutionSubscribers(execution.id, {
    type: terminal ? 'done' : 'status_change',
    executionId: execution.id,
    status: execution.status,
    execution: execution.toPlain(),
    ts: new Date().toISOString(),
  });

  if (report.status === ExecutionStatus.COMPLETED) {
    const codeChanges = normalizeCodeChanges(report.codeChanges) ?? extractCodeChangesFromResult(report.result ?? undefined);
    if (codeChanges != null) await recordCodeChangeInsight(db, report, codeChanges);
  }
  return execution;
}

async function recordCodeChangeInsight(db: Db, report: ExecutionStateReport, codeChanges: number): Promise<void> {
  const [taskRow] = await db
    .select({ projectId: tasks.projectId })
    .from(executions)
    .innerJoin(tasks, eq(tasks.id, executions.taskId))
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(eq(executions.id, report.executionId), eq(projects.tenantId, report.tenantId)))
    .limit(1);
  if (!taskRow) return;
  await db.insert(projectInsightEvents).values({
    tenantId: report.tenantId,
    projectId: taskRow.projectId,
    userId: report.userId ?? null,
    executionId: report.executionId,
    codeChanges,
  });
}

export function normalizeCodeChanges(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.max(0, Math.floor(parsed));
  }
  return null;
}

const CODE_CHANGE_KEYS = [
  'codeChanges',
  'code_changes',
  'linesChanged',
  'lines_changed',
  'changedLines',
  'totalChangedLines',
  'total_changed_lines',
] as const;

/** Find a changed-line count anywhere in a JSON result an executor returned. */
export function extractCodeChangesFromResult(result?: string): number | null {
  if (!result?.trim()) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(result);
  } catch {
    return null;
  }

  const queue: unknown[] = [parsed];
  const visited = new Set<unknown>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== 'object') continue;
    if (visited.has(current)) continue;
    visited.add(current);

    if (Array.isArray(current)) {
      for (const item of current) queue.push(item);
      continue;
    }

    const record = current as Record<string, unknown>;
    for (const key of CODE_CHANGE_KEYS) {
      const direct = normalizeCodeChanges(record[key]);
      if (direct != null) return direct;
    }

    const insertions = normalizeCodeChanges(record.insertions ?? record.additions ?? record.addedLines ?? record.added_lines);
    const deletions = normalizeCodeChanges(record.deletions ?? record.removals ?? record.deletedLines ?? record.deleted_lines);
    if (insertions != null || deletions != null) {
      return (insertions ?? 0) + (deletions ?? 0);
    }

    for (const value of Object.values(record)) queue.push(value);
  }

  return null;
}
