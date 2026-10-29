/**
 * runUsageCost — what a cloud run actually used, read from its usage ledger (extracted from `scoreRunOutcome`).
 *
 * An UNKNOWN cost is NULL, never free: no usage rows, or a lookup that failed, yield `costMc: null`; a genuine zero (BYO / local
 * usage rows that really sum to 0) stays 0.
 */
import { desc, eq, sql } from 'drizzle-orm';
import { llmUsageLog } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import { usageDatabaseOf, usageRequestCount } from '../llm/usageLedger';
import { reportCaughtError } from '../observability/caughtErrorReporter';

/** Most-frequent llm_usage_log.model for an execution — the model the run actually
 *  locked onto (the truth of what ran). Empty when the run produced no LLM calls. */
export async function resolveRunModel(db: Db, executionId: number): Promise<{ model: string; steps: number; costMc: number | null }> {
  try {
    const rows = await usageDatabaseOf(db)
      .select({
        model: llmUsageLog.model,
        n: usageRequestCount(),
        cost: sql<number>`coalesce(sum(${llmUsageLog.costUsdMillicents}), 0)::int`,
      })
      .from(llmUsageLog)
      .where(eq(llmUsageLog.executionId, executionId))
      .groupBy(llmUsageLog.model)
      .orderBy(desc(usageRequestCount()));
    // No usage rows means the cost is UNKNOWN, not zero: NULL, never free. (A genuine 0 below is real usage that sums to 0.)
    if (rows.length === 0) return { model: '', steps: 0, costMc: null };
    const steps = rows.reduce((a, r) => a + (Number(r.n) || 0), 0);
    const costMc = rows.reduce((a, r) => a + (Number(r.cost) || 0), 0);
    return { model: rows[0]?.model ?? '', steps, costMc };
  } catch (error) {
    // A failed lookup is an unknown cost, not a free run: reported, and NULL is what gets stored.
    reportCaughtError(error, { source: 'application/runtime/runUsageCost.ts', operation: 'resolveRunModel', context: { executionId } });
    return { model: '', steps: 0, costMc: null };
  }
}
