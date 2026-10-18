/**
 * Agent-host usage reads — the `usage_snapshots` telemetry a host posts per session
 * (input/output tokens, context fill, compactions).
 *
 * Distinct from the billing ledger on purpose: `llm_usage_log` (see
 * `llm/usageQuery.ts`) is what a call COST; a snapshot is what a host's session
 * LOOKED like — context window pressure and compaction count have no ledger column.
 * So this is its own small reader rather than a dimension of the usage query.
 *
 * Extracted from `agentHostRoutes.ts` (the portal Usage tab list and the host's own
 * 30-day quota read) and the Brain's `usage_snapshots.list` tool, which each issued
 * the same statement. The quota read also summed every row of 30 days in JS; it is a
 * SQL SUM here.
 */
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { usageSnapshots } from '../../infrastructure/database/schema';
import { runTelemetryDatabase } from '../shared/runTelemetryDatabase';

/** Newest-first snapshots for one host, tenant-scoped. */
export function listAgentHostUsageSnapshots(db: Db, tenantId: number, agentHostId: number, limit: number) {
  return runTelemetryDatabase(db)
    .select()
    .from(usageSnapshots)
    .where(and(eq(usageSnapshots.tenantId, tenantId), eq(usageSnapshots.agentHostId, agentHostId)))
    .orderBy(desc(usageSnapshots.ts))
    .limit(limit);
}

/** Input/output token totals for one host since `since`. */
export async function agentHostUsageTotals(
  db: Db,
  tenantId: number,
  agentHostId: number,
  since: Date,
): Promise<{ inputTokens: number; outputTokens: number }> {
  const [row] = await runTelemetryDatabase(db)
    .select({
      inputTokens: sql<string>`coalesce(sum(${usageSnapshots.inputTokens}), 0)::bigint`,
      outputTokens: sql<string>`coalesce(sum(${usageSnapshots.outputTokens}), 0)::bigint`,
    })
    .from(usageSnapshots)
    .where(and(
      eq(usageSnapshots.tenantId, tenantId),
      eq(usageSnapshots.agentHostId, agentHostId),
      gte(usageSnapshots.ts, since),
    ));
  return { inputTokens: Number(row?.inputTokens ?? 0), outputTokens: Number(row?.outputTokens ?? 0) };
}
