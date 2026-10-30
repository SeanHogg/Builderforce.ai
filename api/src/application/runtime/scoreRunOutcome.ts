import { reportCaughtError } from '../observability/caughtErrorReporter';
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

import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { approvals, executions, llmUsageLog, pullRequests, tasks, toolAuditEvents, runModelOutcomes } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import {
  carriesRoutingSignal,
  foldsIntoRouting,
  normalizeActionType,
  type NormalizedRunOutcome,
  type OutcomeSource,
  type TerminalStatus,
} from '@builderforce/learned-routing';
import { computeOutcomeScore } from './outcomeScore';

// The wire contract owns these two vocabularies (the on-prem host sends them, this
// scorer records them), so they are DEFINED in `@builderforce/learned-routing` and
// only re-exported here for the api callers that already import them from this module.
export type { NormalizedRunOutcome, OutcomeSource, TerminalStatus };
import { classifyRunFailure } from './runFailureReasons';
import { applyOutcomeToRoutingTable } from '../llm/routingTable';
import { isModelRole, type ModelRole } from '@builderforce/agent-tools';

/** The role a CLOUD run's outcome scores. The primary loop is the run's coding work
 *  (`pickCloudModel` is called with role 'code'), so its merge/CI/completion outcome is
 *  evidence about the model as a coder. */
const CLOUD_RUN_ROLE: ModelRole = 'code';
import { bumpOutcomesVersion } from '../../infrastructure/cache/readThroughCache';
import { resolveTenantPlan } from '../tenant/tenantPlanSnapshot';
import { lexicalEval } from '../eval/semanticEval';
import { resolveUsageDatabase, usageDatabaseOf, usageRequestCount } from '../llm/usageLedger';
import { runTelemetryDatabase } from '../shared/runTelemetryDatabase';
import { EXECUTION_TERMINAL_SET } from '../../domain/shared/terminalStatus';
import { runOutcomeTelemetryColumns } from './runOutcomeTelemetryColumns';

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
export async function recordClientRunOutcome(env: Env, db: Db, tenantId: number, o: NormalizedRunOutcome): Promise<void> {
  try {
    const clientRunId = o.clientRunId?.trim();
    if (!clientRunId || !o.model?.trim()) return;
    const actionType = normalizeActionType(o.actionType);
    // Only a known role is evidence; anything else is recorded as unknown (NULL).
    const role = isModelRole(o.role) ? o.role : null;
    const steps = Math.max(0, Math.floor(o.steps ?? 0));
    // The cost the run REPORTED; absent is unknown, never a free run: stored as NULL, scored on steps
    // alone, and skipped by the routing fold — one rule for every writer and the reconcile.
    const reportedCostMc = o.costMc === undefined ? null : Math.max(0, Math.floor(o.costMc));
    const { score } = computeOutcomeScore({
      terminalStatus: o.terminalStatus,
      merged: !!o.merged,
      ciGreen: !!o.ciGreen,
      degraded: !!o.degraded,
      steps,
      costMc: reportedCostMc,
      approved: !!o.approved,
    });
    // The server's call, one fact per column: `routing_signal` is whether this is CODING-RUN evidence (a canvas
    // turn never is, whatever the body said). Whether it is also FOLDED is a separate gate below (a stopped
    // run, or a tenant-quota failure, is stored and counted but teaches routing nothing).
    const routingSignal = carriesRoutingSignal(o);
    const plan = await resolveTenantPlan(env, tenantId).then((p) => p.effectivePlan).catch(() => 'free' as const);

    const inserted = await runTelemetryDatabase(db)
      .insert(runModelOutcomes)
      .values({
        tenantId,
        projectId: o.projectId ?? null,
        taskId: o.taskId ?? null,
        executionId: null,
        source: o.source,
        clientRunId,
        actionType,
        role,
        resolvedModel: o.model,
        plan,
        score,
        merged: !!o.merged,
        ciGreen: !!o.ciGreen,
        degraded: !!o.degraded,
        steps,
        costUsdMillicents: reportedCostMc,
        terminalStatus: o.terminalStatus,
        rateLimited: !!o.rateLimited,
        // The PRD 35 §8.2 uniform outcome row the client's run built (entry point,
        // tool counts, tokens, the efficiency fields) — validated by the shared contract.
        ...runOutcomeTelemetryColumns(o),
        routingSignal,
        quotaExhausted: o.quotaExhausted === true,
      })
      .onConflictDoNothing({ target: runModelOutcomes.clientRunId, where: isNotNull(runModelOutcomes.clientRunId) })
      .returning({ id: runModelOutcomes.id });

    // Only a first-seen outcome folds into the routing blob (the fold is not
    // idempotent; a duplicate report must not double-count). No PR/CI signal on a
    // client run, but completion + efficiency still carry real reliability signal.
    // A report that is not a routing signal (a Creation Canvas turn is not evidence about
    // coding models) is recorded and goes no further: not into the blob, not into the datasets.
    if (inserted.length > 0 && routingSignal) {
      if (foldsIntoRouting(o)) {
        await applyOutcomeToRoutingTable(env, db, {
          tenantId,
          projectId: o.projectId ?? null,
          actionType,
          role,
          model: o.model,
          score,
          ...(reportedCostMc !== null ? { costMc: reportedCostMc } : {}),
          merged: !!o.merged,
          rateLimited: !!o.rateLimited,
        });
      }
      // A new labeled outcome means the tenant's SFT/DPO datasets + variant-eval
      // views are stale — orphan them (best-effort, same fold gate as routing).
      await bumpOutcomesVersion(env, tenantId);
    }
  } catch (error) {
    // Never let outcome reporting fail the caller.
  
    reportCaughtError(error, { source: "application/runtime/scoreRunOutcome.ts", operation: "recordClientRunOutcome" });
  }
}

/** Most-frequent llm_usage_log.model for an execution — the model the run actually
 *  locked onto (the truth of what ran). Empty when the run produced no LLM calls. */
async function resolveRunModel(db: Db, executionId: number): Promise<{ model: string; steps: number; costMc: number }> {
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

const TERMINAL = EXECUTION_TERMINAL_SET;

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
      .select({ status: executions.status, taskId: executions.taskId, tenantId: executions.tenantId, cloudAgentRef: executions.cloudAgentRef, result: executions.result, errorMessage: executions.errorMessage })
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

    const usageDb = resolveUsageDatabase(env, db);
    const telemetryDb = runTelemetryDatabase(db);
    const [{ model, steps, costMc }, pr, degraded, approval, toolCounts, plan] = await Promise.all([
      resolveRunModel(usageDb, args.executionId),
      resolveTaskPrSignal(db, exec.tenantId, exec.taskId),
      runWasDegraded(telemetryDb, args.executionId),
      resolveApprovalOutcome(db, args.executionId),
      resolveToolCounts(telemetryDb, args.executionId),
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

    // AVAILABILITY, not quality (migration 0485). A run the provider refused with a 429
    // still scores 0 — it did not complete — but the router must not read that 0 as
    // "this model writes bad code". The classification is the platform's existing
    // failure taxonomy, so this records `classifyRunFailure`'s verdict rather than
    // inventing a second regex for the same question.
    const rateLimited = terminalStatus === 'failed'
      && classifyRunFailure(exec.errorMessage) === 'rate_limited';

    const resolvedModel = model || 'unknown';
    const rowValues = {
      tenantId: exec.tenantId,
      projectId,
      taskId: exec.taskId,
      executionId: args.executionId,
      cloudAgentRef: exec.cloudAgentRef ?? null,
      actionType,
      role: CLOUD_RUN_ROLE,
      resolvedModel,
      plan,
      score,
      merged: pr.merged,
      ciGreen: pr.ciGreen,
      degraded,
      steps,
      costUsdMillicents: costMc,
      terminalStatus,
      rateLimited,
      // The PRD 35 §8.2 telemetry label: a server-scored run is a cloud run.
      entryPoint: 'cloud',
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
    const inserted = await telemetryDb
      .insert(runModelOutcomes)
      .values(rowValues)
      .onConflictDoNothing({ target: runModelOutcomes.executionId })
      .returning({ id: runModelOutcomes.id });

    if (inserted.length === 0) {
      await telemetryDb
        .update(runModelOutcomes)
        .set({
          score, merged: pr.merged, ciGreen: pr.ciGreen, degraded, steps, costUsdMillicents: costMc, resolvedModel, plan, rateLimited,
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
        .catch((error) => reportCaughtError(error, { source: "application/runtime/scoreRunOutcome.ts", operation: "scoreRunOutcome", context: { logMessage: '[run-outcome] evaluation score persistence failed', details: {
          tenantId: exec.tenantId,
          executionId: args.executionId,
          error,
        } } }));
      return;
    }

    // Fold into the routing table — but only for a run that actually ran a model.
    // A run that produced no LLM call ('unknown') carries no model attribution, so
    // learning from it would pollute the ranking.
    if (model) {
      // A run the person stopped, or one the tenant's quota ended, is stored but teaches routing nothing.
      if (foldsIntoRouting({ terminalStatus, quotaExhausted: classifyRunFailure(exec.errorMessage) === 'quota_exhausted' })) {
        await applyOutcomeToRoutingTable(env, db, {
          tenantId: exec.tenantId,
          projectId,
          actionType,
          role: CLOUD_RUN_ROLE,
          model,
          score,
          costMc,
          merged: pr.merged,
          rateLimited,
        });
      }
      // Orphan the tenant's SFT/DPO datasets + variant-eval views (see client path).
      await bumpOutcomesVersion(env, exec.tenantId);
    }
  } catch (error) {
    // Never let scoring fail a run.
  
    reportCaughtError(error, { source: "application/runtime/scoreRunOutcome.ts", operation: "scoreRunOutcome" });
  }
}
