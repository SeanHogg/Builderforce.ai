/**
 * failStrandedDispatch — fail one GitHub Actions dispatch that never reported in (the write half of `githubActionsReconcile`).
 *
 * Its own module: the sweep decides WHICH dispatches are stranded; this lands one of them terminal, through the injected
 * `IExecutionRepository` port (built at the composition root, never here) and mirrors the failure onto the Observability timeline.
 */
import { reportCaughtError } from '../observability/caughtErrorReporter';
import type { Db } from '../../infrastructure/database/connection';
import { toolAuditEvents } from '../../infrastructure/database/schema';
import { runTelemetryDatabase } from '../shared/runTelemetryDatabase';
import { ExecutionStatus } from '../../domain/shared/types';
import type { IExecutionRepository } from '../../domain/execution/IExecutionRepository';
import { landExecution } from './executionLanding';

/** A dispatched execution that has not yet reported in. */
export interface StrandedRow {
  id: number;
  tenantId: number;
  taskId: number | null;
  payload: string | null;
  cloudAgentRef: string | null;
  /** When we dispatched — the floor for "a run new enough to be this one". */
  createdAtMs: number;
}

/**
 * Fail one stranded dispatch, guarded on it still being non-terminal so a runner
 * that checked in between the GitHub read and this write is never clobbered.
 * Mirrors the failure onto the Observability timeline exactly as the reaper does —
 * without it the run simply stops with no explanation there.
 */
export async function failStrandedDispatch(db: Db, row: StrandedRow, reason: string, executions: IExecutionRepository): Promise<boolean> {
  // The ONE terminal transition, from the two statuses a stranded dispatch can be in (a runner that checked in is RUNNING and is never clobbered).
  const updated = await landExecution(executions, row.id, ExecutionStatus.FAILED, { errorMessage: reason }, [ExecutionStatus.PENDING, ExecutionStatus.SUBMITTED])
    .then((landed) => (landed.won ? [{ id: row.id }] : []))
    .catch((error) => {
      reportCaughtError(error, { source: "application/runtime/failStrandedDispatch.ts", operation: "updated", context: { logMessage: '[github-actions-reconcile] stranded execution transition failed', details: { tenantId: row.tenantId, executionId: row.id, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) } } });
      return [];
    });
  if (updated.length === 0) return false;

  await runTelemetryDatabase(db).insert(toolAuditEvents).values({
    tenantId: row.tenantId,
    agentHostId: null,
    cloudAgentRef: row.cloudAgentRef,
    executionId: row.id,
    sessionKey: `exec:${row.id}`,
    toolName: 'run.failed',
    category: 'error',
    result: reason,
    ts: new Date(),
  }).catch((error) => reportCaughtError(error, { source: "application/runtime/failStrandedDispatch.ts", operation: "failStrandedDispatch", context: { logMessage: '[github-actions-reconcile] failure telemetry append failed', details: {
    tenantId: row.tenantId,
    executionId: row.id,
    error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  } } }));

  return true;
}
