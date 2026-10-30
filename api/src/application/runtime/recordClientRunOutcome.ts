/**
 * The client door of the outcome scorer (PRD 13 §6.4): ONE outcome for a run that never created a cloud
 * `executions` row (IDE-native, on-prem, the Creation Canvas, an external SDK). Split out of
 * `scoreRunOutcome.ts`, which scores the cloud runs; both write `run_model_outcomes` and gate the routing
 * fold with the shared `foldsIntoRouting`.
 */

import { isNotNull } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { runModelOutcomes } from '../../infrastructure/database/schema';
import {
  carriesRoutingSignal,
  foldsIntoRouting,
  normalizeActionType,
  type NormalizedRunOutcome,
} from '@builderforce/learned-routing';
import { isModelRole } from '@builderforce/agent-tools';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { applyOutcomeToRoutingTable } from '../llm/routingTable';
import { bumpOutcomesVersion } from '../../infrastructure/cache/readThroughCache';
import { resolveTenantPlan } from '../tenant/tenantPlanSnapshot';
import { runTelemetryDatabase } from '../shared/runTelemetryDatabase';
import { computeOutcomeScore } from './outcomeScore';
import { runOutcomeTelemetryColumns } from './runOutcomeTelemetryColumns';

/**
 * Record ONE outcome for a NON-cloud run (IDE-native / on-prem / external SDK) —
 * the runs that never create a cloud `executions` row and so were invisible to
 * the learner. Same 0..1 {@link computeOutcomeScore} basis and the same
 * `applyOutcomeToRoutingTable` fold as `scoreRunOutcome`, so a client run
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
    // A tenant-quota failure is a FAILED run by definition: the flag means nothing on a run that finished or was
    // stopped, so it is read once here and the row and the fold gate below agree on it.
    const quotaExhausted = o.terminalStatus === 'failed' && o.quotaExhausted === true;
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
        quotaExhausted,
      })
      .onConflictDoNothing({ target: runModelOutcomes.clientRunId, where: isNotNull(runModelOutcomes.clientRunId) })
      .returning({ id: runModelOutcomes.id });

    // Only a first-seen outcome folds into the routing blob (the fold is not
    // idempotent; a duplicate report must not double-count). No PR/CI signal on a
    // client run, but completion + efficiency still carry real reliability signal.
    // A report that is not a routing signal (a Creation Canvas turn is not evidence about
    // coding models) is recorded and goes no further: not into the blob, not into the datasets.
    if (inserted.length > 0 && routingSignal) {
      if (foldsIntoRouting({ ...o, quotaExhausted })) {
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
      // A new labeled outcome means the tenant's SFT/DPO datasets + variant-eval views are stale - orphan
      // them (best-effort). Deliberately OUTSIDE the `foldsIntoRouting` gate above: a stopped or quota-ended
      // run is still a stored, labeled row the datasets count, even though it teaches the routing table nothing.
      await bumpOutcomesVersion(env, tenantId);
    }
  } catch (error) {
    // Never let outcome reporting fail the caller.
    reportCaughtError(error, { source: "application/runtime/recordClientRunOutcome.ts", operation: "recordClientRunOutcome" });
  }
}
