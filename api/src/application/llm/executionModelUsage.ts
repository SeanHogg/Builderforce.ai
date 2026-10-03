import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { llmUsageLog, toolAuditEvents } from '../../infrastructure/database/schema';
import { runTelemetryDatabase } from '../shared/runTelemetryDatabase';

/** One model a run used, and whether the tenant's own credential paid for it. */
export interface ExecutionModelUse {
  model: string;
  byo: boolean;
  provider: string | null;
}

/**
 * The distinct models behind each execution, read from `usageDb` — the database that
 * owns `llm_usage_log` (`resolveUsageDatabase`; the operational one in production).
 *
 * A core-database list that shows per-run model attribution used to get it from a
 * correlated subquery against the core copy of the ledger, which stopped receiving rows
 * when the ledger moved. One bounded `IN` read replaces the per-row subquery.
 */
export async function modelUsageByExecution(
  usageDb: Db,
  tenantId: number,
  executionIds: readonly (number | null)[],
): Promise<Map<number, ExecutionModelUse[]>> {
  const ids = [...new Set(executionIds.flatMap((id) => (id == null ? [] : [id])))];
  const out = new Map<number, ExecutionModelUse[]>();
  if (ids.length === 0) return out;

  const rows = await usageDb
    .selectDistinct({
      executionId: llmUsageLog.executionId,
      model: llmUsageLog.model,
      byo: llmUsageLog.byo,
      provider: llmUsageLog.byoProvider,
    })
    .from(llmUsageLog)
    .where(and(eq(llmUsageLog.tenantId, tenantId), inArray(llmUsageLog.executionId, ids)));

  for (const row of rows) {
    if (row.executionId == null) continue;
    const list = out.get(row.executionId) ?? [];
    list.push({ model: row.model, byo: row.byo, provider: row.provider });
    out.set(row.executionId, list);
  }
  return out;
}

/**
 * The distinct models each execution's `llm.complete` audit events name — the model
 * attribution the Changes tab shows beside a file, read from the run-telemetry database
 * where `tool_audit_events` lives.
 *
 * Same reason as {@link modelUsageByExecution}: this was a correlated subquery from the
 * core list into the audit trail, which cannot run once the two are separate databases.
 */
export async function auditedModelsByExecution(
  core: Db,
  tenantId: number,
  executionIds: readonly (number | null)[],
): Promise<Map<number, string[]>> {
  const ids = [...new Set(executionIds.flatMap((id) => (id == null ? [] : [id])))];
  const out = new Map<number, string[]>();
  if (ids.length === 0) return out;

  const model = sql<string>`substring(${toolAuditEvents.args} from '"model"\\s*:\\s*"([^"]+)"')`;
  const rows = await runTelemetryDatabase(core)
    .selectDistinct({ executionId: toolAuditEvents.executionId, model })
    .from(toolAuditEvents)
    .where(and(
      eq(toolAuditEvents.tenantId, tenantId),
      inArray(toolAuditEvents.executionId, ids),
      eq(toolAuditEvents.toolName, 'llm.complete'),
      isNotNull(model),
    ));

  for (const row of rows) {
    if (row.executionId == null || !row.model) continue;
    const list = out.get(row.executionId) ?? [];
    list.push(row.model);
    out.set(row.executionId, list);
  }
  return out;
}
