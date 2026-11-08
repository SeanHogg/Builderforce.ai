import { reportCaughtError } from '../observability/caughtErrorReporter';
import type { Db } from '../../infrastructure/database/connection';
import type { Execution } from '../../domain/execution/Execution';
import { insertToolAudit } from '../audit/toolAuditWrite';
import { parseCloudAgentRef } from './cloudDispatch';

/** The failed run as the trace event reads it (an `Execution`, or a set-based UPDATE's RETURNING row). */
export interface FailedRunEventSource {
  tenantId: number;
  agentHostId: number | null;
  payload: string | null;
  executionId: number;
  errorMessage: string | null;
}

/**
 * The `tool_audit_events` row (minus `ts`) for a run that terminally failed - the ONE shape, so the per-run writer below and the
 * reaper's multi-row insert cannot drift. Cloud runs carry no `cloud_agent_ref` column (attribution lives in the payload), so the
 * ref is recovered from it to attribute the event to the same chip the run's other telemetry is attributed to.
 */
export function runFailureEventRow(r: FailedRunEventSource, toolName = 'run.failed') {
  return {
    tenantId:      r.tenantId,
    agentHostId:   r.agentHostId,
    cloudAgentRef: parseCloudAgentRef(r.payload ?? undefined) ?? null,
    executionId:   r.executionId,
    sessionKey:    `exec:${r.executionId}`,
    toolName,
    category:      'error',
    result:        r.errorMessage ?? 'Run failed',
  };
}

/**
 * Record a terminal-failure as a `tool_audit_events` row so it surfaces on the
 * Observability Logs + Timeline exactly like every other trace event.
 *
 * The Logs/Timeline are derived *only* from `tool_audit_events`; a failure that
 * is written solely to `executions.error_message` (orphan-reap, in-loop FAILED,
 * the stale-run reaper) is invisible there - the timeline just stops at the last
 * successful tool call. Emitting a `run.failed` event (category `error`) closes
 * that gap with one source of truth, keyed by `execution_id` (the per-run trace
 * key) so the embedded per-execution Logs/Timeline pick it up regardless of how
 * the run was attributed. Best-effort - telemetry must never break a transition.
 */
export async function recordRunFailureEvent(db: Db, e: Execution): Promise<void> {
  try {
    await insertToolAudit(db, {
      ...runFailureEventRow({
        tenantId: Number(e.tenantId), agentHostId: e.agentHostId != null ? Number(e.agentHostId) : null,
        payload: e.payload, executionId: Number(e.id), errorMessage: e.errorMessage,
      }),
      ts: new Date(),
    });
  } catch (error) {
    reportCaughtError(error, { source: "application/runtime/recordRunFailureEvent.ts", operation: "recordRunFailureEvent", context: { logMessage: '[run-failure-event] telemetry append failed', details: {
      tenantId: Number(e.tenantId),
      executionId: Number(e.id),
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    } } });
  }
}
