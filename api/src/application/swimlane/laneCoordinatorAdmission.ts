/**
 * ADMISSION for a coordinator-driven stage entry.
 *
 * The one-agent engine (`maybeAutoRunOnLaneEntry`) runs every dispatch through the evaluator's gates: the workspace switch, the
 * live-run check, the failure breaker / lifetime cap / re-run cooldown and the workspace token budget. A staged lane is handed to
 * the SwimlaneCoordinator instead, which has none of them: a `needs_attention` ticket would be relaunched on every sweep tick and an
 * `awaiting_gate` one would be dragged out of its gate. This module applies the SAME gates, by calling the SAME functions
 * (`assessRerunBackoff`, `findLiveExecution`, `agentExecutionEnabledCached`, `resolveTenantTokenGate`) rather than restating them,
 * so the two engines cannot disagree about whether a ticket may start.
 *
 * Plus the one fact only the coordinator has: the ticket's own run lifecycle. A system caller (anything but an explicit `force`)
 * may only start a stage for a ticket whose run is ABSENT or QUEUED, or recovering from `needs_attention` once the breaker and
 * cooldown pass. It may never pull a ticket out of `awaiting_gate` / `awaiting_workflow`, or re-enter one that is already running.
 */
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import type { RuntimeService } from '../runtime/RuntimeService';
import { agentExecutionEnabledCached } from '../runtime/agentExecutionGate';
import { findLiveExecution } from '../runtime/liveExecutionStatus';
import { recordAutoRunSkip } from '../runtime/autoRunSkipLedger';
import { assessRerunBackoff, resolveTenantTokenGate, type AutoRunReason, type TenantTokenVerdict } from './evaluateAutoRun';
import { DrizzleCoordinatorStore } from './DrizzleCoordinatorStore';

export type StageAdmission =
  | { admitted: true }
  | { admitted: false; reason: AutoRunReason; cooldownRemainingMs?: number };

export interface StageAdmissionInput {
  tenantId: number;
  boardId: string;
  taskId: number;
  /** A HUMAN asked for this entry: the lifecycle restriction, breaker and cooldown are overridden, exactly as "Run now". */
  force?: boolean;
  /** The caller's pre-resolved workspace token verdict (the sweep resolves one per tenant). */
  tenantTokens?: TenantTokenVerdict;
}

/** Lifecycles a system caller may START a stage from. `needs_attention` is a retry, so it still faces the backoff below. */
const SYSTEM_ENTRY_LIFECYCLES: ReadonlySet<string> = new Set(['queued', 'needs_attention']);

/** Stage-history statuses that are bookkeeping around a failure, not an outcome: skipped when counting the trailing failures. */
const STAGE_NEUTRAL = new Set(['queued', 'stage_running', 'retry']);
/** Stage-history statuses that mean the stage produced nothing. */
const STAGE_FAILED = new Set(['failed', 'blocked_requirements']);

/**
 * The ticket run's recent stage FAILURES, newest first, shaped as the failed runs `assessRerunBackoff` counts.
 *
 * A stage the coordinator launches does not necessarily leave an `executions` row (it can fail before dispatch, be refused by a
 * hard requirement gate, or report back from a host), so the breaker that reads executions alone would never see it and a
 * `needs_attention` ticket would be relaunched on every tick. The coordinator already persists each outcome in the run's
 * `stage_history`; this reads the unbroken failure streak from there (no new table). Pure.
 */
export function stageFailureOutcomes(stageHistory: string | null | undefined): Array<{ status: 'failed'; errorMessage: null; completedAt: Date }> {
  let entries: Array<{ status?: unknown; at?: unknown }>;
  try {
    const parsed: unknown = JSON.parse(stageHistory || '[]');
    entries = Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
  const out: Array<{ status: 'failed'; errorMessage: null; completedAt: Date }> = [];
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const status = String(entries[i]?.status ?? '');
    if (STAGE_NEUTRAL.has(status)) continue;
    if (!STAGE_FAILED.has(status)) break;
    const at = new Date(String(entries[i]?.at ?? ''));
    out.push({ status: 'failed', errorMessage: null, completedAt: at });
  }
  return out;
}

export async function admitStageEntry(
  env: Env,
  db: Db,
  runtimeService: RuntimeService,
  input: StageAdmissionInput,
): Promise<StageAdmission> {
  // The workspace switch is an emergency control: not even an explicit force passes it.
  if (!(await agentExecutionEnabledCached(env, db, input.tenantId))) return { admitted: false, reason: 'execution_disabled' };

  let stageFailures: ReturnType<typeof stageFailureOutcomes> = [];
  if (!input.force) {
    const run = await new DrizzleCoordinatorStore(db).findActiveTicketRunByTask(input.boardId, input.taskId, input.tenantId);
    if (run && !SYSTEM_ENTRY_LIFECYCLES.has(run.lifecycle)) {
      // A gate-parked stage waits on a person; any other live lifecycle is a stage already in flight.
      return { admitted: false, reason: run.lifecycle === 'awaiting_gate' ? 'human_gate' : 'already_running' };
    }
    if (run) stageFailures = stageFailureOutcomes(run.stageHistory);
  }

  const execs = (await runtimeService.listByTask(input.taskId, { slim: true })).map((e) => e.toPlain());
  if (findLiveExecution(execs)) return { admitted: false, reason: 'already_running' };

  if (!input.force) {
    const now = Date.now();
    // Two views of the same ticket - its executions and the coordinator's own stage failures - judged by the same rule. A
    // failure can appear in both, so the STRONGER verdict wins rather than the two streaks being added.
    const verdicts = [assessRerunBackoff(execs, now), assessRerunBackoff(stageFailures, now)];
    const blockedBy = verdicts.find((v) => v.blockedBy === 'run_cap_exhausted')?.blockedBy
      ?? verdicts.find((v) => v.blockedBy)?.blockedBy ?? null;
    if (blockedBy) {
      const cooldownRemainingMs = Math.max(...verdicts.map((v) => v.cooldownRemainingMs));
      return { admitted: false, reason: blockedBy, ...(blockedBy === 'cooldown_active' ? { cooldownRemainingMs } : {}) };
    }
  }

  // Last, as in the evaluator: only a ticket that would otherwise start pays for the token lookup.
  const tokens = await resolveTenantTokenGate(db, input.tenantId, input.tenantTokens, env);
  if (tokens && !tokens.hasTokens) return { admitted: false, reason: 'tenant_token_limit' };

  return { admitted: true };
}

/**
 * Surface a refusal the way the engine does: tell the caller (the sweep's block memo) and write the `auto_run_skipped` ledger row
 * the stall census reads, so a ticket the coordinator declined is not silent.
 */
export async function recordStageRefusal(
  env: Env,
  db: Db,
  args: {
    tenantId: number;
    taskId: number;
    lane: string;
    submittedBy: string;
    onBlocked?: (verdict: { reason: string; cooldownRemainingMs?: number }) => void;
  },
  verdict: Extract<StageAdmission, { admitted: false }>,
): Promise<void> {
  await recordAutoRunSkip(env, db, {
    tenantId: args.tenantId,
    taskId: args.taskId,
    cloudAgentRef: args.submittedBy,
    lane: args.lane,
    reason: verdict.reason,
    detail: { taskId: args.taskId, lane: args.lane, reason: verdict.reason, engine: 'coordinator' },
    result: `Auto-run skipped (${verdict.reason}) for task ${args.taskId} on lane '${args.lane}': the lane's staged run was not started.`,
  }).catch(() => false);
  args.onBlocked?.({ reason: verdict.reason, ...(verdict.cooldownRemainingMs != null ? { cooldownRemainingMs: verdict.cooldownRemainingMs } : {}) });
}
