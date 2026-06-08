import type { Db } from '../../infrastructure/database/connection';
import type { Execution } from '../../domain/execution/Execution';
import { toolAuditEvents } from '../../infrastructure/database/schema';

/**
 * Cloud-agent ref pinned in an execution's JSON payload, if any. Cloud runs carry
 * no `cloud_agent_ref` column (attribution lives in the payload / the ticket's
 * assigned agent), so we recover it from the payload to attribute the failure
 * event to the same chip the run's other telemetry is attributed to.
 */
function cloudRefFromPayload(payload: string | null): string | null {
  if (!payload) return null;
  try {
    const p = JSON.parse(payload) as { cloudAgentRef?: unknown };
    return typeof p.cloudAgentRef === 'string' && p.cloudAgentRef.trim() ? p.cloudAgentRef.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Record a terminal-failure as a `tool_audit_events` row so it surfaces on the
 * Observability Logs + Timeline exactly like every other trace event.
 *
 * The Logs/Timeline are derived *only* from `tool_audit_events`; a failure that
 * is written solely to `executions.error_message` (orphan-reap, in-loop FAILED,
 * the stale-run reaper) is invisible there — the timeline just stops at the last
 * successful tool call. Emitting a `run.failed` event (category `error`) closes
 * that gap with one source of truth, keyed by `execution_id` (the per-run trace
 * key) so the embedded per-execution Logs/Timeline pick it up regardless of how
 * the run was attributed. Best-effort — telemetry must never break a transition.
 */
export async function recordRunFailureEvent(db: Db, e: Execution): Promise<void> {
  try {
    await db.insert(toolAuditEvents).values({
      tenantId:      e.tenantId,
      agentHostId:   e.agentHostId ?? null,
      cloudAgentRef: cloudRefFromPayload(e.payload),
      executionId:   e.id,
      sessionKey:    `exec:${e.id}`,
      toolName:      'run.failed',
      category:      'error',
      result:        e.errorMessage ?? 'Run failed',
      ts:            new Date(),
    });
  } catch {
    /* telemetry is best-effort — never break a status transition on it */
  }
}
