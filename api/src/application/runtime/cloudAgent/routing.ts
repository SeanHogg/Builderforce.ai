/**
 * WHICH MODEL a cloud run executes on, and what it is allowed to cost.
 *
 * Split out of `cloudAgentEngine.ts` alongside `agent.ts` (identity) — see that
 * file for why the 4,117-line original was broken up.
 *
 * Three decisions live here, and they belong together because each constrains the
 * next:
 *
 *  1. ENTITLEMENT — {@link refuseCloudRunWithoutByo} answers whether this tenant
 *     may start a funded cloud run at all, before a model is picked.
 *  2. SELECTION — {@link resolveCloudRouting} picks the model, folding in the
 *     agent's own pin, the plan's coder pool and the learned routing table.
 *  3. HONESTY ABOUT THE RESULT — {@link isCodingModelDegraded} and
 *     {@link emitModelSelection} record what actually ran, so a run demoted off a
 *     frontier coder says so on its own timeline instead of quietly under-performing.
 *
 * {@link resolveLearnedRoutingInputs} is the read behind (2): the per-action model
 * ranking a tenant's own graded outcomes have produced.
 */
import { and, eq } from 'drizzle-orm';
import { TenantPlan } from '../../../domain/shared/types';
import { evaluatePremiumModelAccess } from '../../../domain/tenant/planFeatures';
import { resolveIsSuperadmin } from '../../../infrastructure/auth/superadminFlag';
import { executions, tasks } from '../../../infrastructure/database/schema';
import {
  RECOGNIZED_CODER_MODELS, codingModelsForPlan, pickCloudModel,
  type EffectivePlan,
} from '../../llm/LlmProxyService';
import { deriveAllocationCategory } from '../../llm/allocationCategories';
import { classifyTaskAction } from '../../llm/classifyTask';
import { assertCloudRunByo, type CloudByoFailure } from '../../llm/cloudByoPolicy';
import { MIN_SAMPLES, getRoutingTable, type RoutingScope } from '../../llm/routingTable';
import type { TenantVendorKeys } from '../../llm/tenantProviderKeyService';
import { isPremiumCapExhausted, recordUsageRow } from '../../llm/usageLedger';
import { reportCaughtError } from '../../observability/caughtErrorReporter';
import { resolveTenantPlan } from '../../tenant/tenantPlanSnapshot';
import { recordCloudToolEvent } from '../cloudToolEvents';
import { submittingUserId } from '../dispatcherLabel';
import {
  learnedRoutingEnabled, normalizeActionType, scopeHasSignal,
  type ActionModelRankStat, type ActionType,
} from '@builderforce/learned-routing';
import type { Env } from '../../../env';
import type { Db } from '../../../infrastructure/database/connection';

const CODING_MODEL_POOL_SET: ReadonlySet<string> = RECOGNIZED_CODER_MODELS;

/** The ONE agent commit-message convention (`<Verb> <path> — task #<id> (<agent>)`),
 *  so every write/edit/delete commit reads identically instead of re-inlining the
 *  template at each call site. `suffix` appends an optional reason (e.g. a delete note). */

export function isCodingModelDegraded(resolvedModel: string | undefined): boolean {
  if (!resolvedModel || resolvedModel === 'default') return false;
  return !CODING_MODEL_POOL_SET.has(resolvedModel);
}

/**
 * Emit a structured `coding_model_degraded` telemetry event when a cloud coding
 * turn was served by a non-coder model (see {@link isCodingModelDegraded}). Rides
 * the SAME timeline channel as the run's llm.complete events ({@link recordCloudToolEvent})
 * so it surfaces on the Observability timeline — no separate channel. No-op when the
 * model is a curated coder. Best-effort — never breaks the run.
 */
export async function emitCodingModelDegraded(
  db: Db,
  args: { tenantId: number; cloudAgentRef?: string; executionId: number; resolvedModel: string | undefined; requestedModel: string | undefined },
): Promise<void> {
  if (!isCodingModelDegraded(args.resolvedModel)) return;
  await recordCloudToolEvent(db, {
    tenantId: args.tenantId,
    cloudAgentRef: args.cloudAgentRef,
    executionId: args.executionId,
    toolName: 'coding_model_degraded',
    category: 'llm',
    detail: { resolvedModel: args.resolvedModel, requestedModel: args.requestedModel ?? null, executionId: args.executionId },
    // Spell out the cause AND the consequence: the curated coders this run seeded
    // with were all unreachable (vendor key unbound / cooled down / outage), so the
    // cascade floored onto a generalist backstop. That is the usual root cause of a
    // run that loops on search and finishes with no edits — say so here so triage
    // does not have to infer it.
    result: `Coding turn fell through to non-coder backstop '${args.resolvedModel}'${args.requestedModel ? ` (intended coder: '${args.requestedModel}')` : ''} — the plan's curated coders were unreachable (vendor key unbound / cooled down / outage). Expect weak agentic results: a backstop generalist often loops on search and finishes without producing edits.`,
  });
}

/**
 * Run-start model-selection trace. Records WHY this run is on the model it is —
 * the single most common triage question for a cloud run that produced no output
 * (see execution #59: dispatched `gateway-default`, silently floored onto the
 * gemini backstop, spun 7 steps, shipped nothing). The dispatch event only logs
 * the raw `gateway-default` label; this event makes the resolution legible:
 *   • what was requested (agent base_model / user pick, or nothing),
 *   • whether it's a hard strict pin or a soft plan-default seed,
 *   • the seed model + whether it is a curated coder at all,
 *   • the coders THIS plan could actually reach (best-first).
 * Pairs with {@link emitCodingModelDegraded}, which reports the OUTCOME once the
 * gateway resolves. First tick only — best-effort, never breaks the run.
 */
export async function emitModelSelection(
  db: Db,
  args: {
    tenantId: number; cloudAgentRef?: string; executionId: number;
    requested: string | undefined;
    pick: { model: string; strict: boolean; ranked?: string[]; seedSamples?: number; biasApplied?: boolean };
    plan: EffectivePlan; premium: boolean;
    /** Learned Model Routing: the action type the run was classified as (PRD 13). */
    actionType?: ActionType;
  },
): Promise<void> {
  const seedIsCoder = CODING_MODEL_POOL_SET.has(args.pick.model);
  const planCoders = codingModelsForPlan(args.plan, args.premium);
  // Did the learned reorder actually move the seed off the curated default?
  const curatedDefault = planCoders[0];
  const learnedSeed = !args.pick.strict && (args.pick.seedSamples ?? 0) >= MIN_SAMPLES && args.pick.model !== curatedDefault;
  const learnedNote = args.actionType
    ? ` Action=${args.actionType}; ${
        learnedSeed
          ? `learned routing ranked '${args.pick.model}' #1 from ${args.pick.seedSamples} prior ${args.actionType} observation(s) — scored runs and human ratings${args.pick.biasApplied ? ', client SSM bias applied' : ''}.`
          : `learned routing had too few samples (cold-start) — kept the curated default.`
      }`
    : '';
  const reason = (args.pick.strict
    ? `Pinned to '${args.pick.model}' (strict — the gateway dispatches only this model, no silent swap).`
    : `No usable model on this agent${args.requested ? ` ('${args.requested}' is not a known catalog id)` : ' (dispatched as gateway-default)'} → seeding the ${args.plan} plan's best coding model '${args.pick.model}'${seedIsCoder ? '' : ' (NOT a curated coder)'}. Soft seed: the run locks onto whatever the gateway resolves on turn 1, so a cold/keyless seed can fail over once — possibly onto a non-coder backstop (watch for coding_model_degraded).`) + learnedNote;
  await recordCloudToolEvent(db, {
    tenantId: args.tenantId,
    cloudAgentRef: args.cloudAgentRef,
    executionId: args.executionId,
    toolName: 'model.select',
    category: 'planning',
    detail: {
      requested: args.requested ?? null,
      pin: args.pick.strict ? 'strict' : 'soft',
      seed: args.pick.model,
      seedIsCoder,
      plan: args.plan,
      premium: args.premium,
      planCoders,
      actionType: args.actionType ?? null,
      rankedFrom: args.pick.ranked ?? null,
      seedSamples: args.pick.seedSamples ?? 0,
      learnedSeed,
      biasApplied: args.pick.biasApplied ?? false,
    },
    result: reason,
  });
}

/** What the learned router needs at run start: the task's action-type label and the
 *  ranked per-model stats for the finest scope that has enough samples. */
export interface LearnedRoutingInputs {
  actionType: ActionType;
  /** byAction[actionType] of the finest scope with a model clearing MIN_SAMPLES, or
   *  undefined when every scope is cold (→ router keeps the curated static order). */
  actionStats?: ReadonlyArray<ActionModelRankStat>;
}

/** True when a scope's per-action stat list has at least one model at/above the
 *  evidence floor — i.e. it can actually change the seed. Counts scored runs AND
 *  human thumbs, the same measure `rankModelsForAction` gates on, so a scope full
 *  of chat ratings is no longer reported as cold. */


/**
 * Resolve the learned-routing inputs for a run (PRD 13 §6.2/§6.3), best-effort:
 *   1. Ensure `tasks.action_type` — classify ONCE (free pool) and cache on the task
 *      if null; every re-run reuses the column. Falls back to 'other' on any error.
 *   2. Read the finest-scope routing blob (project → tenant → global) and return the
 *      first that has real signal (a model with `n >= MIN_SAMPLES`) for this action.
 * Returns `{ actionType: 'other' }` (no stats) when the kill switch is off or anything
 * throws — so the router simply keeps today's static order. Never blocks a run.
 */
export async function resolveLearnedRoutingInputs(
  env: Env,
  db: Db,
  args: { tenantId: number; projectId: number; taskRow: { id: number; title: string; description: string | null } },
): Promise<LearnedRoutingInputs> {
  if (!learnedRoutingEnabled(env)) return { actionType: 'other' };
  try {
    // 1. Classify-once + cache on the task column.
    let actionType: ActionType = 'other';
    const [row] = await db
      .select({ actionType: tasks.actionType })
      .from(tasks).where(eq(tasks.id, args.taskRow.id)).limit(1);
    if (row?.actionType) {
      actionType = normalizeActionType(row.actionType);
    } else {
      const verdict = await classifyTaskAction(env, { title: args.taskRow.title, description: args.taskRow.description });
      actionType = verdict.actionType;
      // Co-derive the investment-allocation category for free off the same signals
      // (no extra LLM call) — the column is the cache/override (EMP-1).
      const allocationCategory = deriveAllocationCategory({
        actionType: verdict.actionType,
        title: args.taskRow.title,
        description: args.taskRow.description,
      });
      await db.update(tasks)
        .set({ actionType: verdict.actionType, actionTypeConfidence: verdict.confidence, allocationCategory, allocationCategorySource: 'derived' })
        .where(eq(tasks.id, args.taskRow.id))
        .catch((error) => reportCaughtError(error, { source: "application/runtime/cloudAgentEngine.ts", operation: "resolveLearnedRoutingInputs", context: { logMessage: '[cloud-routing] task classification cache update failed', details: { tenantId: args.tenantId, taskId: args.taskRow.id, error } } }));
    }

    // 2. Finest scope with signal → its ranked stats for this action.
    const scopes: RoutingScope[] = [
      { kind: 'project', id: args.projectId },
      { kind: 'tenant', id: args.tenantId },
      { kind: 'global' },
    ];
    for (const scope of scopes) {
      const table = await getRoutingTable(env, db, scope);
      const stats = table.byAction[actionType];
      if (scopeHasSignal(stats, MIN_SAMPLES)) return { actionType, actionStats: stats };
    }
    return { actionType };
  } catch (error) {
    reportCaughtError(error, { source: "application/runtime/cloudAgentEngine.ts", operation: "resolveLearnedRoutingInputs", context: { logMessage: '[cloud-routing] learned routing resolution failed; using default action', details: {
      tenantId: args.tenantId,
      taskId: args.taskRow.id,
      error,
    } } });
    return { actionType: 'other' };
  }
}

/**
 * Record cloud-agent token usage for the run. Writes to BOTH ledgers so the two
 * views reconcile (previously cloud usage only hit usage_snapshots and was
 * invisible to the billing/cost log):
 *   • usage_snapshots — the per-execution trace view (context/compaction columns).
 *   • llm_usage_log   — the canonical usage/billing ledger, tagged with the cloud
 *     dimensions (cloud_agent_ref + execution_id) so cost can be split by
 *     cloud-vs-on-prem (migration 0096). Shared insert with the gateway path via
 *     recordUsageRow.
 * Best-effort — never throws.
 */

export async function refuseCloudRunWithoutByo(
  db: Db,
  run: { tenantId: number; cloudAgentRef?: string; executionId: number },
  creds: Parameters<typeof assertCloudRunByo>[0],
): Promise<CloudByoFailure | null> {
  const failure = assertCloudRunByo(creds);
  if (!failure) return null;
  await recordCloudToolEvent(db, {
    tenantId: run.tenantId,
    cloudAgentRef: run.cloudAgentRef,
    executionId: run.executionId,
    toolName: 'byo.blocked',
    category: 'llm',
    detail: { code: failure.code, provider: failure.provider, reason: failure.reason ?? null },
    result: failure.message.slice(0, 300),
  });
  return failure;
}

/** True when a tenant brought at least one BYO api-key — so we only thread the
 *  overlay (and mark vendors tenant-funded) when there's actually a key. */
export function hasVendorKeys(keys: TenantVendorKeys): boolean {
  return Object.values(keys).some((v) => !!v);
}

/** Map the gateway's string effectivePlan onto the plan enum the pure entitlement
 *  evaluators take. */
function toTenantPlanEnum(ep: EffectivePlan): TenantPlan {
  if (ep === 'pro') return TenantPlan.PRO;
  if (ep === 'teams') return TenantPlan.TEAMS;
  return TenantPlan.FREE;
}

/** A cloud run's LLM routing — which model pool / vendor key its tenant's plan
 *  unlocks. Resolved once per run and reused, never recomputed per turn. */
export type CloudRouting = {
  effectivePlan: EffectivePlan;
  premiumOverride: boolean;
  /** May this run honour a PREMIUM (any-paid-OpenRouter) pin — a paid plan WITH a
   *  validated card? A cloud run never passes the gateway route's premium gate, so
   *  `pickCloudModel` enforces it from this. */
  premiumEntitled: boolean;
  /** Is the user who SUBMITTED this run a platform superadmin? Threaded into
   *  `pickCloudModel` so a superadmin's run pins the frontier model it asked for
   *  rather than silently auto-routing to the free coding pool (a cloud run shows no
   *  paywall, so the downgrade was invisible). Resolved from `executions.submitted_by`
   *  — `user:<id>` for an interactive dispatch, `system:*` for a sweep, which is the
   *  only non-arbitrary answer to "whose superadmin" and keeps autonomous runs
   *  funding-neutral. False whenever no user submitted the run. */
  isSuperadmin: boolean;
};

/** Resolve a tenant's cloud LLM routing, degrading to the free plan if the plan
 *  lookup throws — a background cloud run must never hard-fail on plan I/O.
 *
 *  `submittedBy` is the run's `executions.submitted_by`; omit it for a path with no
 *  execution row and the run resolves as non-superadmin, which is the safe default. */
export async function resolveCloudRouting(
  env: Env,
  tenantId: number,
  submittedBy?: string | null,
): Promise<CloudRouting> {
  try {
    // `resolveIsSuperadmin` no-ops (and issues no query) for a null/machine subject,
    // so a `system:*` dispatch costs nothing here.
    const [r, isSuperadmin] = await Promise.all([
      resolveTenantPlan(env, tenantId),
      resolveIsSuperadmin(env, submittingUserId(submittedBy)),
    ]);
    // Premium entitlement is a tenant-FUNDING question, so a comped tenant still gets
    // it via the premium override. A superadmin is folded in as well now that the run
    // can name one: the flag reaches `pickCloudModel`, which is the only place a cloud
    // run's pin is gated, and a superadmin is by definition not who the paywall is for.
    const premium = evaluatePremiumModelAccess({
      effectivePlan: toTenantPlanEnum(r.effectivePlan),
      premiumOverride: r.premiumOverride,
      isSuperadmin,
      cardValidated: r.cardValidated,
    });
    // ENTITLEMENT AND BUDGET ARE TWO QUESTIONS. A cloud run is exactly where an
    // unbounded premium pin does the most damage — an autonomous loop can burn a
    // frontier model for hours with nobody watching — and it never passes the gateway
    // route's gate, so the daily cap is enforced here or nowhere. Exhausted → the pin
    // is simply not honoured and the run falls back to the plan's coding default,
    // matching how an un-entitled pin already degrades: a background run should lose
    // its preferred model, not die.
    const premiumEntitled = premium.entitled
      && !(await isPremiumCapExhausted(env, tenantId, r.premiumDailyCap, { isSuperadmin }));
    return { effectivePlan: r.effectivePlan, premiumOverride: r.premiumOverride, premiumEntitled, isSuperadmin };
  } catch (error) {
    reportCaughtError(error, { source: "application/runtime/cloudAgentEngine.ts", operation: "resolveCloudRouting", context: { logMessage: '[cloud-routing] tenant plan resolution failed; using free routing', details: { tenantId, error } } });
    return { effectivePlan: 'free', premiumOverride: false, premiumEntitled: false, isSuperadmin: false };
  }
}

/** Resolved per-run context for a container-op call, derived authoritatively from
 *  the execution id (the container never asserts its own tenant/task). */
