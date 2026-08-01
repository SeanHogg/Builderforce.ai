/**
 * Tool-audit read-path repair — shared by the cloud (`runtimeRoutes`) and host
 * (`agentHostRoutes`) tool-audit reads so both surface a terminal failure identically.
 *
 * A run that FAILED before the failure-telemetry emit existed (or via any path that
 * missed it) has its reason only on `executions.error_message`; telemetry-only views
 * (Logs / Timeline) therefore never show it — the timeline just stops at the last
 * successful tool call. When a read is scoped to ONE execution and no persisted
 * `run.failed` event is present, synthesize the terminal event from the execution
 * row. Self-healing and idempotent (one indexed PK lookup), only on the per-execution
 * path. Previously this repair lived inline on the cloud read only, so a DISCONNECTED
 * host's Log tab (which reads the host endpoint) never surfaced `run.failed`.
 */
import { and, eq } from 'drizzle-orm';
import { executions } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';

/** The projection both tool-audit reads return per event (kept identical so the
 *  synthesized row drops into either result set unchanged). */
export interface ToolAuditEventRow {
  id: number;
  runId: string | null;
  sessionKey: string | null;
  toolCallId: string | null;
  toolName: string;
  category: string | null;
  args: string | null;
  result: string | null;
  durationMs: number | null;
  executionId: number | null;
  ts: Date;
}

/**
 * Synthesize the terminal `run.failed` event for a failed execution, or null when
 * one already exists / the run didn't fail. Callers pass the events they just read
 * (only `toolName` is inspected) so the lookup is skipped when a real failure event
 * is already present.
 */
export async function synthesizeRunFailedEvent(
  db: Db,
  tenantId: number,
  executionId: number,
  events: ReadonlyArray<Pick<ToolAuditEventRow, 'toolName'>>,
): Promise<ToolAuditEventRow | null> {
  if (events.some((e) => e.toolName === 'run.failed')) return null;

  const [exec] = await db
    .select({
      status: executions.status,
      errorMessage: executions.errorMessage,
      completedAt: executions.completedAt,
      updatedAt: executions.updatedAt,
    })
    .from(executions)
    .where(and(eq(executions.id, executionId), eq(executions.tenantId, tenantId)))
    .limit(1);

  if (exec?.status !== 'failed') return null;

  return {
    id: -executionId,
    runId: null,
    sessionKey: `exec:${executionId}`,
    toolCallId: null,
    toolName: 'run.failed',
    category: 'error',
    args: null,
    result: exec.errorMessage ?? 'Run failed',
    durationMs: null,
    executionId,
    ts: exec.completedAt ?? exec.updatedAt,
  };
}
