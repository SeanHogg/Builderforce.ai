/**
 * The run budget (cost lever A2) — what a cloud run has spent, read cheaply, and what
 * it is told about what is left.
 *
 * Before A2 every turn re-SUMmed the run's ledger rows to check a declared spend limit.
 * Under A2 the run carries its own running totals in `CloudLoopState` (`spentMillicents`,
 * `tokensUsed`), updated from each turn's usage; the ledger SUM is kept as the fallback
 * for a resumed run whose state predates the totals, and for a delegated child, whose
 * limit is the whole tree's (its tokens bill to its parent).
 */
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../../../infrastructure/database/connection';
import { executions, llmUsageLog } from '../../../infrastructure/database/schema';
import type { Env } from '../../../env';
import { computeRecordedCostMillicents, usageDatabaseOf } from '../../llm/usageLedger';
import { loadPriceBook } from '../../llm/catalogView';
import type { ProxyResult } from '../../llm/proxyTypes';
import { reportCaughtError } from '../../observability/caughtErrorReporter';
import { RUN_BUDGET_WARN_AT } from '@builderforce/spend-contract';
import { resolveRunTokenCap, runBudgetUsedShare, type RunLimits, type RunUsage } from '../../../domain/containment/runLimits';

export interface RunSpend {
  spentMillicents: number;
  tokensUsed: number;
}

/** The run's recorded spend + tokens, from the ledger (the pre-A2 read, kept as the fallback). */
export async function ledgerRunSpend(db: Db, tenantId: number, meterExecutionId: number): Promise<RunSpend> {
  const [row] = await usageDatabaseOf(db).select({
    total: sql<number>`COALESCE(SUM(${llmUsageLog.costUsdMillicents}), 0)`,
    tokens: sql<number>`COALESCE(SUM(${llmUsageLog.promptTokens} + ${llmUsageLog.completionTokens}), 0)`,
  })
    .from(llmUsageLog)
    .where(and(eq(llmUsageLog.tenantId, tenantId), eq(llmUsageLog.executionId, meterExecutionId)));
  return { spentMillicents: Number(row?.total ?? 0), tokensUsed: Number(row?.tokens ?? 0) };
}

/** The run's token cap: `payload.containmentLimits.maxTokens`, else the plan default. Best-effort read. */
export async function readRunTokenCap(db: Db, tenantId: number, executionId: number, plan: string): Promise<number> {
  let override: unknown;
  try {
    const [run] = await db.select({ payload: executions.payload }).from(executions)
      .where(and(eq(executions.id, executionId), eq(executions.tenantId, tenantId))).limit(1);
    const parsed = run?.payload ? JSON.parse(run.payload) as { containmentLimits?: { maxTokens?: unknown } } : null;
    override = parsed?.containmentLimits?.maxTokens;
  } catch { override = undefined; }
  return resolveRunTokenCap(plan, override);
}

/** Tokens + platform cost of one turn (BYO-funded turns cost 0, but their tokens count). */
export async function turnSpend(env: Env, result: Pick<ProxyResult, 'usage' | 'resolvedModel' | 'byoFunded'>): Promise<RunSpend> {
  const usage = result.usage;
  if (!usage) return { spentMillicents: 0, tokensUsed: 0 };
  const tokensUsed = Math.max(0, (usage.promptTokens || 0) + (usage.completionTokens || 0));
  if (result.byoFunded) return { spentMillicents: 0, tokensUsed };
  try {
    const price = (await loadPriceBook(env)).priceOf(result.resolvedModel);
    const pricing = price ? { prompt: price.input, completion: price.output } : undefined;
    return { spentMillicents: computeRecordedCostMillicents(pricing, usage, false, false), tokensUsed };
  } catch (error) {
    reportCaughtError(error, { source: 'application/runtime/costLoop/runBudget.ts', operation: 'turnSpend' });
    return { spentMillicents: 0, tokensUsed };
  }
}

/** Share of the budget at which the run is told to converge — the shared budget rule's
 *  warning line, which the editor's run store warns at too. */
export const CONVERGE_AT = RUN_BUDGET_WARN_AT;

/** The per-turn budget line (and, past {@link CONVERGE_AT}, the converge instruction). */
export function renderBudget(limits: RunLimits, usage: RunUsage): string {
  const parts: string[] = [];
  if (limits.maxSpendMillicents != null) {
    parts.push(`~$${(Math.max(0, limits.maxSpendMillicents - usage.spendMillicents) / 100_000).toFixed(2)}`);
  }
  if (limits.maxTokens != null) parts.push(`~${Math.max(0, limits.maxTokens - (usage.tokens ?? 0))} tokens`);
  if (parts.length === 0) return '';
  const line = `Budget left: ${parts.join(', ')}.`;
  return runBudgetUsedShare(limits, usage) >= CONVERGE_AT
    ? `${line} You have used over ${Math.round(CONVERGE_AT * 100)}% of this run's budget: stop exploring and converge — `
      + 'finish the essential change, record anything left with builtin_tasks_create or update_task_state, and call finish.'
    : line;
}
