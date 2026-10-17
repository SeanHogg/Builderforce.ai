/**
 * Candidate-chain COMPOSITION for one gateway request — split out of
 * `LlmProxyService.ts`.
 *
 *   1. `composeCompletionSeed` — the ordered seed: workload/shape/quality/coding
 *      reorders of the plan pool, context fit, the caller hint, and the tenant's
 *      connected-account seed merged by shared precedence.
 *   2. `loadSeedCooldowns` — the bounded cooldown prefetch for that seed.
 *   3. `buildCandidateChain` — the free-capped cascade, cooldown-filtered, with the
 *      BYO execution boundary applied.
 */

import type { ActionModelRankStat } from '@builderforce/learned-routing';
import { orderPoolForWorkload } from '@builderforce/model-router';
import { profileWorkload } from '@builderforce/workload';
import { tierForModel, vendorForModel, type VendorId } from './vendors';
import {
  inferShape,
  isQualityCriticalUseCase,
  reorderPoolByShape,
  reorderPoolForCoding,
  reorderPoolForQuality,
} from './poolRouting';
import { composeFreeCappedCascade, buildCooldownPredicate } from './cascadeComposer';
import { loadCooldowns, loadCooledVendors } from '../../infrastructure/auth/cooldownStore';
import { connectionModelRefs } from './openRouterConnectionService';
import { loadDemotedVendors } from './vendors/vendorHealth';
import { COOLDOWN_PREFETCH_LIMIT, byoAutoSeedModels, explicitModelPreemptsByo } from './modelPool';
import { rankConnectedForRole } from './modelRoles';
import { registryCatalogView, type PriceBook } from './catalogView';
import { fundedFloorHintDemoted, modelsFittingContext } from './requestFit';
import type { ChatCompletionRequest } from './proxyTypes';
import type { ProxyRuntime } from './proxyConfig';

/** Round-robin cursor (per-isolate). Boxed in an object so it can be shared
 *  by reference with `composeFreeCappedCascade` — the helper increments it
 *  in place, so chat and image cascades both contribute to the same rotation
 *  on a single Worker isolate (no contention, just a counter). */
const chatRequestCursor: { value: number } = { value: 0 };

/** The routing evidence a caller may thread into seed composition. */
export interface SeedRoutingOptions {
  estimatedTokens?: number;
  roleStats?: ReadonlyArray<ActionModelRankStat>;
  prices?: PriceBook;
}

export interface CompletionSeed {
  /** The full ordered seed handed to the chain composer. */
  seed: readonly string[];
  /** The deliberately-seeded head (honoured caller pin and/or connected accounts). */
  seedHead: readonly string[];
}

type SeedRuntime = Pick<ProxyRuntime, 'cfg' | 'funding'>;

export async function composeCompletionSeed(
  { cfg, funding }: SeedRuntime,
  body: ChatCompletionRequest,
  callerModel: unknown,
  opts?: SeedRoutingOptions,
): Promise<CompletionSeed> {
  // 1) Pool composition is already TTFT-ordered (Cerebras → Ollama → NVIDIA
  //    → OpenRouter) because `autoRoutableModelsByTier` walks the registry's MODULES
  //    array in priority order. Shape-based reorder then floats capable
  //    models (tools / structured / vision) to the head within that order.
  //
  //    A COST-FIRST call (exploring, verifying, mechanical work) first orders the pool
  //    by expected cost for THIS workload — price × estimated tokens, local and FREE at
  //    zero. Every reorder below is a stable sort, so capability (shape, coding
  //    drivers, context fit) still decides the buckets and cost only orders WITHIN
  //    them: a cheap model never jumps a capable one. Where the role lets the system
  //    choose, the role's learned evidence (`roleStats`) then re-ranks the pool the
  //    same way it re-ranks connected accounts below — so a tenant with nothing
  //    connected still gets the models that delivered in this role. Any other call:
  //    unchanged.
  const workload = profileWorkload({
    role: body.role,
    arcStage: body.arcStage,
    inputTokens: opts?.estimatedTokens,
    maxOutputTokens: body.max_tokens,
  });
  const catalogView = registryCatalogView(opts?.prices);
  const reorderedPool = reorderPoolByShape(body, orderPoolForWorkload(
    cfg.modelPool, workload, catalogView, opts?.roleStats ? { stats: opts.roleStats } : undefined,
  ));

  // 1b) Quality-critical useCase (resume tailoring, cover letters, …): re-rank
  //     the shape-sorted pool so the best models the PLAN unlocks lead (premium
  //     writers for paid; a no-op within a free pool). For a strict json_schema
  //     it still keeps a low-ceiling model (Gemini) last within its tier, so the
  //     two routing rules compose. The capability order from the shape sort is
  //     preserved as the within-tier tiebreak.
  const useCase = (body as { useCase?: unknown }).useCase;
  const useCaseStr = typeof useCase === 'string' ? useCase : undefined;
  const qualityCritical = isQualityCriticalUseCase(useCaseStr);
  let routedPool: readonly string[] = qualityCritical
    ? reorderPoolForQuality(reorderedPool, {
        strictSchema: (body as { response_format?: { type?: string } }).response_format?.type === 'json_schema',
      })
    : reorderedPool;

  // 1b2) Agentic tool-loop (the request carries `tools`) is coding-critical: a
  //      long tool-calling analysis turn served by a cheap generalist loops
  //      without converging. `reorderPoolByShape` above floats every tools-capable
  //      model equally, so a merely-tool-advertising generalist can still lead its
  //      bucket; this pass promotes the real CODING_MODEL_POOL drivers ahead of
  //      them. A pure permutation of the plan pool — free tenants only float their
  //      own free coding models (no plan escalation). Skipped for quality-critical
  //      traffic (output-quality writers, ranked by tier just above).
  if (!qualityCritical && inferShape(body).hasTools) {
    routedPool = reorderPoolForCoding(routedPool);
  }

  // 1c) Context-fit first pass: when the caller estimates how many tokens the
  //     turn will send, drop pool models whose catalog window can't hold it, so
  //     a small-window model isn't SEEDED into a context it would 413 on (the
  //     97K-into-32K bug — the exact "Brain dies after several executions"
  //     failover). Never empties the pool (see modelsFittingContext); oversized
  //     requests still fall through to the normal cascade + 413 failover.
  const fittedPool = modelsFittingContext(routedPool, opts?.estimatedTokens);

  // 2) Caller hint goes at the head; rest of the pool follows.
  //    `callerModel` was extracted at the top of this function for the strict-pin
  //    branch; reuse it here for the chained path. With NO caller model, the
  //    owner's connected accounts lead the pool (soft seed) so an auto-select turn
  //    uses the tenant's OWN premium frontier model(s) before the free/paid tiers —
  //    registration-driven (one flagship per connected provider, strongest tier
  //    first), NOT a fixed vendor; Opus/Sonnet for Anthropic per turn shape. The
  //    cascade then fails over across the owner's other connected accounts, and the
  //    plan pool stays behind them all as final fallback. See byoAutoSeedModels.
  // A non-strict caller `model` is a HINT, not an override of the tenant's connected
  // account. Honour it at the head ONLY when it PREEMPTS the BYO seed — nothing
  // connected, or the model is itself served by a connected BYO vendor (see
  // {@link explicitModelPreemptsByo}). A NON-BYO caller model (the VS Code Brain's
  // configured `defaultModel`, a stale coder default, any SDK caller's pin) must NOT
  // shadow the connected flagship: otherwise a tenant with a connected Claude account
  // silently runs a weak free coder — the "should have selected Opus" regression. This
  // is the SAME invariant `byoAwareModel`/`explicitModelPreemptsByo` enforce on the
  // tenantProxy + /v1/messages paths; applying it centrally HERE stops the gateway
  // completion seed from drifting from them (a caller model bypassed the gate before).
  // A shadowed hint still joins the pool just BEHIND the flagship, so it's the first
  // failover after the connected account rather than being dropped.
  const hasCallerModel = typeof callerModel === 'string' && callerModel.length > 0;
  const connectedByo = funding.connectedByoVendors;
  // ONE rule, and it must see the REGISTERED refs too: an OpenRouter connection
  // contributes no BYO vendor, so a vendor-only test would let a stale caller default
  // lead over the connection the tenant ranked #1 (see explicitModelPreemptsByo).
  // A FREE tenant's soft hint on a FUNDED floor model never leads. The hint is the
  // canvas/Brain soft-pin ("keep the continuations of one turn on the model that
  // began it"), and when turn 1 landed on the direct-Anthropic floor because nothing
  // else fit the request, honouring the pin put fifteen more completions on our
  // CLAUDE_API_KEY without the free pool being asked once (measured: session
  // bf886fc1, 16 of 16 completions on `claude-sonnet-5`, account "shared", plan
  // free). The floor stays reachable — it joins the chain BEHIND the plan pool as the
  // fallback it is — so nothing is refused; the free coders get first refusal.
  const hintIsFundedFloor = fundedFloorHintDemoted(hasCallerModel ? callerModel as string : undefined, cfg.isPro);
  const callerLeads = hasCallerModel && !hintIsFundedFloor
    && explicitModelPreemptsByo(callerModel as string, connectedByo, cfg.openRouterConnectionModels);
  // Demote any connected vendor we KNOW is currently unhealthy out of the LEAD
  // position (it stays in the seed — see `byoAutoSeedModels`). Two independent
  // sources, unioned, because they answer different questions:
  //   • `loadDemotedVendors` — a 5xx streak against the VENDOR, keyspace global.
  //     It cannot speak for one owner's account, which is why it alone left a
  //     tenant whose account returned 401 leading the seed on every request.
  //   • `byoAlertedVendors` — a 401/403/out-of-budget recorded for THIS TENANT's
  //     account (`providerAuthAlerts`), resolved by the caller alongside
  //     `byoVendorPriority`. This is the half that makes a broken BYO account cost
  //     one wasted attempt in total instead of one per run.
  // Returns an empty set and issues no reads when nothing is connected, so the
  // non-BYO path is untouched.
  const streakDemoted = await loadDemotedVendors(cfg.env, connectedByo);
  const demotedVendors = cfg.byoAlertedVendors.length
    ? new Set([...streakDemoted, ...cfg.byoAlertedVendors])
    : streakDemoted;
  const providerSeeds = byoAutoSeedModels(connectedByo, {
    agentic: cfg.codingOnly,
    vendorPriority: cfg.byoVendorPriority,
    ...(demotedVendors.size ? { demotedVendors } : {}),
    // A provider the tenant chose models for contributes that ordered list, not its flagship.
    ...(Object.keys(cfg.byoSelectedModels).length ? { selectedModels: cfg.byoSelectedModels } : {}),
  });
  // Merge provider flagships and named OpenRouter model sets by their SHARED
  // persisted rank. This is the core product behavior: "Cheap coders, then my
  // Claude account, then Frontier" is one list, not two unrelated priorities.
  // Grouped per vendor: a vendor with a model SELECTION contributes several models, and a
  // one-model-per-vendor map would keep only the last of them.
  const providerSeedsByVendor = new Map<string, string[]>();
  for (const model of providerSeeds) {
    const vendor = vendorForModel(model);
    providerSeedsByVendor.set(vendor, [...(providerSeedsByVendor.get(vendor) ?? []), model]);
  }
  const rankedSeeds: Array<{ priority: number | null; tie: number; models: string[] }> = [
    ...cfg.byoProviderPriorities.map((entry, tie) => ({
      priority: entry.priority,
      tie,
      models: providerSeedsByVendor.get(entry.vendor) ?? [],
    })),
    ...cfg.openRouterConnections.map((connection, tie) => ({
      priority: connection.priority,
      tie: cfg.byoProviderPriorities.length + tie,
      models: connectionModelRefs([connection]),
    })),
  ];
  rankedSeeds.sort((a, b) => {
    const ar = a.priority ?? Number.POSITIVE_INFINITY;
    const br = b.priority ?? Number.POSITIVE_INFINITY;
    return ar === br ? a.tie - b.tie : ar - br;
  });
  const rankedModels = rankedSeeds.flatMap((entry) => entry.models);
  const rankMerged = [...new Set([
    ...rankedModels,
    ...providerSeeds.filter((model) => !rankedModels.includes(model)),
  ])];
  // Order for what this call is FOR, with health re-applied as the outermost key:
  // the rank merge above re-sorts by persisted priority alone, which is how a vendor
  // `byoAutoSeedModels` had demoted for faulting got pulled back to the lead whenever
  // the tenant ranked it first. A coding turn then leads with the strongest connected
  // model — or, once there is evidence, the one that has delivered best in that role;
  // a planning turn keeps the tenant's order.
  const byoSeeds = rankConnectedForRole(rankMerged, {
    role: workload.role,
    arcStage: workload.arcStage,
    demotedVendors,
    ...(opts?.roleStats ? { stats: opts.roleStats } : {}),
  }, catalogView);
  // An honoured caller model LEADS, but it never stands alone: the tenant's OTHER
  // connected accounts follow it as failover. BYO is an execution boundary — the
  // chain composer below drops every operator-funded model — so a lead-only head
  // means a single cooled/faulting provider ends the request with `byo_unavailable`
  // while three other connected accounts sit unused. (The measured stall: a cloud run
  // pinned `claude-opus-4-8` with Anthropic, xAI, OpenAI AND Meta connected and never
  // tried the other three.) Dedup keeps the lead's position when it IS a flagship.
  const seedHead: readonly string[] = callerLeads
    ? [callerModel as string, ...byoSeeds.filter((m) => m !== callerModel)]
    : byoSeeds;
  const basePool: readonly string[] = (hasCallerModel && !callerLeads && !fittedPool.includes(callerModel as string))
    ? (hintIsFundedFloor ? [...fittedPool, callerModel as string] : [callerModel as string, ...fittedPool])
    : fittedPool;
  const seed: readonly string[] = seedHead.length > 0
    ? [...seedHead, ...basePool.filter((m) => !seedHead.includes(m))]
    : basePool;
  return { seed, seedHead };
}

/**
 * Pre-fetch cooldown state for the leading seed slice + premium fallback
 * (KV-backed when bound, in-memory fallback otherwise). The seed is
 * truncated to `COOLDOWN_PREFETCH_LIMIT` entries to bound subrequest
 * cost — see that constant for the trade-off rationale. Vendor
 * cooldown short-circuits the per-model walk when one upstream's key
 * is globally throttled; the fallback models are included so the
 * chain composer skips any individually cooled entry instead of
 * firing a doomed retry against a saturated endpoint.
 */
export async function loadSeedCooldowns(
  { cfg, funding }: SeedRuntime,
  seed: readonly string[],
): Promise<[Set<string>, Set<VendorId>]> {
  const seedPrefix = seed.slice(0, COOLDOWN_PREFETCH_LIMIT);
  const fallbackPairs = funding.premiumFallback.map((m) => ({ vendor: vendorForModel(m), model: m }));
  const seedVendors = Array.from(new Set([
    ...seedPrefix.map((m) => vendorForModel(m)),
    ...fallbackPairs.map((p) => p.vendor),
  ]));
  // Never ASK about a vendor the tenant serves themselves: the global keyspace can't
  // speak for the owner's account ({@link isOwnerServedVendor}). Filtering the pairs
  // BEFORE the read (rather than the results after) both applies the exemption and drops
  // those KV subrequests. Without it, a stale bench on connected provider A silently
  // demotes it below connected provider B — violating the tenant's own BYO precedence —
  // and, once it covers every connected model, composes an empty chain that only the
  // probe backstop below rescues.
  const [cooledSet, cooledVendors] = await Promise.all([
    loadCooldowns(cfg.env, [
      ...seedPrefix.map((m) => ({ vendor: vendorForModel(m), model: m })),
      ...fallbackPairs,
    ].filter((p) => !funding.isOwnerServedModel(p.model))),
    loadCooledVendors(cfg.env, seedVendors.filter((v) =>
      !funding.isOwnerServedVendor(v)
      && !(v === 'openrouter' && cfg.openRouterConnectionModels.size > 0))),
  ]);
  return [cooledSet, cooledVendors];
}

/**
 * Compose the candidate chain for one request via the shared
 * `composeFreeCappedCascade` helper.
 *
 * Per-model cooldown excludes specific models that recently failed. Per-vendor
 * cooldown is the wider net: when one upstream key is globally throttled
 * (e.g. all OpenRouter free-tier 429s), the vendor itself is cooled and we
 * skip every model owned by that vendor in one pass — instead of walking
 * many models on the saturated key one 429 at a time. See
 * `maybeTripVendorCooldown` in cooldownStore.ts for the trip conditions.
 *
 * The FREE cap is the headline guarantee: regardless of how saturated the
 * upstream free pool is, every cascade tries at most 2 free models before
 * falling through to the premium fallback — so callers always see a
 * successful response instead of `cascade-exhausted` 429s.
 */
export function buildCandidateChain(
  { cfg, funding }: SeedRuntime,
  seed: readonly string[],
  cooledSet: Set<string>,
  cooledVendors: Set<VendorId>,
  pinnedModel?: string,
  head?: readonly string[],
): string[] {
  const candidates = composeFreeCappedCascade({
    seed,
    ...(head && head.length ? { head } : {}),
    premiumFallback: funding.premiumFallback,
    freeBudget: cfg.freeBudget,
    tierOf: tierForModel,
    isUnavailable: buildCooldownPredicate({
      cooledModels:  cooledSet,
      cooledVendors,
      vendorOf:      vendorForModel,
      ...(pinnedModel !== undefined ? { pinnedModel } : {}),
    }),
    cursor: chatRequestCursor,
  });
  // BYO is an execution boundary, not merely a preference. Once at least one
  // tenant credential resolves, remove every shared/operator-funded vendor from
  // the chain. Multiple connected providers may still fail over among themselves.
  return funding.byoStrict
    ? candidates.filter((model) =>
        funding.connectedByoVendors.has(vendorForModel(model))
        || cfg.openRouterConnectionModels.has(model))
    : candidates;
}
