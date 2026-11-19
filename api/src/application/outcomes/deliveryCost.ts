/**
 * The authoritative cost of a delivery outcome.
 *
 * `costPerDelivery` (outcomeMetricContract.ts) sums `creation_outcome_events.cost_usd_millicents`
 * over successful deliveries. The ledger has always ACCEPTED that column; no producer ever
 * sent it, so the metric was permanently "Not measured". This module is the missing
 * producer-side lookup: given the scope a delivery happened in (a run/execution, or a
 * correlation the run stamped on its usage rows), it reads the run's LLM spend from the
 * usage ledger — `llm_usage_log.cost_usd_millicents`, the figure stamped at write time from
 * the resolved model's price (the same column `costMetricsStore` aggregates).
 *
 * ── NULL, NEVER ZERO ────────────────────────────────────────────────────────
 * "No usage rows for this scope" is not "this delivery was free": it is "we do not know".
 * Both that case and a scope with no handle at all resolve to `undefined`, so the ledger
 * records NULL and the metric stays "Not measured". A scope whose rows sum to exactly 0
 * (every call BYO-funded, which is forced to 0 by contract) IS a measured zero platform
 * cost and is returned as 0 — the distinction is the presence of rows, not the value.
 *
 * ── TENANT SCOPING ──────────────────────────────────────────────────────────
 * Every read is bound to the caller's tenant. A run id from another tenant resolves to
 * `undefined` rather than leaking that tenant's spend into this one's metric.
 *
 * Best-effort: a failed lookup reports and resolves `undefined`, so measurement can never
 * fail the delivery it describes.
 */

import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { llmUsageLog } from '../../infrastructure/database/schema';
import { usageDatabaseOf } from '../llm/usageLedger';
import { reportCaughtError } from '../observability/caughtErrorReporter';

/** Where a delivery's run cost is attributed. At least one handle is required. */
export interface DeliveryCostScope {
  /** Server-derived tenant. Every read is bound to it. */
  tenantId: number;
  /** The run (execution) that produced the delivery — the finest attribution grain. */
  executionId?: number | string | null;
  /** The ticket the run was working; used only when no execution is named. */
  taskId?: number | string | null;
  /** The project the delivery built; the coarsest handle, used only when no finer one has usage. */
  projectId?: number | string | null;
  /** The correlation id the run stamped in its usage metadata (`metadata.correlationId`). */
  correlationId?: string | null;
}

const positiveInt = (value: unknown): number | null => {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * Turn the raw aggregate into the ledger's value. `rowCount` is the number of usage rows
 * summed: zero rows is "no cost recorded" (undefined), never 0.
 */
export function deliveryCostFromAggregate(rowCount: unknown, totalMillicents: unknown): number | undefined {
  const rows = Number(rowCount);
  if (!Number.isFinite(rows) || rows <= 0) return undefined;
  const total = Number(totalMillicents);
  if (!Number.isFinite(total) || total < 0) return undefined;
  return Math.round(total);
}

/**
 * The attributed run LLM cost for one delivery, in millicents (1/100000 USD), or
 * `undefined` when none is recorded. Resolution order: execution, then correlation, then
 * ticket, then project — the first handle that has usage rows wins, so a precise handle is never diluted
 * by a coarser one.
 */
export async function readDeliveryCostMillicents(db: Db, scope: DeliveryCostScope): Promise<number | undefined> {
  const tenantId = positiveInt(scope.tenantId);
  if (tenantId === null) return undefined;
  const executionId = positiveInt(scope.executionId);
  const taskId = positiveInt(scope.taskId);
  const projectId = positiveInt(scope.projectId);
  const correlationId = typeof scope.correlationId === 'string' && scope.correlationId.trim()
    ? scope.correlationId.trim().slice(0, 128)
    : null;
  if (executionId === null && taskId === null && projectId === null && correlationId === null) return undefined;

  const handles = [
    executionId === null ? null : eq(llmUsageLog.executionId, executionId),
    correlationId === null ? null : sql`${llmUsageLog.metadata} ->> 'correlationId' = ${correlationId}`,
    // A ticket handle only counts for usage the run stamped to that ticket.
    taskId === null ? null : eq(llmUsageLog.taskId, taskId),
    projectId === null ? null : eq(llmUsageLog.projectId, projectId),
  ].filter((h): h is NonNullable<typeof h> => h !== null);

  try {
    for (const handle of handles) {
      const [row] = await usageDatabaseOf(db)
        .select({
          // usage-count-ok: ROWS are the unit here — "were any usage rows recorded for this
          // scope" — not a count of LLM calls.
          rows: sql<number>`COUNT(*)::int`,
          cost: sql<number>`COALESCE(SUM(${llmUsageLog.costUsdMillicents}), 0)::bigint`,
        })
        .from(llmUsageLog)
        .where(and(eq(llmUsageLog.tenantId, tenantId), handle));
      const cost = deliveryCostFromAggregate(row?.rows, row?.cost);
      if (cost !== undefined) return cost;
    }
    return undefined;
  } catch (error) {
    reportCaughtError(error, { source: 'application/outcomes/deliveryCost.ts', operation: 'readDeliveryCostMillicents' });
    return undefined;
  }
}
