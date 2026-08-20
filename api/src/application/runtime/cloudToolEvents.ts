import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * cloudToolEvents — the tool-audit emitter for cloud runs.
 *
 * Extracted from `cloudAgentEngine` (which re-exports it, so every existing caller
 * is unchanged) purely so modules the ENGINE itself depends on — notably
 * `runRollback` — can emit timeline events without an import cycle back into the
 * engine.
 */
import { toolAuditEvents } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import { notifyExecutionSubscribers } from './executionEvents';

/**
 * Record one cloud-agent tool-audit event so cloud runs are observable on the
 * Timeline exactly like self-hosted agents (which push tool-audit via the relay).
 * Cloud runs have no agent_host_id / live session, so rows are keyed by the cloud
 * agent ref + execution id (migration 0092). Best-effort — never throws.
 *
 * THIS IS ALSO THE LIVE TAIL. Every persisted row is immediately re-published as a
 * `tool_event` on the execution's live stream, so the Logs/Timeline views render a
 * cloud run as it happens instead of deriving lines from a polled tool-audit read
 * behind a Refresh button. The push is hooked HERE — the single writer — and
 * nowhere else, so no call site can record an event the stream never sees.
 * The insert returns its id so a client that backfilled over REST dedupes exactly.
 */
export async function recordCloudToolEvent(
  db: Db,
  args: {
    tenantId: number;
    cloudAgentRef?: string;
    /** The execution this event belongs to, or `null` for a task-scoped event
     *  (e.g. a Done-transition `pr_opened` with no live execution). When null,
     *  pass `sessionKey` (e.g. `task:<id>`) so the row still has a correlation key. */
    executionId: number | null;
    /** Override the default `exec:<id>` correlation key. Required when
     *  `executionId` is null so the row isn't keyed `exec:null`. */
    sessionKey?: string;
    toolName: string;
    category: string;
    toolCallId?: string;
    detail?: unknown;
    result?: string;
    durationMs?: number;
  },
): Promise<void> {
  const ts = new Date();
  try {
    const [row] = await db.insert(toolAuditEvents).values({
      tenantId:     args.tenantId,
      agentHostId:  null,
      cloudAgentRef: args.cloudAgentRef ?? null,
      executionId:  args.executionId,
      sessionKey:   args.sessionKey ?? (args.executionId != null ? `exec:${args.executionId}` : null),
      toolCallId:   args.toolCallId ?? null,
      toolName:     args.toolName,
      category:     args.category,
      args:         args.detail != null ? JSON.stringify(args.detail) : null,
      result:       args.result ?? null,
      durationMs:   args.durationMs ?? null,
      ts,
    }).returning({ id: toolAuditEvents.id });

    if (args.executionId != null) {
      notifyExecutionSubscribers(args.executionId, {
        type: 'tool_event',
        executionId: args.executionId,
        id: row?.id ?? null,
        cloudAgentRef: args.cloudAgentRef ?? null,
        toolName: args.toolName,
        category: args.category,
        ...(args.result != null ? { result: args.result } : {}),
        ...(args.durationMs != null ? { durationMs: args.durationMs } : {}),
        ts: ts.toISOString(),
      });
    }
  } catch (error) {
    // Telemetry remains non-blocking, but a missing tool record can no longer be
    // silent—the correlation fields are enough to find the affected run.
    reportCaughtError(error, { source: "application/runtime/cloudToolEvents.ts", operation: "recordCloudToolEvent", context: { logMessage: '[cloud-tool-event] append failed', details: {
      tenantId: args.tenantId,
      executionId: args.executionId,
      cloudAgentRef: args.cloudAgentRef ?? null,
      toolName: args.toolName,
      toolCallId: args.toolCallId ?? null,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    } } });
  }
}
