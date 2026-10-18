/**
 * A cloud run's per-turn usage, read from the billing ledger.
 *
 * WHY THIS READS `llm_usage_log` AND NOT `usage_snapshots`. `recordCloudUsage` used to
 * write each turn's tokens twice — once to `usage_snapshots` for the run trace and once
 * to `llm_usage_log` for billing — and the test that pinned them to agree is the proof
 * they were the same numbers. The second copy cost database space on an endpoint at its
 * ceiling, so the ledger row (already stamped `execution_id`) is now the only write and
 * the trace is projected from it into the SAME row shape the snapshot table had.
 * `usage_snapshots` remains the host-gauge table (`hostTelemetryIngest`, runtimeRoutes).
 *
 * Shared by the trace route (`executionTraceRead`) and the Brain `executions.trace` tool
 * so the projection exists once.
 */
import { desc, eq, gt } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { llmUsageLog } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { usageDatabaseOf } from '../llm/usageLedger';

export const CLOUD_RUN_USAGE_LIMIT = 500;

/** The `usage_snapshots` row shape the trace consumers already render. */
export interface CloudRunUsagePoint {
  id: number;
  tenantId: number;
  agentHostId: null;
  cloudAgentRef: string | null;
  executionId: number;
  sessionKey: string;
  inputTokens: number;
  outputTokens: number;
  contextTokens: number;
  contextWindowMax: number;
  compactionCount: number;
  ts: Date;
  createdAt: Date;
}

/**
 * Ledger rows for one execution, NEWEST FIRST (the order the snapshot read had, capped at
 * {@link CLOUD_RUN_USAGE_LIMIT}), after the optional `afterId` cursor. A folded day-row (see the usage rollup) is one point.
 */
export async function readCloudRunUsage(
  db: Db,
  tenantId: number,
  executionId: number,
  afterId?: number,
): Promise<CloudRunUsagePoint[]> {
  const rows = await usageDatabaseOf(db)
    .select({
      id: llmUsageLog.id,
      cloudAgentRef: llmUsageLog.cloudAgentRef,
      promptTokens: llmUsageLog.promptTokens,
      completionTokens: llmUsageLog.completionTokens,
      createdAt: llmUsageLog.createdAt,
    })
    .from(llmUsageLog)
    .where(scopedToTenant(llmUsageLog, tenantId,
      eq(llmUsageLog.executionId, executionId),
      afterId ? gt(llmUsageLog.id, afterId) : undefined,
    ))
    .orderBy(desc(llmUsageLog.id))
    .limit(CLOUD_RUN_USAGE_LIMIT);
  return rows.map((r) => ({
    id: r.id,
    tenantId,
    agentHostId: null,
    cloudAgentRef: r.cloudAgentRef ?? null,
    executionId,
    sessionKey: `exec:${executionId}`,
    inputTokens: r.promptTokens,
    outputTokens: r.completionTokens,
    contextTokens: r.promptTokens + r.completionTokens,
    contextWindowMax: 0,
    compactionCount: 0,
    ts: r.createdAt,
    createdAt: r.createdAt,
  }));
}
