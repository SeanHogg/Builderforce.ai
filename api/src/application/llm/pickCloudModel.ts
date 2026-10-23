/**
 * Cloud-agent model selection — `pickCloudModel`, shared by every cloud executor
 * (durable loop + container op). Split out of `LlmProxyService.ts`, which re-exports
 * it and its option/result types.
 */

import type { ActionType } from '@builderforce/learned-routing';
import {
  qualityEvidence,
  rankModelsForAction,
  type ActionModelRankStat,
  type RoutingExploration,
} from '@builderforce/learned-routing';
import type { ModelRole } from '@builderforce/agent-tools';
import type { ArcStage } from '@builderforce/workload';
import { profileWorkload } from '@builderforce/workload';
import { orderPoolForWorkload } from '@builderforce/model-router';
import type { EffectivePlan } from '../../domain/tenant/effectivePlan';
import { vendorForModel } from './vendors';
import {
  CODING_DEFAULT_MODEL,
  byoAutoSeedModels,
  canonicalModelId,
  explicitModelPreemptsByo,
  isDispatchableSeed,
} from './modelPool';
import { isEvermindModelId } from './evermindCodingGate';
import { rankConnectedForRole } from './modelRoles';
import { registryCatalogView, type PriceBook } from './catalogView';
import { codingModelsForPlan, isPremiumModelSelection } from './proxyPlanRouting';
import { modelsFittingContext } from './requestFit';

export interface PickCloudModelOptions {
  actionType?: ActionType;
  /** The `byAction[actionType]` slice of the resolved scope's routing blob. */
  actionStats?: ReadonlyArray<ActionModelRankStat>;
  /** Client SSM recall nudge (interactive runs only; absent/ignored headless). */
  bias?: Record<string, number>;
  minSamples?: number;
  /** Estimated tokens the first turn will send (prompt + tools). When set, models
   *  whose catalog `contextWindow` can't hold it are dropped from the FIRST-PASS seed
   *  (they remain in the cascade as failover) so a small-window model isn't SEEDED
   *  into a context it would 413 on — the 97K-into-32K bug. Composes with the SSM
   *  learned ranking: fit FIRST, then rank the fitting set. */
  estimatedTokens?: number;
  /** Gateway vendor ids the tenant can serve from their OWN connected providers
   *  (BYO). A free tenant may pin a model owned by one of these — they pay their
   *  own provider — so the free-plan "can't choose a model" gate is lifted for it. */
  byoVendors?: ReadonlySet<string>;
  /** The tenant's BYO PRECEDENCE as ordered gateway vendor ids (most-preferred first).
   *  When set, the connected-flagship soft seed leads with the owner's chosen account
   *  (e.g. Meta first) instead of catalog-tier order. See {@link byoAutoSeedModels}. */
  byoVendorPriority?: readonly string[];
  /** Gateway vendor ids whose underlying tenant account is currently known-broken
   *  (`providerAuthAlerts`). Demotes them out of the LEAD of the connected-flagship
   *  seed — the cloud pin previously ignored vendor health entirely, so a cloud run
   *  locked turn 1 onto an account we already knew had returned 401 and then rode
   *  the failover for the whole run. Demotion only; the vendor stays in the seed. */
  byoAlertedVendors?: readonly string[];
  /** Is the user who SUBMITTED this run a platform superadmin? Folded into the
   *  can-choose-a-model gate and the premium gate, so a superadmin's run pins the
   *  frontier model it asked for instead of silently auto-routing to the free coding
   *  pool with no paywall shown anywhere.
   *
   *  "Whose superadmin" is answered by `executions.submitted_by` (`user:<id>`), which
   *  is the only non-arbitrary answer: a `system:*` dispatcher has no user, so an
   *  autonomous sweep resolves to `false` and keeps funding-neutral behaviour. */
  isSuperadmin?: boolean;
  /** Every tenant-REGISTERED model ref — OpenRouter connection refs plus each connected
   * provider's selected models (1165). Registered models are valid pins even when they
   * are outside the curated catalog. */
  registeredModels?: readonly string[];
  /** The registered model that leads the shared provider/connection precedence. */
  preferredRegisteredModel?: string;
  /** Each connected vendor's selected models as tenant-keyed refs, keyed by dispatch
   * vendor — the soft seed leads with a selected vendor's first choice, exactly as the
   * gateway completion seed does ({@link byoAutoSeedModels}). */
  byoSelectedModels?: Readonly<Record<string, readonly string[]>>;
  /**
   * The tenant may select a PREMIUM model (any paid OpenRouter model outside the plan
   * pool, billed at OpenRouter cost + a flat 1¢/request) — i.e. a paid plan WITH a
   * validated card, per `evaluatePremiumModelAccess`. Defaults to false.
   *
   * A cloud run dispatches through the internal proxy, NOT the gateway HTTP route, so
   * the route's premium gate never sees it. Without this, an agent whose `base_model`
   * is a premium id would run ungated on our metered key. Mirrors the free-plan rule
   * below: an un-entitled premium pin is IGNORED (the run falls back to the plan's
   * coding default) rather than erroring a background run.
   */
  premiumEntitled?: boolean;
  /**
   * The Evermind CODING gate's verdict for an `evermind/<ref>` pin on this run (from
   * `resolveEvermindCodingRoute`). A cloud run is always a coding turn, so an Evermind
   * pin is honoured ONLY when this names the SAME model as qualified (a recorded coding
   * eval ≥ 90% of the frontier baseline, for that exact head version). Absent or not
   * qualified → the pin is ignored and the run takes the normal coding selection —
   * never an error. Operator decision 2026-09-12.
   */
  evermindCoding?: { model: string; qualified: boolean };
  /** What kind of call this is (plan/code/verify/explore/chat/utility) — reorders
   *  the BYO soft seed's per-vendor candidates toward that role's objective (see
   *  {@link resolveRoleObjective}) instead of leaving every call on one global
   *  precedence order regardless of what it is actually doing. Absent → balanced,
   *  today's behaviour. */
  role?: ModelRole;
  /** The launching canvas session's arc stage, when known — a further nudge on
   *  top of `role`'s objective. Ephemeral (see `modelRoles.ts`), never persisted. */
  arcStage?: ArcStage;
  /** Per-token prices (`catalogView.pricesForCall`) — read only by a COST-FIRST role,
   *  which then orders the BYO candidates and the plan coding pool by expected cost,
   *  exactly as the gateway completion seed does. Absent → tier / curated order. */
  prices?: PriceBook;
  /** Thompson exploration (cost PRD D3, lever `d3_routing_exploration`) — the caller
   *  passes it only while the lever is on for the run's tenant. Applied to the SOFT seed
   *  rankings only: a strict pin returns before any ranking, and a premium override
   *  never explores (the comped caller asked for a specific pool). Absent = deterministic. */
  explore?: RoutingExploration;
}

export interface PickCloudModelResult {
  model: string;
  strict: boolean;
  /** The learned reorder of the plan-reachable coding pool (soft-seed branch only) —
   *  surfaced so the caller can explain the choice on the timeline. */
  ranked?: string[];
  /** Observations behind the chosen seed — scored runs PLUS human thumbs
   *  ({@link qualityEvidence}). 0 when cold/curated. */
  seedSamples?: number;
  /** True when the SSM bias map was non-empty and could affect ordering. */
  biasApplied?: boolean;
}

/**
 * Decide the model a cloud-agent run should use for a turn, shared by every cloud
 * executor (durable loop + container op) so the "explicit pick = hard pin, else
 * plan's best coding model" rule lives in ONE place.
 *   • PAID plan (Pro/Teams, or a premium override) + explicit real catalog id →
 *     hard pin (`strict`), dispatched as-is.
 *   • FREE plan → model selection is NOT offered (the picker is hidden, see
 *     RunAgentControl) and is ALSO enforced here server-side: any explicit pick
 *     (a user choice OR an agent's pinned base_model) is IGNORED and the run uses
 *     the free plan's managed coding default. Builderforce manages which model
 *     free tenants run on; this is the authoritative gate (the UI hide is cosmetic).
 *   • absent / typo'd / off-catalog → the plan's default coding model, soft (so a
 *     cold model can fail over once before the run locks onto what resolved).
 */
export function pickCloudModel(
  explicitRaw: string | undefined,
  effectivePlan: EffectivePlan,
  premiumOverride = false,
  opts?: PickCloudModelOptions,
): PickCloudModelResult {
  // The pin arrives from DURABLE STATE (an agent's `base_model`, a lane default, a
  // compile-run config) that may predate a vendor version bump, so rewrite it through
  // the supersession map before ANY gate reads it. Doing it here rather than at each
  // gate keeps `isKnownModel`, `vendorForModel`, the free-plan BYO check and the pin
  // this function RETURNS (which is then written onto the execution row) all agreeing
  // on one id — a stale id would otherwise fail `isKnownModel` and silently drop the
  // run back to the plan default with no signal that the pin was the problem.
  const canonical = canonicalModelId(explicitRaw) || undefined;
  // Evermind coding gate: an `evermind/<ref>` pin serves this (coding) run only when
  // the caller resolved it as qualified. Otherwise treat the run as unpinned, so it
  // falls through to the normal coding selection below exactly as a missing pin would.
  const explicit = isEvermindModelId(canonical)
    && !(opts?.evermindCoding?.qualified === true && opts.evermindCoding.model === canonical)
    ? undefined
    : canonical;
  // An explicit pin is honored (strict) ONLY when it PREEMPTS the connected-BYO seed
  // (shared rule — see explicitModelPreemptsByo): nothing connected, or the pin is on
  // the tenant's OWN account. A non-BYO pin while an account is connected (e.g. a
  // default agent base model of `@cf/qwen`) does NOT shadow it — the connected flagship
  // leads instead. Within the honored branch the free-plan gate still applies: a free
  // tenant may pin ONLY a model their own connected provider serves; paid / premium /
  // override may pin anything.
  const explicitIsRegistered = !!explicit && !!opts?.registeredModels?.includes(explicit.trim());
  const explicitIsByo = !!explicit && (!!opts?.byoVendors?.has(vendorForModel(explicit.trim())) || explicitIsRegistered);
  if (explicitModelPreemptsByo(explicit, opts?.byoVendors, opts?.registeredModels)) {
    // A superadmin is folded in alongside the comped override: both mean "this caller
    // is not the one the paywall exists for". Without it a superadmin on a free plan
    // with no override and no BYO silently auto-routed to the free coding pool — and
    // because a cloud run shows no paywall, there was nothing anywhere saying why.
    const canChooseModel = premiumOverride || opts?.isSuperadmin === true
      || effectivePlan !== 'free' || explicitIsByo;
    // A PREMIUM pin (paid OpenRouter model off the plan pool) additionally needs the
    // card-validated entitlement — a cloud run never passes the route's premium gate,
    // so it is enforced here or nowhere. Un-entitled → ignore the pin and use the
    // plan's coding default (same shape as the free-plan gate: a background run
    // degrades to a model it may use rather than failing).
    const isPremiumPin = !explicitIsByo && isPremiumModelSelection(explicit, effectivePlan, premiumOverride);
    const premiumBlocked = isPremiumPin
      && opts?.premiumEntitled !== true && opts?.isSuperadmin !== true;
    // `isDispatchableSeed` guards against strict-pinning a typo'd/retired id (which
    // would 503 with no failover). It reads the catalog through the vendor prefix, so a
    // connected provider's own route (`direct/qwen/qwen3.8-max`) counts — the bare-index
    // `isKnownModel` never matched a prefixed id, which silently dropped EVERY direct BYO
    // pin back to the soft seed. A PREMIUM id is off our curated catalog BY DEFINITION —
    // it's the paid OpenRouter long tail — so that guard would reject every premium pin
    // and silently drop the run back to the plan default. An ENTITLED premium pin is
    // therefore honoured on its own: it came from the OpenRouter-catalog-driven picker,
    // and dispatch resolves a bare `<org>/<slug>` to the OpenRouter vendor. A REGISTERED
    // ref (an OpenRouter connection model or a provider's selected model) is honoured
    // because the tenant put it on their own list.
    const pinnable = explicitIsRegistered || isDispatchableSeed(explicit as string) || (isPremiumPin && !premiumBlocked);
    if (canChooseModel && !premiumBlocked && pinnable) {
      return { model: (explicit as string).trim(), strict: true };
    }
  }

  // No honored explicit pin: when the tenant has connected their OWN provider(s), lead
  // with the strongest connected frontier flagship as the soft seed so an auto-select
  // cloud run uses the owner's account before the free/paid coding pool.
  // Registration-driven (byoAutoSeedModels orders the connected providers' flagships by
  // the tenant's BYO precedence, tier as tiebreak — a cloud run is always an agentic
  // tool-loop, so Anthropic contributes Opus);
  // the run locks onto whatever this seed resolves on turn 1. Shared with the gateway
  // completion seed so both surfaces agree. Soft (not strict) so a transient provider
  // error still fails over.
  // Same health demotion the gateway completion seed applies. Omitted here before,
  // which is why a cloud run could lock turn 1 onto a known-401 account.
  const byoDemoted = opts?.byoAlertedVendors?.length ? new Set(opts.byoAlertedVendors) : undefined;
  const explore = !premiumOverride && opts?.explore ? opts.explore : undefined;
  const byoCandidates = opts?.preferredRegisteredModel
    ? [opts.preferredRegisteredModel]
    : byoAutoSeedModels(opts?.byoVendors, {
        agentic: true,
        vendorPriority: opts?.byoVendorPriority,
        // A provider the tenant chose models for leads with its first choice — the same
        // seed the gateway completion path builds, so a cloud run and a chat agree.
        ...(opts?.byoSelectedModels ? { selectedModels: opts.byoSelectedModels } : {}),
        ...(byoDemoted ? { demotedVendors: byoDemoted } : {}),
      });
  if (byoCandidates.length > 0) {
    // The SAME ranker the gateway completion seed uses: the role orders by tier, learned
    // `action_type` evidence re-ranks where the role lets the system choose, and health
    // is re-applied OUTERMOST — a model with a good history must not lead while its
    // vendor is known to be failing.
    const byoBias = opts?.bias && Object.keys(opts.bias).length > 0 ? opts.bias : undefined;
    const byoRanked = rankConnectedForRole(byoCandidates, {
      role: opts?.role,
      arcStage: opts?.arcStage,
      demotedVendors: byoDemoted,
      stats: opts?.actionStats,
      minSamples: opts?.minSamples,
      bias: byoBias,
      ...(explore ? { explore } : {}),
    }, registryCatalogView(opts?.prices));
    const byoSeed = byoRanked[0];
    if (byoSeed) {
      const seedStat = opts?.actionStats?.find((s) => s.model === byoSeed);
      return { model: byoSeed, strict: false, ranked: byoRanked, seedSamples: seedStat ? qualityEvidence(seedStat) : 0, biasApplied: !!byoBias };
    }
  }

  // Soft-seed branch — the ONLY place learned routing changes anything. Reorder the
  // plan-reachable coding pool by the learned stats (+ optional bias) and seed the
  // leader. With no stats this is the curated order, so the seed equals
  // codingDefaultForPlan(...) — the prior behaviour. The free-plan gate is intact:
  // an explicit pick was already ignored above, and the reorder stays WITHIN the
  // plan's reachable coding pool (free tenants only ever reorder free coding models).
  const reachable = codingModelsForPlan(effectivePlan, premiumOverride);
  // Context-aware first pass: keep only models whose window fits this request, THEN
  // let the SSM learned routing rank the survivors. Small-window models stay in the
  // pool (great first pass for small tasks) but aren't seeded into an oversized one.
  // A cost-first role (explore / utility / verify) leads with the cheapest fitting
  // coder by expected cost — the gateway seed's own pool order; any other role keeps
  // the curated order. Learned evidence still re-ranks on top.
  const fitting = orderPoolForWorkload(
    modelsFittingContext(reachable, opts?.estimatedTokens),
    profileWorkload({ role: opts?.role, arcStage: opts?.arcStage, inputTokens: opts?.estimatedTokens }),
    registryCatalogView(opts?.prices),
  );
  const bias = opts?.bias && Object.keys(opts.bias).length > 0 ? opts.bias : undefined;
  const ranked = rankModelsForAction(fitting, opts?.actionStats, { minSamples: opts?.minSamples, bias, ...(explore ? { explore } : {}) });
  const seed = ranked[0] ?? reachable[0] ?? CODING_DEFAULT_MODEL;
  // Evidence, not just runs: a seed chosen on a dozen human thumbs and no cloud run
  // IS a learned seed, and reporting 0 here made the timeline call it "cold-start".
  const seedStat = opts?.actionStats?.find((s) => s.model === seed);
  const seedSamples = seedStat ? qualityEvidence(seedStat) : 0;
  return { model: seed, strict: false, ranked, seedSamples, biasApplied: !!bias };
}
