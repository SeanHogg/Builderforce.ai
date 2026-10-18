/**
 * THE tool-audit read — what a run's Logs / Timeline / Observability views show.
 *
 * Two doors read it: a cloud agent's (`GET /api/runtime/agents/:ref/tool-audit`)
 * and a host's (`GET /api/agent-hosts/:id/tool-audit`). They had each written the
 * same projection, the same per-execution scope and the same read-path repair
 * call out longhand; only WHO the events belong to differs, so that is the one
 * thing a caller passes ({@link ToolAuditScope}). The order differs too, and stays a
 * parameter: the cloud timeline renders newest-first, the host log oldest-first, and
 * both clients already depend on it.
 */
import { and, asc, desc, eq, isNull, type SQL } from 'drizzle-orm';
import { toolAuditEvents } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import { runTelemetryDatabase } from '../shared/runTelemetryDatabase';
import { DEFAULT_CLOUD_REF } from './cloudAgent/agent';
import { synthesizeRunFailedEvent, type ToolAuditEventRow } from './toolAuditReadRepair';

export type ToolAuditScope =
  /** A cloud agent by ref; `DEFAULT_CLOUD_REF` = runs with no named agent. */
  | { kind: 'cloudAgent'; ref: string }
  /** A self-hosted agent host, optionally narrowed to one run or session. */
  | { kind: 'agentHost'; agentHostId: number; runId?: string | null; sessionKey?: string | null };

export interface ToolAuditReadOptions {
  limit: number;
  order: 'newest' | 'oldest';
  /** One run's events only — authoritative, and the trigger for the failure repair. */
  executionId?: number | null;
}

function scopeConditions(scope: ToolAuditScope, executionId: number | null): SQL[] {
  if (scope.kind === 'agentHost') {
    return [
      eq(toolAuditEvents.agentHostId, scope.agentHostId),
      ...(scope.runId ? [eq(toolAuditEvents.runId, scope.runId)] : []),
      ...(scope.sessionKey ? [eq(toolAuditEvents.sessionKey, scope.sessionKey)] : []),
      ...(executionId != null ? [eq(toolAuditEvents.executionId, executionId)] : []),
    ];
  }
  // An explicit executionId is authoritative for a cloud read (the events carry it
  // directly), so it scopes regardless of which ref the run was attributed to. The
  // default ref is cloud rows only (agent_host_id IS NULL) so a host run never leaks in.
  if (executionId != null) return [eq(toolAuditEvents.executionId, executionId)];
  if (scope.ref === DEFAULT_CLOUD_REF) {
    return [isNull(toolAuditEvents.cloudAgentRef), isNull(toolAuditEvents.agentHostId)];
  }
  return [eq(toolAuditEvents.cloudAgentRef, scope.ref)];
}

/** Read one scope's tool-audit events, with the terminal-failure repair applied. */
export async function readToolAuditEvents(
  db: Db,
  tenantId: number,
  scope: ToolAuditScope,
  options: ToolAuditReadOptions,
): Promise<ToolAuditEventRow[]> {
  const executionId = options.executionId ?? null;
  const events: ToolAuditEventRow[] = await runTelemetryDatabase(db)
    .select({
      id: toolAuditEvents.id,
      runId: toolAuditEvents.runId,
      sessionKey: toolAuditEvents.sessionKey,
      toolCallId: toolAuditEvents.toolCallId,
      toolName: toolAuditEvents.toolName,
      category: toolAuditEvents.category,
      args: toolAuditEvents.args,
      result: toolAuditEvents.result,
      durationMs: toolAuditEvents.durationMs,
      executionId: toolAuditEvents.executionId,
      ts: toolAuditEvents.ts,
    })
    .from(toolAuditEvents)
    .where(and(eq(toolAuditEvents.tenantId, tenantId), ...scopeConditions(scope, executionId)))
    .orderBy(options.order === 'newest' ? desc(toolAuditEvents.ts) : asc(toolAuditEvents.ts))
    .limit(options.limit);

  // Read-path repair: a run that failed without emitting `run.failed` still shows its
  // terminal failure — at the END of the timeline, whichever way it is ordered.
  if (executionId != null) {
    const synthetic = await synthesizeRunFailedEvent(db, tenantId, executionId, events);
    if (synthetic) {
      if (options.order === 'newest') events.unshift(synthetic);
      else events.push(synthetic);
    }
  }
  return events;
}
