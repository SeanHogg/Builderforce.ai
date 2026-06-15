/**
 * Learned Model Routing (PRD 13 §6.4) — the OUTCOME scorer.
 *
 * Fires on every TERMINAL path of a cloud run (worker finalize, durable terminal
 * tick, container fail, cancel) and writes ONE `run_model_outcomes` row joining the
 * run's (action_type, resolved_model) to a composite 0..1 score. Idempotent on
 * `execution_id` (unique index) and best-effort — it must NEVER block or fail a run.
 *
 * The pure {@link computeOutcomeScore} implements D3 and is unit-tested in isolation;
 * `scoreRunOutcome` only gathers the inputs (all of which already exist: executions
 * status, the PR row, coding_model_degraded events, llm_usage_log cost/turns, any
 * resolved approval) and persists, then folds the result into the routing-table KV
 * blobs (Welford, no table scan) so the next run's seed reflects it.
 */

import { and, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { approvals, executions, llmUsageLog, pullRequests, tasks, toolAuditEvents, runModelOutcomes } from '../../infrastructure/database/schema';
import { normalizeActionType } from '../llm/actionTypes';
import { applyOutcomeToRoutingTable } from '../llm/routingTable';
import { resolveTenantPlan } from '../../presentation/routes/llmRoutes';

// ── D3 score weights + efficiency normalization (named so they're tunable without a
//    schema change — see the Gap Register note on score calibration). ────────────
export const SCORE_WEIGHTS = {
  merge: 0.5,
  ci: 0.2,
  completion: 0.15,
  efficiency: 0.15,
} as const;
/** Steps at/above this count score 0 on the step half of efficiency (a run that
 *  loops forever is inefficient); 0 steps = max efficient. */
export const EFFICIENCY_STEP_NORM = 20;
/** Per-run cost (millicents) at/above which the cost half of efficiency hits 0
 *  ($2.00). Cheaper runs score proportionally higher. */
export const EFFICIENCY_COST_NORM_MC = 200_000;

export type TerminalStatus = 'completed' | 'failed' | 'cancelled';

export interface OutcomeScoreInputs {
  terminalStatus: TerminalStatus;
  merged: boolean;
  ciGreen: boolean;
  degraded: boolean;
  steps: number;
  costMc: number;
  /** A human approval for this run resolved to `approve` — pins completion to full. */
  approved: boolean;
}

export interface OutcomeScore {
  score: number;
  terms: { merge: number; ci: number; completion: number; efficiency: number };
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));

/**
 * Composite 0..1 outcome score (D3). A failed/cancelled run scores exactly 0 (no
 * merge, no CI, no credit for an unfinished run). A completed run earns: merge (0.5)
 * + green CI (0.2) + finished-without-degradation (0.15, pinned full by a human
 * approve) + efficiency (0.15, inverse of steps & cost). PURE — unit-tested directly.
 */
export function computeOutcomeScore(inputs: OutcomeScoreInputs): OutcomeScore {
  if (inputs.terminalStatus !== 'completed') {
    return { score: 0, terms: { merge: 0, ci: 0, completion: 0, efficiency: 0 } };
  }
  const merge = inputs.merged ? 1 : 0;
  const ci = inputs.ciGreen ? 1 : 0;
  // Completed without degradation = full; degraded run loses the term; a human
  // approval overrides to full regardless (a person signed off on the result).
  const completion = inputs.approved ? 1 : inputs.degraded ? 0 : 1;
  const stepScore = clamp01(1 - inputs.steps / EFFICIENCY_STEP_NORM);
  const costScore = clamp01(1 - inputs.costMc / EFFICIENCY_COST_NORM_MC);
  const efficiency = (stepScore + costScore) / 2;

  const score = clamp01(
    SCORE_WEIGHTS.merge * merge +
      SCORE_WEIGHTS.ci * ci +
      SCORE_WEIGHTS.completion * completion +
      SCORE_WEIGHTS.efficiency * efficiency,
  );
  return { score, terms: { merge, ci, completion, efficiency } };
}

/** Most-frequent llm_usage_log.model for an execution — the model the run actually
 *  locked onto (the truth of what ran). Empty when the run produced no LLM calls. */
async function resolveRunModel(db: Db, executionId: number): Promise<{ model: string; steps: number; costMc: number }> {
  try {
    const rows = await db
      .select({
        model: llmUsageLog.model,
        n: sql<number>`count(*)::int`,
        cost: sql<number>`coalesce(sum(${llmUsageLog.costUsdMillicents}), 0)::int`,
      })
      .from(llmUsageLog)
      .where(eq(llmUsageLog.executionId, executionId))
      .groupBy(llmUsageLog.model)
      .orderBy(desc(sql`count(*)`));
    if (rows.length === 0) return { model: '', steps: 0, costMc: 0 };
    const steps = rows.reduce((a, r) => a + (Number(r.n) || 0), 0);
    const costMc = rows.reduce((a, r) => a + (Number(r.cost) || 0), 0);
    return { model: rows[0]?.model ?? '', steps, costMc };
  } catch {
    return { model: '', steps: 0, costMc: 0 };
  }
}

/** The latest PR row for a task → (merged, ciGreen). merged also covers a merged-by
 *  status without an explicit mergedAt timestamp. */
async function resolveTaskPrSignal(db: Db, tenantId: number, taskId: number): Promise<{ merged: boolean; ciGreen: boolean }> {
  try {
    const [row] = await db
      .select({ status: pullRequests.status, mergedAt: pullRequests.mergedAt, buildStatus: pullRequests.buildStatus })
      .from(pullRequests)
      .where(and(eq(pullRequests.taskId, taskId), eq(pullRequests.tenantId, tenantId)))
      .orderBy(sql`${pullRequests.number} is not null desc`, desc(pullRequests.createdAt))
      .limit(1);
    if (!row) return { merged: false, ciGreen: false };
    return {
      merged: row.status === 'merged' || row.mergedAt != null,
      ciGreen: row.buildStatus === 'success',
    };
  } catch {
    return { merged: false, ciGreen: false };
  }
}

async function runWasDegraded(db: Db, executionId: number): Promise<boolean> {
  try {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(toolAuditEvents)
      .where(and(eq(toolAuditEvents.executionId, executionId), eq(toolAuditEvents.toolName, 'coding_model_degraded')))
      .limit(1);
    return (Number(row?.n) || 0) > 0;
  } catch {
    return false;
  }
}

async function runWasApproved(db: Db, executionId: number): Promise<boolean> {
  try {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(approvals)
      .where(and(eq(approvals.executionId, executionId), eq(approvals.status, 'approved')))
      .limit(1);
    return (Number(row?.n) || 0) > 0;
  } catch {
    return false;
  }
}

const TERMINAL = new Set<string>(['completed', 'failed', 'cancelled']);

/**
 * Score ONE terminal cloud run and persist it. Idempotent (unique execution_id): a
 * fresh run inserts the row AND folds the outcome into the routing blobs; a re-score
 * (e.g. the PR merged after the run finished) only UPDATES the mutable outcome fields
 * — it does NOT re-apply the routing increment (the scheduled reconcile repairs any
 * drift). No-ops on a non-terminal/missing execution. Never throws.
 */
export async function scoreRunOutcome(env: Env, db: Db, args: { executionId: number }): Promise<void> {
  try {
    const [exec] = await db
      .select({ status: executions.status, taskId: executions.taskId, tenantId: executions.tenantId, cloudAgentRef: executions.cloudAgentRef })
      .from(executions)
      .where(eq(executions.id, args.executionId))
      .limit(1);
    if (!exec || !TERMINAL.has(exec.status)) return;
    const terminalStatus = exec.status as TerminalStatus;

    const [task] = await db
      .select({ projectId: tasks.projectId, actionType: tasks.actionType })
      .from(tasks)
      .where(eq(tasks.id, exec.taskId))
      .limit(1);
    const projectId = task?.projectId ?? null;
    const actionType = normalizeActionType(task?.actionType);

    const [{ model, steps, costMc }, pr, degraded, approved, plan] = await Promise.all([
      resolveRunModel(db, args.executionId),
      resolveTaskPrSignal(db, exec.tenantId, exec.taskId),
      runWasDegraded(db, args.executionId),
      runWasApproved(db, args.executionId),
      resolveTenantPlan(env, exec.tenantId).then((p) => p.effectivePlan).catch(() => 'free' as const),
    ]);

    const { score } = computeOutcomeScore({
      terminalStatus,
      merged: pr.merged,
      ciGreen: pr.ciGreen,
      degraded,
      steps,
      costMc,
      approved,
    });

    const resolvedModel = model || 'unknown';
    const rowValues = {
      tenantId: exec.tenantId,
      projectId,
      taskId: exec.taskId,
      executionId: args.executionId,
      cloudAgentRef: exec.cloudAgentRef ?? null,
      actionType,
      resolvedModel,
      plan,
      score,
      merged: pr.merged,
      ciGreen: pr.ciGreen,
      degraded,
      steps,
      costUsdMillicents: costMc,
      terminalStatus,
    };

    // Insert-once: a newly inserted row folds into the routing blobs; an existing one
    // only refreshes its mutable outcome fields (so a late merge/CI is captured) WITHOUT
    // re-incrementing the blob (which is not idempotent — the reconcile self-heals).
    const inserted = await db
      .insert(runModelOutcomes)
      .values(rowValues)
      .onConflictDoNothing({ target: runModelOutcomes.executionId })
      .returning({ id: runModelOutcomes.id });

    if (inserted.length === 0) {
      await db
        .update(runModelOutcomes)
        .set({ score, merged: pr.merged, ciGreen: pr.ciGreen, degraded, steps, costUsdMillicents: costMc, resolvedModel, plan })
        .where(eq(runModelOutcomes.executionId, args.executionId))
        .catch(() => { /* best-effort */ });
      return;
    }

    // Fold into the routing table — but only for a run that actually ran a model.
    // A run that produced no LLM call ('unknown') carries no model attribution, so
    // learning from it would pollute the ranking.
    if (model) {
      await applyOutcomeToRoutingTable(env, db, {
        tenantId: exec.tenantId,
        projectId,
        actionType,
        model,
        score,
        costMc,
        merged: pr.merged,
      });
    }
  } catch {
    // Never let scoring fail a run.
  }
}
