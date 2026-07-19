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

/**
 * Record one cloud-agent tool-audit event so cloud runs are observable on the
 * Timeline exactly like self-hosted agents (which push tool-audit via the relay).
 * Cloud runs have no agent_host_id / live session, so rows are keyed by the cloud
 * agent ref + execution id (migration 0092). Best-effort — never throws.
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
  try {
    await db.insert(toolAuditEvents).values({
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
      ts:           new Date(),
    });
  } catch { /* telemetry is best-effort — never break the run */ }
}
