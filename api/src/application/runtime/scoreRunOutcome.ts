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
import { bumpOutcomesVersion } from '../../infrastructure/cache/readThroughCache';
import { resolveTenantPlan } from '../../presentation/routes/llmRoutes';
import { lexicalEval } from '../eval/semanticEval';

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

/**
 * Coarse learn-contribution weight (0..1) from what's known at run FINALIZE — before
 * CI/routing outcome is scored. This is the FedAvg sample weight for the run's Evermind
 * contribution: a clean auto-merge teaches the model most, a no-op/failed run barely
 * teaches. It is DISTINCT from {@link computeOutcomeScore} (which scores a CI-known run
 * for model routing); it exists because the old learn path weighted by raw TEXT LENGTH,
 * so a long, failed run taught exactly as hard as a short, merged one. Floored at 0.2 so
 * the coordinator's `weight > 0` gate still accepts (and lightly learns from) a
 * low-quality run instead of silently snapping it back to the default weight of 1.
 */
export function finalizeLearnWeight(s: {
  merged: boolean;
  prOpened: boolean;
  autoMergeFailed: boolean;
  producedChanges: boolean;
}): number {
  if (s.merged) return 1;             // shipped clean — the strongest signal
  if (s.autoMergeFailed) return 0.3;  // opened a PR but the auto-merge broke
  if (s.prOpened) return 0.7;         // real change, awaiting approval/CI
  if (s.producedChanges) return 0.4;  // wrote files but no PR opened
  return 0.2;                         // text-only / no-op
}

export type OutcomeSource = 'cloud' | 'onprem' | 'ide' | 'external';

export interface ClientRunOutcome {
  /** Caller's idempotency key — one outcome per clientRunId (partial-unique). */
  clientRunId: string;
  /** Where the run executed. Anything non-'cloud' has no execution row. */
  source: OutcomeSource;
  /** The model the run actually used (the gateway's resolved model). */
  model: string;
  /** Terminal status of the run. Non-'completed' scores 0 (see computeOutcomeScore). */
  terminalStatus: TerminalStatus;
  actionType?: string;
  projectId?: number | null;
  taskId?: number | null;
  /** Optional richer signals when the client has them (else conservative defaults). */
  merged?: boolean;
  ciGreen?: boolean;
  degraded?: boolean;
  steps?: number;
  costMc?: number;
  approved?: boolean;
}

/**
 * Record ONE outcome for a NON-cloud run (IDE-native / on-prem / external SDK) —
 * the runs that never create a cloud `executions` row and so were invisible to
 * the learner. Same 0..1 {@link computeOutcomeScore} basis and the same
 * `applyOutcomeToRoutingTable` fold as {@link scoreRunOutcome}, so a client run
 * teaches the routing table exactly like a cloud run does. Idempotent on
 * `client_run_id`. Best-effort — never throws (a reporting failure must not break
 * the caller's run). Respects the learned-routing kill switch implicitly via
 * `applyOutcomeToRoutingTable` (which no-ops when routing is disabled).
 */
export async function recordClientRunOutcome(env: Env, db: Db, tenantId: number, o: ClientRunOutcome): Promise<void> {
  try {
    const clientRunId = o.clientRunId?.trim();
    if (!clientRunId || !o.model?.trim()) return;
    const actionType = normalizeActionType(o.actionType);
    const steps = Math.max(0, Math.floor(o.steps ?? 0));
    const costMc = Math.max(0, Math.floor(o.costMc ?? 0));
    const { score } = computeOutcomeScore({
      terminalStatus: o.terminalStatus,
      merged: !!o.merged,
      ciGreen: !!o.ciGreen,
      degraded: !!o.degraded,
      steps,
      costMc,
      approved: !!o.approved,
    });
    const plan = await resolveTenantPlan(env, tenantId).then((p) => p.effectivePlan).catch(() => 'free' as const);

    const inserted = await db
      .insert(runModelOutcomes)
      .values({
        tenantId,
        projectId: o.projectId ?? null,
        taskId: o.taskId ?? null,
        executionId: null,
        source: o.source,
        clientRunId,
        actionType,
        resolvedModel: o.model,
        plan,
        score,
        merged: !!o.merged,
        ciGreen: !!o.ciGreen,
        degraded: !!o.degraded,
        steps,
        costUsdMillicents: costMc,
        terminalStatus: o.terminalStatus,
      })
      .onConflictDoNothing({ target: runModelOutcomes.clientRunId })
      .returning({ id: runModelOutcomes.id });

    // Only a first-seen outcome folds into the routing blob (the fold is not
    // idempotent; a duplicate report must not double-count). No PR/CI signal on a
    // client run, but completion + efficiency still carry real reliability signal.
    if (inserted.length > 0) {
      await applyOutcomeToRoutingTable(env, db, {
        tenantId,
        projectId: o.projectId ?? null,
        actionType,
        model: o.model,
        score,
        costMc,
        merged: !!o.merged,
      });
      // A new labeled outcome means the tenant's SFT/DPO datasets + variant-eval
      // views are stale — orphan them (best-effort, same fold gate as routing).
      await bumpOutcomesVersion(env, tenantId);
    }
  } catch {
    // Never let outcome reporting fail the caller.
  }
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

/** The latest PR row for a task → (merged, ciGreen, closedUnmerged). merged also covers
 *  a merged-by status without an explicit mergedAt timestamp; closedUnmerged is a human
 *  closing the PR without merging (a literal rejection of the deliverable). */
async function resolveTaskPrSignal(db: Db, tenantId: number, taskId: number): Promise<{ merged: boolean; ciGreen: boolean; closedUnmerged: boolean }> {
  try {
    const [row] = await db
      .select({ status: pullRequests.status, mergedAt: pullRequests.mergedAt, buildStatus: pullRequests.buildStatus })
      .from(pullRequests)
      .where(and(eq(pullRequests.taskId, taskId), eq(pullRequests.tenantId, tenantId)))
      .orderBy(sql`${pullRequests.number} is not null desc`, desc(pullRequests.createdAt))
      .limit(1);
    if (!row) return { merged: false, ciGreen: false, closedUnmerged: false };
    const merged = row.status === 'merged' || row.mergedAt != null;
    return {
      merged,
      ciGreen: row.buildStatus === 'success',
      closedUnmerged: !merged && row.status === 'closed',
    };
  } catch {
    return { merged: false, ciGreen: false, closedUnmerged: false };
  }
}

/** Literal tool-use telemetry for a run: total tool calls (category='tool' audit rows
 *  whose result is a JSON tool payload) and how many returned an error (`ok:false`).
 *  ONE grouped query — no per-tool scan. */
async function resolveToolCounts(db: Db, executionId: number): Promise<{ toolCalls: number; toolErrors: number }> {
  try {
    const [row] = await db
      .select({
        // Real tool executions stringify a JSON result (`{...}`); auxiliary 'tool'
        // events (policy.blocked / finish.blocked) write plain-text results, excluded.
        calls: sql<number>`count(*) FILTER (WHERE ${toolAuditEvents.result} LIKE '{%')::int`,
        errors: sql<number>`count(*) FILTER (WHERE ${toolAuditEvents.result} LIKE '%"ok":false%')::int`,
      })
      .from(toolAuditEvents)
      .where(and(eq(toolAuditEvents.executionId, executionId), eq(toolAuditEvents.category, 'tool')))
      .limit(1);
    return { toolCalls: Number(row?.calls) || 0, toolErrors: Number(row?.errors) || 0 };
  } catch {
    return { toolCalls: 0, toolErrors: 0 };
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

/** Human review outcome for a run in ONE query: did a human APPROVE any bubbled-up
 *  action (pins completion to full), and did a human REJECT one (a literal rejection
 *  signal for trait reinforcement)? */
async function resolveApprovalOutcome(db: Db, executionId: number): Promise<{ approved: boolean; rejected: boolean }> {
  try {
    const [row] = await db
      .select({
        approved: sql<number>`count(*) FILTER (WHERE ${approvals.status} = 'approved')::int`,
        rejected: sql<number>`count(*) FILTER (WHERE ${approvals.status} = 'rejected')::int`,
      })
      .from(approvals)
      .where(eq(approvals.executionId, executionId))
      .limit(1);
    return { approved: (Number(row?.approved) || 0) > 0, rejected: (Number(row?.rejected) || 0) > 0 };
  } catch {
    return { approved: false, rejected: false };
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
      .select({ status: executions.status, taskId: executions.taskId, tenantId: executions.tenantId, cloudAgentRef: executions.cloudAgentRef, result: executions.result })
      .from(executions)
      .where(eq(executions.id, args.executionId))
      .limit(1);
    if (!exec || !TERMINAL.has(exec.status)) return;
    const terminalStatus = exec.status as TerminalStatus;

    const [task] = await db
      .select({ projectId: tasks.projectId, actionType: tasks.actionType, title: tasks.title, description: tasks.description })
      .from(tasks)
      .where(eq(tasks.id, exec.taskId))
      .limit(1);
    const projectId = task?.projectId ?? null;
    const actionType = normalizeActionType(task?.actionType);

    // ── Semantic eval (Layer 6) — inline, zero-cost lexical scoring of the run's
    // deliverable against the task it was asked to do. Drift monitoring reads these
    // over time; the /api/eval surface upgrades to an LLM-as-judge with full context.
    const evalScores = (() => {
      const question = [task?.title, task?.description].filter(Boolean).join('\n').trim();
      const answer = (exec.result ?? '').trim();
      if (!question || !answer) return null;
      return lexicalEval({ question, answer });
    })();

    const [{ model, steps, costMc }, pr, degraded, approval, toolCounts, plan] = await Promise.all([
      resolveRunModel(db, args.executionId),
      resolveTaskPrSignal(db, exec.tenantId, exec.taskId),
      runWasDegraded(db, args.executionId),
      resolveApprovalOutcome(db, args.executionId),
      resolveToolCounts(db, args.executionId),
      resolveTenantPlan(env, exec.tenantId).then((p) => p.effectivePlan).catch(() => 'free' as const),
    ]);
    const approved = approval.approved;
    // Literal human-rejection: a bubbled-up approval was rejected OR the PR was closed
    // without merging. Consumed by trait reinforcement (was the cancelled-run proxy).
    const humanRejected = approval.rejected || pr.closedUnmerged;

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
      // Literal reinforcement signals (migration 0333).
      toolCalls: toolCounts.toolCalls,
      toolErrors: toolCounts.toolErrors,
      humanRejected,
      faithfulness: evalScores?.faithfulness ?? null,
      answerRelevance: evalScores?.answerRelevance ?? null,
      hallucinationRate: evalScores?.hallucinationRate ?? null,
      evalMethod: evalScores?.method ?? null,
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
        .set({
          score, merged: pr.merged, ciGreen: pr.ciGreen, degraded, steps, costUsdMillicents: costMc, resolvedModel, plan,
          // Refresh the literal signals on re-score too (a late PR-close / approval lands here).
          toolCalls: toolCounts.toolCalls, toolErrors: toolCounts.toolErrors, humanRejected,
          // Re-evaluate on re-score too (the deliverable text may have settled).
          ...(evalScores
            ? {
                faithfulness: evalScores.faithfulness,
                answerRelevance: evalScores.answerRelevance,
                hallucinationRate: evalScores.hallucinationRate,
                evalMethod: evalScores.method,
              }
            : {}),
        })
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
      // Orphan the tenant's SFT/DPO datasets + variant-eval views (see client path).
      await bumpOutcomesVersion(env, exec.tenantId);
    }
  } catch {
    // Never let scoring fail a run.
  }
}
