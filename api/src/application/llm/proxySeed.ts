/**
 * Candidate-chain COMPOSITION for one gateway request — split out of
 * `LlmProxyService.ts`.
 *
 *   1. `composeCompletionSeed` — the ordered seed: workload/shape/quality/coding
 *      reorders of the plan pool, context fit, the caller hint, and the tenant's
 *      connected-account seed merged by shared precedence.
 *   2. `loadSeedCooldowns` — the bounded cooldown prefetch for that seed.
 *   3. `buildCandidateChain` — free twins folded into the seed, then the free-capped
 *      cascade, cooldown-filtered, with the BYO execution boundary applied and each
 *      owner-served vendor capped at `OWNER_SERVED_VENDOR_ATTEMPT_CAP` models.
 */

import type { ActionModelRankStat, RoutingExploration } from '@builderforce/learned-routing';
import { isCostLeverOn } from '@builderforce/cost-levers';
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
import { COOLDOWN_PREFETCH_LIMIT, byoAutoSeedModels, explicitModelPreemptsByo, resolveStrictPin } from './modelPool';
import { rankConnectedForRole } from './modelRoles';
import { registryCatalogView, type PriceBook } from './catalogView';
import { fundedFloorHintDemoted, modelsFittingContext } from './requestFit';
import { cheaperTwinsOf, orderFreeFirst, preferFreeTwins } from './freeTier';
import type { ChatCompletionRequest } from './proxyTypes';
import type { ProxyRuntime } from './proxyConfig';

/** Round-robin cursor (per-isolate). Boxed in an object so it can be shared
 *  by reference with `composeFreeCappedCascade` — the helper increments it
 *  in place, so chat and image cascades both contribute to the same rotation
 *  on a single Worker isolate (no contention, just a counter). */
const chatRequestCursor: { value: number } = { value: 0 };

/** How the free cap classifies an owner-served model: any non-FREE tier (see
 *  `buildCandidateChain`). Only the FREE-vs-not split is read there. */
const OWNER_SERVED_TIER = 'STANDARD' as const;

/**
 * The most models ONE owner-served vendor contributes to a chain, strict BYO or not.
 *
 * Owner-served models are exempt from the cooldown keyspace (`isOwnerServedVendor`) and
 * from the free cap (`OWNER_SERVED_TIER`), so nothing else bounds them: a connected vendor
 * that is DOWN (an Ollama Cloud outage, a revoked key) would otherwise be walked model by
 * model — every one of its pool models a doomed attempt, each spending a subrequest and a
 * timeout — before the chain reached anything that could answer. Three is enough to ride
 * out one model being unavailable on a healthy account and short enough that a dead
 * account costs three attempts, not the whole catalog. Earlier positions win: the cap
 * keeps the vendor's FIRST models in chain order (the tenant's own ranking / the pin).
 */
export const OWNER_SERVED_VENDOR_ATTEMPT_CAP = 3;

/** Keep at most {@link OWNER_SERVED_VENDOR_ATTEMPT_CAP} owner-served models per vendor,
 *  in chain order. Models the operator funds are untouched (their cooldowns bound them). */
function capOwnerServedPerVendor(chain: readonly string[], ownerServed: (model: string) => boolean): string[] {
  const used = new Map<VendorId, number>();
  return chain.filter((model) => {
    if (!ownerServed(model)) return true;
    const vendor = vendorForModel(model);
    const n = used.get(vendor) ?? 0;
    if (n >= OWNER_SERVED_VENDOR_ATTEMPT_CAP) return false;
    used.set(vendor, n + 1);
    return true;
  });
}

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
  // D3 exploration (lever `d3_routing_exploration`, bucketed per tenant): the learned
  // re-rankers below sample each model's evidence (Thompson) and now and then try a
  // cold one, so a model that improved can win its slot back. Never for a call that
  // NAMED its model — a strict pin, an honoured caller hint — nor inside the BYO
  // boundary, where the chain is the tenant's own accounts in the tenant's own order.
  const explore: RoutingExploration | undefined = isCostLeverOn(cfg.env, 'd3_routing_exploration', cfg.tenantId)
    && !funding.byoStrict
    && !resolveStrictPin(body as { model?: unknown; modelStrict?: unknown; strict?: unknown })
    && !callerLeads
    ? { rng: Math.random, nowMs: Date.now() }
    : undefined;
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
    cfg.modelPool, workload, catalogView,
    opts?.roleStats ? { stats: opts.roleStats, ...(explore ? { explore } : {}) } : undefined,
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
    ...(explore ? { explore } : {}),
  }, catalogView);
  // Structured single line — greppable in Workers logs as `gateway.byo_seed`. Why a
  // coding turn led with the model it did was unanswerable: demotions, the tenant's
  // ranking and the role order all happen here and left no trace (chat #6).
  // Only when something MOVED the order — a demotion, learned evidence, or a role order
  // that differs from the tenant's own — so a 778-turn run is not 778 identical lines.
  const reordered = byoSeeds.some((m, i) => m !== rankMerged[i]);
  if (rankMerged.length > 0 && (demotedVendors.size > 0 || reordered || !!opts?.roleStats?.length)) {
    console.log(JSON.stringify({
      event: 'gateway.byo_seed',
      tenantId: cfg.tenantId,
      role: workload.role ?? null,
      arcStage: workload.arcStage ?? null,
      connected: rankMerged,
      demoted: [...demotedVendors],
      ranked: byoSeeds,
      learned: !!opts?.roleStats?.length,
      // An honoured caller model leads ahead of `ranked` (below).
      callerLeads: !!callerLeads,
    }));
  }
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
  // FREE FIRST (`fundingOrder.ts`): the free tier leads and the connected accounts follow
  // it instead of heading the chain. Only an honoured caller pin stays ahead of the free
  // tier — that is the person naming a model, not the gateway choosing one.
  // Owner-served pool models are the tenant's account, not the operator's free tier, so
  // they wait with the connected accounts; the cascade exempts them from the free cap.
  if (cfg.freeFirst && byoSeeds.length > 0) {
    const pinHead: readonly string[] = callerLeads ? [callerModel as string] : [];
    return {
      seed: orderFreeFirst(pinHead, basePool, byoSeeds, (m) => funding.isOwnerServedModel(m)),
      seedHead: pinHead,
    };
  }
  const seed: readonly string[] = seedHead.length > 0
    ? [...seedHead, ...basePool.filter((m) => !seedHead.includes(m))]
    : basePool;
  return { seed, seedHead };
}

/**
 * Pre-fetch cooldown state for the leading seed slice, the cheaper twins of EVERY
 * seed entry, and the premium fallback (KV-backed when bound, in-memory fallback
 * otherwise). The seed's own models are truncated to `COOLDOWN_PREFETCH_LIMIT`
 * entries — see that constant for the trade-off rationale. The twins are read for
 * the whole seed because `buildCandidateChain` may insert one ahead of ANY seed
 * model (`preferFreeTwins`); reads are one per distinct vendor, so a twin costs at
 * most one more read when it brings a new vendor. Vendor
 * cooldown short-circuits the per-model walk when one upstream's key
 * is globally throttled; the fallback models are included so the
 * chain composer skips any individually cooled entry instead of
 * firing a doomed retry against a saturated endpoint.
 */
export async function loadSeedCooldowns(
  { cfg, funding }: SeedRuntime,
  seed: readonly string[],
): Promise<[Set<string>, Set<VendorId>]> {
  const leading = seed.slice(0, COOLDOWN_PREFETCH_LIMIT);
  const ownerServed = (m: string) => funding.isOwnerServedModel(m);
  // Twins of EVERY seed entry, not just the leading slice: `preferFreeTwins` expands the
  // whole seed, so a twin of a deep entry that was never read would be inserted cooled.
  // Bounded anyway — the reads are one per DISTINCT VENDOR (`loadCooldownExpiries`), so a
  // twin only costs a read when it brings a vendor the slice did not.
  // No twins under the BYO boundary — `buildCandidateChain` does not insert them there.
  const twins = funding.byoStrict ? [] : seed.flatMap((m) => cheaperTwinsOf(m, ownerServed));
  const seedPrefix = [...new Set([...leading, ...twins])];
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
  const isUnavailable = buildCooldownPredicate({
    cooledModels:  cooledSet,
    cooledVendors,
    vendorOf:      vendorForModel,
    ...(pinnedModel !== undefined ? { pinnedModel } : {}),
  });
  const ownerServed = (m: string) => funding.isOwnerServedModel(m);
  // Same model, cheaper vendor first (`freeTier.ts`): a paid seed entry with a free twin
  // gets the twin directly ahead of it. Folded into the SEED, before the cascade, so a
  // FREE twin counts against `freeBudget` like any FREE model and the paid original stays
  // behind it. Never under the BYO boundary: there the chain is the tenant's own accounts
  // in the tenant's own order, and "free" (free to the operator) does not apply.
  const twinSeed = funding.byoStrict ? seed : preferFreeTwins(seed, isUnavailable, ownerServed);
  const candidates = composeFreeCappedCascade({
    seed: twinSeed,
    ...(head && head.length ? { head } : {}),
    premiumFallback: funding.premiumFallback,
    freeBudget: cfg.freeBudget,
    // The free cap protects the OPERATOR's free pool. A model the tenant serves from their
    // own account is not part of it, even when the catalog tags it FREE (a connected Ollama
    // Cloud key), so it is never capped out — it keeps its seed position with the paid ones.
    tierOf: (m) => (ownerServed(m) ? OWNER_SERVED_TIER : tierForModel(m)),
    isUnavailable,
    cursor: chatRequestCursor,
  });
  // BYO is an execution boundary, not merely a preference. Once at least one
  // tenant credential resolves, remove every shared/operator-funded vendor from
  // the chain. Multiple connected providers may still fail over among themselves.
  const bounded = funding.byoStrict
    ? candidates.filter((model) =>
        funding.connectedByoVendors.has(vendorForModel(model))
        || cfg.openRouterConnectionModels.has(model))
    : candidates;
  // Owner-served models answer to no cooldown and no free cap, so a down connected
  // vendor is bounded HERE — in strict and non-strict chains alike.
  return capOwnerServedPerVendor(bounded, ownerServed);
}
