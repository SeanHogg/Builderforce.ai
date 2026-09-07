/**
 * Spend rollups off the usage ledger — the ONE reader for "what did this cost",
 * at the two grains the product shows: a ticket (every run on it) and a single
 * execution. Sums the authoritative `cost_usd_millicents` stamped on every usage
 * row, so a BYO-funded row (forced to 0) never inflates the figure.
 *
 * Cached read-through (KV 60s / L1 30s): an aggregate over the append-heavy usage
 * log that does not need to be to-the-second — the short TTL bounds staleness
 * without an invalidate-on-every-LLM-call hook. Same rationale as /dashboard/usage.
 */

import { and, eq, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { llmUsageLog } from '../../infrastructure/database/schema';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { millicentsToUsd } from '../../domain/shared/money';
import type { Env } from '../../env';

export interface UsageCostSummary {
  estimatedCostUsd: number;
  totalTokens: number;
  requests: number;
}

export const EMPTY_USAGE_COST: UsageCostSummary = { estimatedCostUsd: 0, totalTokens: 0, requests: 0 };

async function summarize(env: Env | undefined, db: Db, cacheKey: string, predicate: SQL): Promise<UsageCostSummary> {
  return getOrSetCached(
    env,
    cacheKey,
    async () => {
      // ::bigint comes back as a STRING from the driver, ::int as a number — the
      // Number() coercions below are what normalise both.
      const rows = await db
        .select({
          cost_mc: sql<string>`coalesce(sum(${llmUsageLog.costUsdMillicents}), 0)::bigint`,
          tokens: sql<string>`coalesce(sum(${llmUsageLog.totalTokens}), 0)::bigint`,
          requests: sql<number>`count(*)::int`,
        })
        .from(llmUsageLog)
        .where(predicate);
      const r = rows[0];
      return {
        estimatedCostUsd: millicentsToUsd(Number(r?.cost_mc ?? 0)),
        totalTokens: Number(r?.tokens ?? 0),
        requests: Number(r?.requests ?? 0),
      };
    },
    { kvTtlSeconds: 60, l1TtlMs: 30_000 },
  );
}

/** Ticket-level spend: the finest grain in the ticket → project → account rollup (0104). */
export function taskUsageCost(env: Env | undefined, db: Db, tenantId: number, taskId: number): Promise<UsageCostSummary> {
  if (!Number.isFinite(taskId)) return Promise.resolve(EMPTY_USAGE_COST);
  const predicate = and(eq(llmUsageLog.tenantId, tenantId), eq(llmUsageLog.taskId, taskId)) as SQL;
  return summarize(env, db, `task-cost:v1:${tenantId}:${taskId}`, predicate);
}

/** Run-level spend: every usage row stamped with this `execution_id` (0096). */
export function executionUsageCost(env: Env | undefined, db: Db, tenantId: number, executionId: number): Promise<UsageCostSummary> {
  if (!Number.isFinite(executionId)) return Promise.resolve(EMPTY_USAGE_COST);
  const predicate = and(eq(llmUsageLog.tenantId, tenantId), eq(llmUsageLog.executionId, executionId)) as SQL;
  return summarize(env, db, `exec-cost:v1:${tenantId}:${executionId}`, predicate);
}
