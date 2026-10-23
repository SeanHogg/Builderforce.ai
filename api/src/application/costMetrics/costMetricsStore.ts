/**
 * The A4 cost-metric reads — the only SQL behind `/api/cost/*`.
 *
 * Both reads run on the usage ledger's own database (`usageDatabaseOf`). The metrics
 * statement JOINs `run_model_outcomes` there in SQL: that relation lives on the same
 * operational endpoint as `llm_usage_log` (`runTelemetryDatabase` resolves the same
 * sibling), so this is a same-database join, not a cross-endpoint one.
 *
 * Every figure is PROVIDER-REPORTED token usage and the cost stamped at write time; the
 * only estimates are the per-turn `tool_schema_tokens` / `metadata.context` split, which
 * the per-run read labels as such.
 */
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { executionLimits, executions, llmUsageLog, runModelOutcomes } from '../../infrastructure/database/schema';
import { usageDatabaseOf, usageRequestCountSql } from '../llm/usageLedger';
import { SERVED_WITHOUT_MODEL_SOURCES } from '../llm/savingsLedger';
import { runTelemetryDatabase } from '../shared/runTelemetryDatabase';
import { resultRows } from '../kernel/metricRollup';
import { COST_METRIC_GROUPS, type CostMetricGroupBy } from './costMetricGroups';

/** Groups one metrics read returns, most expensive first. */
export const COST_METRIC_GROUP_LIMIT = 200;
/** Turns one per-run read returns. */
export const RUN_TURN_LIMIT = 1000;

/** One group's raw aggregates, numbers already coerced. */
export interface CostMetricRow {
  groupKey: string;
  arm: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens: number;
  reasoningTokens: number;
  /** Completion tokens on the rows that REPORTED a reasoning split — the share's base. */
  reasoningReportedCompletion: number;
  costMillicents: number;
  medianContextTokens: number | null;
  completedRuns: number;
  medianTurns: number | null;
  mergedRuns: number;
  mergedCostMillicents: number;
  medianMergedCostMillicents: number | null;
}

const num = (v: unknown): number => (v == null ? 0 : Number(v) || 0);
const numOrNull = (v: unknown): number | null => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * The ledger window a read covers: the trailing `days` up to now, or an explicit
 * `[start, end)` range (a calendar month for the FinOps lens). One reader, so the
 * per-run attribution is the same whichever way the caller names its window.
 */
export type CostMetricWindowSpec = number | { start: Date; end: Date };

function windowFilter(window: CostMetricWindowSpec) {
  return typeof window === 'number'
    ? sql`u.created_at >= NOW() - make_interval(days => ${window}::int)`
    : sql`u.created_at >= ${window.start.toISOString()}::timestamptz AND u.created_at < ${window.end.toISOString()}::timestamptz`;
}

export async function readCostMetricRows(db: Db, tenantId: number, window: CostMetricWindowSpec, groupBy: CostMetricGroupBy): Promise<CostMetricRow[]> {
  const g = COST_METRIC_GROUPS[groupBy];
  const result = await usageDatabaseOf(db).execute(sql`
    WITH base AS (
      SELECT ${sql.raw(g.key)} AS group_key, ${sql.raw(g.arm)} AS arm,
             u.execution_id, u.calls, u.prompt_tokens, u.completion_tokens, u.cache_read_tokens,
             u.reasoning_tokens, u.cost_usd_millicents, o.terminal_status, o.merged
        FROM llm_usage_log u
        LEFT JOIN run_model_outcomes o ON o.execution_id = u.execution_id AND o.tenant_id = u.tenant_id
        ${sql.raw(g.join)}
       WHERE u.tenant_id = ${tenantId}
         AND ${windowFilter(window)}
         AND u.calls > 0
    ),
    turns AS (
      SELECT group_key, arm,
             SUM(calls)::bigint                AS calls,
             SUM(prompt_tokens)::bigint        AS prompt_tokens,
             SUM(completion_tokens)::bigint    AS completion_tokens,
             SUM(cache_read_tokens)::bigint    AS cache_read_tokens,
             COALESCE(SUM(reasoning_tokens), 0)::bigint AS reasoning_tokens,
             COALESCE(SUM(completion_tokens) FILTER (WHERE reasoning_tokens IS NOT NULL), 0)::bigint AS reasoning_reported_completion,
             SUM(cost_usd_millicents)::bigint  AS cost_millicents,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY prompt_tokens) FILTER (WHERE calls = 1) AS median_context_tokens
        FROM base
       GROUP BY group_key, arm
    ),
    runs AS (
      SELECT group_key, arm, execution_id,
             SUM(calls)               AS turns,
             SUM(cost_usd_millicents) AS cost,
             bool_or(terminal_status = 'completed') AS completed,
             bool_or(merged)          AS merged
        FROM base
       WHERE execution_id IS NOT NULL
       GROUP BY group_key, arm, execution_id
    ),
    run_stats AS (
      -- usage-count-ok: these count RUNS (one row per execution in the runs CTE), not
      -- LLM calls; a run's calls are already summed into its own turns column.
      SELECT group_key, arm,
             COUNT(*) FILTER (WHERE completed)::int AS completed_runs,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY turns) FILTER (WHERE completed) AS median_turns,
             COUNT(*) FILTER (WHERE merged)::int AS merged_runs,
             COALESCE(SUM(cost) FILTER (WHERE merged), 0)::bigint AS merged_cost,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY cost) FILTER (WHERE merged) AS median_merged_cost
        FROM runs
       GROUP BY group_key, arm
    )
    SELECT t.group_key, t.arm, t.calls, t.prompt_tokens, t.completion_tokens, t.cache_read_tokens,
           t.reasoning_tokens, t.reasoning_reported_completion, t.cost_millicents, t.median_context_tokens,
           r.completed_runs, r.median_turns, r.merged_runs, r.merged_cost, r.median_merged_cost
      FROM turns t
      LEFT JOIN run_stats r ON r.group_key = t.group_key AND r.arm = t.arm
     ORDER BY ${sql.raw(g.series ? 't.group_key ASC' : 't.cost_millicents DESC')}
     LIMIT ${COST_METRIC_GROUP_LIMIT}
  `);
  return resultRows(result).map((r) => ({
    groupKey: String(r.group_key ?? ''),
    arm: String(r.arm ?? ''),
    calls: num(r.calls),
    promptTokens: num(r.prompt_tokens),
    completionTokens: num(r.completion_tokens),
    cacheReadTokens: num(r.cache_read_tokens),
    reasoningTokens: num(r.reasoning_tokens),
    reasoningReportedCompletion: num(r.reasoning_reported_completion),
    costMillicents: num(r.cost_millicents),
    medianContextTokens: numOrNull(r.median_context_tokens),
    completedRuns: num(r.completed_runs),
    medianTurns: numOrNull(r.median_turns),
    mergedRuns: num(r.merged_runs),
    mergedCostMillicents: num(r.merged_cost),
    medianMergedCostMillicents: numOrNull(r.median_merged_cost),
  }));
}

/** Requests the window answered without a model, beside the ones a model served. */
export interface ServedWithoutModelRow {
  served: number;
  dispatched: number;
}

/**
 * The requests answered WITHOUT a model in the window — the `calls = 0` rows the stand-ins
 * already write (`SERVED_WITHOUT_MODEL_SOURCES`: response cache incl. semantic hits and
 * single-flight followers, memory / Evermind answer replays, the deterministic step) —
 * and the requests a model served (`SUM(calls)`), on the same ledger and window.
 */
export async function readServedWithoutModel(db: Db, tenantId: number, window: CostMetricWindowSpec): Promise<ServedWithoutModelRow> {
  const sources = sql.join(SERVED_WITHOUT_MODEL_SOURCES.map((s) => sql`${s}`), sql`, `);
  const result = await usageDatabaseOf(db).execute(sql`
    -- usage-count-ok: an answered-without-a-model row records calls = 0 by contract (it
    -- stands for a request no model served), so ROWS are the unit for it; the rollup that
    -- folds rows only touches rows older than any window this reads (90d > 30d).
    SELECT COUNT(*) FILTER (WHERE u.calls = 0 AND u.savings_source IN (${sources}))::int AS served,
           ${sql.raw(usageRequestCountSql('u'))} AS dispatched
      FROM llm_usage_log u
     WHERE u.tenant_id = ${tenantId}
       AND ${windowFilter(window)}
  `);
  const [r] = resultRows(result);
  return { served: num(r?.served), dispatched: num(r?.dispatched) };
}

/** What a run's budget is read from: its declared limits row and its dispatch payload. */
export interface RunBudgetInputs {
  /** `execution_limits.max_spend_millicents` — null when the run declared no row. */
  declaredSpendMillicents: number | null;
  /** The execution's raw payload (`containmentLimits` lives in it); null when absent. */
  payload: string | null;
  /** False when the execution does not exist for this tenant. */
  found: boolean;
}

export async function readRunBudgetInputs(db: Db, tenantId: number, executionId: number): Promise<RunBudgetInputs> {
  const [[run], [limits]] = await Promise.all([
    db.select({ payload: executions.payload }).from(executions)
      .where(and(eq(executions.tenantId, tenantId), eq(executions.id, executionId))).limit(1),
    db.select({ maxSpendMillicents: executionLimits.maxSpendMillicents }).from(executionLimits)
      .where(and(eq(executionLimits.tenantId, tenantId), eq(executionLimits.executionId, executionId))).limit(1),
  ]);
  return {
    declaredSpendMillicents: limits?.maxSpendMillicents ?? null,
    payload: run?.payload ?? null,
    found: !!run,
  };
}

/** One turn of one run, as the ledger recorded it. */
export interface RunTurnRow {
  id: number;
  createdAt: Date;
  model: string;
  role: string | null;
  turnIndex: number | null;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  reasoningTokens: number | null;
  toolSchemaTokens: number | null;
  costUsdMillicents: number;
  byo: boolean;
  context: unknown;
}

export async function readRunTurns(db: Db, tenantId: number, executionId: number): Promise<RunTurnRow[]> {
  return usageDatabaseOf(db)
    .select({
      id: llmUsageLog.id,
      createdAt: llmUsageLog.createdAt,
      model: llmUsageLog.model,
      role: llmUsageLog.role,
      turnIndex: llmUsageLog.turnIndex,
      calls: llmUsageLog.calls,
      promptTokens: llmUsageLog.promptTokens,
      completionTokens: llmUsageLog.completionTokens,
      cacheReadTokens: llmUsageLog.cacheReadTokens,
      cacheCreationTokens: llmUsageLog.cacheCreationTokens,
      reasoningTokens: llmUsageLog.reasoningTokens,
      toolSchemaTokens: llmUsageLog.toolSchemaTokens,
      costUsdMillicents: llmUsageLog.costUsdMillicents,
      byo: llmUsageLog.byo,
      context: sql<unknown>`${llmUsageLog.metadata} -> 'context'`,
    })
    .from(llmUsageLog)
    .where(and(eq(llmUsageLog.tenantId, tenantId), eq(llmUsageLog.executionId, executionId)))
    .orderBy(sql`${llmUsageLog.turnIndex} NULLS LAST`, asc(llmUsageLog.createdAt), asc(llmUsageLog.id))
    .limit(RUN_TURN_LIMIT);
}

/** The scored outcome of one run, when the scorer has landed it. */
export interface RunOutcomeRow {
  actionType: string;
  role: string | null;
  merged: boolean;
  terminalStatus: string;
  steps: number;
}

export async function readRunOutcome(db: Db, tenantId: number, executionId: number): Promise<RunOutcomeRow | null> {
  const [row] = await runTelemetryDatabase(db)
    .select({
      actionType: runModelOutcomes.actionType,
      role: runModelOutcomes.role,
      merged: runModelOutcomes.merged,
      terminalStatus: runModelOutcomes.terminalStatus,
      steps: runModelOutcomes.steps,
    })
    .from(runModelOutcomes)
    .where(and(eq(runModelOutcomes.tenantId, tenantId), eq(runModelOutcomes.executionId, executionId)))
    .limit(1);
  return row ?? null;
}
