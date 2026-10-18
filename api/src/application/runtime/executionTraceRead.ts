/**
 * One execution's trace — usage snapshots, tool-audit events, the steering
 * thread, the structured LLM turns and the run's own spend.
 *
 * Moved out of `GET /executions/:id/trace` so the route holds no SQL, and given a
 * CURSOR: a live run's drawer re-reads its trace every few seconds, and before
 * the cursor each read returned up to 500 tool events with their full `args` /
 * `result` text — the same rows every tick. With `afterEventId` / `afterUsageId`
 * a tick returns only the telemetry rows written since the last one (both tables
 * are append-only with serial ids, so `id > cursor` is exact), filtered on top of
 * the per-run predicate the full read already uses. The thread, LLM turns and
 * cost are small and change in place, so they are always returned whole.
 */
import { and, desc, eq, gt } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { toolAuditEvents, usageSnapshots } from '../../infrastructure/database/schema';
import { runTelemetryDatabase } from '../shared/runTelemetryDatabase';
import { listExecutionMessages } from './executionSteering';
import { listExecutionLlmTurns } from '../llm/executionTraces';
import { executionUsageCost } from '../llm/usageQuery';
import type { Env } from '../../env';

/** The newest telemetry rows the caller already holds. Absent ⇒ a full read. */
export interface ExecutionTraceCursor {
  afterEventId?: number;
  afterUsageId?: number;
}

export interface ExecutionTraceRun {
  executionId: number;
  tenantId: number;
  agentHostId: number | null;
  sessionId: string | null;
}

const ROW_LIMIT = 500;

export async function readExecutionTrace(env: Env, db: Db, run: ExecutionTraceRun, cursor: ExecutionTraceCursor = {}) {
  const { executionId, tenantId, agentHostId: hostId, sessionId } = run;
  // Self-hosted runs are keyed by (agent_host_id, session_key); cloud runs have
  // neither, so their telemetry (0092) is keyed by execution_id. Pick the filter
  // that matches the run shape rather than bailing out for cloud executions.
  const isCloudRun = hostId == null || !sessionId;
  const usageFilter = and(
    isCloudRun
      ? and(eq(usageSnapshots.tenantId, tenantId), eq(usageSnapshots.executionId, executionId))
      : and(eq(usageSnapshots.tenantId, tenantId), eq(usageSnapshots.agentHostId, hostId!), eq(usageSnapshots.sessionKey, sessionId!)),
    cursor.afterUsageId ? gt(usageSnapshots.id, cursor.afterUsageId) : undefined,
  );
  const toolFilter = and(
    isCloudRun
      ? and(eq(toolAuditEvents.tenantId, tenantId), eq(toolAuditEvents.executionId, executionId))
      : and(eq(toolAuditEvents.tenantId, tenantId), eq(toolAuditEvents.agentHostId, hostId!), eq(toolAuditEvents.sessionKey, sessionId!)),
    cursor.afterEventId ? gt(toolAuditEvents.id, cursor.afterEventId) : undefined,
  );

  const telemetry = runTelemetryDatabase(db);
  const [usage, toolEvents, messages, llmTurns, cost] = await Promise.all([
    telemetry
      .select({
        id: usageSnapshots.id,
        ts: usageSnapshots.ts,
        inputTokens: usageSnapshots.inputTokens,
        outputTokens: usageSnapshots.outputTokens,
        contextTokens: usageSnapshots.contextTokens,
        contextWindowMax: usageSnapshots.contextWindowMax,
        compactionCount: usageSnapshots.compactionCount,
      })
      .from(usageSnapshots)
      .where(usageFilter)
      .orderBy(desc(usageSnapshots.ts))
      .limit(ROW_LIMIT),
    telemetry
      .select({
        id: toolAuditEvents.id,
        ts: toolAuditEvents.ts,
        toolName: toolAuditEvents.toolName,
        category: toolAuditEvents.category,
        durationMs: toolAuditEvents.durationMs,
        args: toolAuditEvents.args,
        result: toolAuditEvents.result,
        runId: toolAuditEvents.runId,
        toolCallId: toolAuditEvents.toolCallId,
      })
      .from(toolAuditEvents)
      .where(toolFilter)
      .orderBy(desc(toolAuditEvents.ts))
      .limit(ROW_LIMIT),
    // The durable steering/chat thread (0109) — so a steer survives a reload and
    // the Output tab can render the real conversation, not just optimistic echoes.
    listExecutionMessages(db, tenantId, executionId),
    // The run's LLM turns as STRUCTURED rows (0949): resolved model, vendor, token
    // counts, duration, and the trace id each turn can be looked up by.
    listExecutionLlmTurns(env, tenantId, executionId),
    // The run's OWN spend (every usage row stamped with this execution_id).
    executionUsageCost(env, db, tenantId, executionId),
  ]);

  return {
    source: isCloudRun ? 'cloud-telemetry' : 'runtime-fallback',
    usageSnapshots: usage,
    toolEvents,
    messages,
    llmTurns,
    cost,
    /** True when this read only carries rows past the caller's cursor. */
    incremental: Boolean(cursor.afterEventId || cursor.afterUsageId),
  };
}
