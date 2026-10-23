/**
 * The gateway completion USE CASE — the body of `LlmProxyService.complete()`, split
 * out of the facade. Orchestrates the steps the other `proxy*` modules own:
 *
 *   exact response cache → semantic cache (B2) → single-flight (B3) →
 *   strict pin → seed + cooldowns → candidate chain →
 *   (empty chain branch | primary cascade → schema downgrade → paid backstop) → finalize
 *
 * The two cache tiers and the single-flight join only ever answer a request the exact
 * tier deems replayable (idempotent `useCase`, low temperature, no tools, no stream),
 * and only when the caller granted caching (`responseCache`). Both stores run on the
 * PRIMARY path's success, never on a backstop or schema-downgraded answer.
 */

import type { ActionModelRankStat } from '@builderforce/learned-routing';
import { isCostLeverOn } from '@builderforce/cost-levers';
import { canonicalModelId, isPaidOverflowModel, resolveStrictPin } from './modelPool';
import type { PriceBook } from './catalogView';
import { downgradeResponseFormat, newTraceId } from './proxyFailover';
import { readResponseCacheHit, responseCacheKeyFor, storeInResponseCache } from './proxyResponseCache';
import { dispatchStrict } from './proxyStrictPin';
import { buildCandidateChain, composeCompletionSeed, loadSeedCooldowns } from './proxySeed';
import { resolveEmptyChain } from './proxyAllCooled';
import { applyExcludedModels } from './requestFit';
import { lookupSemanticChat, planSemanticChat, storeSemanticChat, type ResponseCacheGrant, type SemanticChatDeps } from './semanticChatCache';
import { coalesceCompletion } from './proxySingleFlight';
import type { ChatCompletionRequest, ProxyResult } from './proxyTypes';
import type { ProxyRuntime } from './proxyConfig';

/** Per-call options for `LlmProxyService.complete()`. */
export interface CompleteOptions {
  estimatedTokens?: number;
  /** Permission to cache: the tenant, and optionally the project, principal and file
   *  grounds the semantic tier scopes and invalidates by (see `ResponseCacheGrant`). */
  responseCache?: ResponseCacheGrant;
  /** Collaborators of the semantic step (embedder, facts revision, log) — tests only. */
  semanticDeps?: SemanticChatDeps;
  /** Learned per-model stats for `body.role` (see `roleRoutingStats`) — reorders the
   *  connected-account seed by what each model actually delivered in that role. */
  roleStats?: ReadonlyArray<ActionModelRankStat>;
  /** Per-token prices (see `catalogView.loadPriceBook`). Only a COST-FIRST call
   *  (explore / utility / verify — `poolOrderIsCostFirst`) reads them, so a caller
   *  loads them only then. Absent → the pool keeps its order and BYO orders by tier. */
  prices?: PriceBook;
}

export async function completeChat(
  rt: ProxyRuntime,
  body: ChatCompletionRequest,
  requestHeaders?: Record<string, string>,
  traceId?: string,
  signal?: AbortSignal,
  opts?: CompleteOptions,
): Promise<ProxyResult> {
  const { cfg, finalize } = rt;
  const startedAt = Date.now();
  const tid = traceId ?? newTraceId();
  const grant = opts?.responseCache;

  // ── EXACT-MATCH RESPONSE CACHE ──────────────────────────────────────────
  // See `responseCacheKeyFor` for the double opt-in.
  const cacheKey = await responseCacheKeyFor(body, grant);
  if (cacheKey) {
    const hit = await readResponseCacheHit(cfg.env, cacheKey);
    if (hit) return finalize(hit, tid, startedAt, [hit.resolvedModel], 'response_cache_hit');
  }

  // ── SEMANTIC CACHE (B2) ─────────────────────────────────────────────────
  // A paraphrase of an answered request, scoped and grounds-checked — see
  // `semanticChatCache`. Lever off ⇒ no embedding is ever computed.
  const semantic = grant && isCostLeverOn(cfg.env, 'b2_semantic_cache', grant.tenantId)
    ? await planSemanticChat(cfg.env, body, grant, opts?.semanticDeps)
    : null;
  if (semantic && grant) {
    const hit = await lookupSemanticChat(cfg.env, semantic, grant, opts?.semanticDeps);
    if (hit) return finalize(hit, tid, startedAt, [hit.resolvedModel], 'response_cache_hit');
  }

  const storeOnPrimarySuccess = async (primary: ProxyResult): Promise<void> => {
    // The response body is consumed by CLONING inside each store — the original must
    // still be readable by the caller. Best-effort: a failed store costs a future miss.
    if (cacheKey) await storeInResponseCache(cfg.env, cacheKey, primary);
    if (semantic) await storeSemanticChat(cfg.env, semantic, primary);
  };
  const dispatch = (): Promise<ProxyResult> =>
    dispatchUncached(rt, body, requestHeaders, tid, startedAt, signal, opts, cacheKey, storeOnPrimarySuccess);

  // ── SINGLE-FLIGHT (B3) ──────────────────────────────────────────────────
  // Identical cacheable requests already in flight on this isolate share one upstream
  // call (keyed on the exact cache key = tenant scope + normalized body hash). A
  // follower is answered as a cache hit. Per-isolate only — see `singleFlight.ts`.
  if (cacheKey && grant && isCostLeverOn(cfg.env, 'b3_single_flight', grant.tenantId)) {
    return coalesceCompletion(cacheKey, dispatch, (shared) =>
      finalize(shared, tid, startedAt, [shared.resolvedModel], 'response_cache_hit'));
  }
  return dispatch();
}

/** Everything after the caches: strict pin, or the seeded cascade with its recoveries. */
async function dispatchUncached(
  rt: ProxyRuntime,
  body: ChatCompletionRequest,
  requestHeaders: Record<string, string> | undefined,
  tid: string,
  startedAt: number,
  signal: AbortSignal | undefined,
  opts: CompleteOptions | undefined,
  cacheKey: string | null,
  storeOnPrimarySuccess: (primary: ProxyResult) => Promise<void>,
): Promise<ProxyResult> {
  const { cfg, funding, dispatcher, finalize } = rt;
  // Rewrite a superseded pin to its live successor BEFORE anything reads it. This is
  // the gateway-side seam of {@link canonicalModelId}: `body.model` is whatever the
  // caller had stored (an agent base_model, a lane default, an SDK pin), and that can
  // be months old. Rewriting here covers the strict-pin branch and the chained branch
  // together, so a retired id can never reach `dispatch` — and can never be filtered
  // out of the BYO seed as "not dispatchable", which is what turned a stale Opus pin
  // into a bare `byo_unavailable` with four providers connected.
  const rawCallerModel = (body as { model?: unknown }).model;
  const callerModel = typeof rawCallerModel === 'string' && rawCallerModel.trim()
    ? canonicalModelId(rawCallerModel)
    : rawCallerModel;
  // `modelStrict` OR the public `strict` alias → single-model hard pin. Both
  // funnel through `resolveStrictPin` (which also enforces the "model present"
  // precondition) so the service can't disagree with the route's gate.
  const wantsStrict = resolveStrictPin(body as { model?: unknown; modelStrict?: unknown; strict?: unknown });

  // Strict-pin path: single-model dispatch, no chain, no failover. Cooldown
  // and missing-vendor-key are the only pre-flight gates; if either fails
  // the request returns 503 `model_unavailable` instead of falling through.
  if (wantsStrict) {
    return finalize(
      await dispatchStrict(rt, callerModel as string, body, requestHeaders),
      tid, startedAt, [callerModel as string],
    );
  }

  // Seed composition (pool reorders, context fit, caller hint, connected accounts)
  // and the bounded cooldown prefetch — see `proxySeed`.
  const { seed, seedHead } = await composeCompletionSeed(rt, body, callerModel, opts);
  const [cooledSet, cooledVendors] = await loadSeedCooldowns(rt, seed);
  // Pinned hint bypasses vendor-level cooldown so a caller-explicit paid model
  // (`anthropic/claude-3-haiku`) gets tried even when the same vendor's free
  // key has 429'd its way into vendor cooldown. Per-model cooldown still
  // applies — we won't retry a model that *itself* just failed.
  // The seed's head (caller pin OR the strongest connected-BYO flagship) bypasses
  // vendor-level cooldown so the owner's own account is still tried even when that
  // vendor's operator key has 429'd its way into vendor cooldown. Per-model cooldown
  // still applies.
  const pinnedHint = seedHead.length > 0 ? seedHead[0] : undefined;
  // Pass seedHead as the cascade HEAD so a deliberately-seeded connected-BYO flagship
  // (or explicit pin) leads verbatim — otherwise a PREMIUM/ULTRA seed falls behind the
  // free pool and the connected account is tried last (or never). See composeFreeCappedCascade.
  const candidates = applyExcludedModels(
    buildCandidateChain(rt, seed, cooledSet, cooledVendors, pinnedHint, seedHead),
    body.excludeModels,
  );
  if (candidates.length === 0) {
    return resolveEmptyChain(rt, {
      body, requestHeaders, signal, traceId: tid, startedAt,
      seed, seedHead, pinnedHint, cooledSet, cooledVendors, cacheKey,
    });
  }

  let primary = await dispatcher.dispatch(candidates, body, requestHeaders, { signal });
  if (primary.response.status < 400) {
    // Mark overflow when the primary cascade itself landed on an appended
    // premium-fallback model (vs a plan-pool model) so the route meters it —
    // UNLESS the tenant's OWN account served it (a connected subscription OR a BYO
    // api-key — free to us; see isTenantFunded), e.g. an owner whose connected-BYO
    // flagship (claude-*) seeded the head and served the turn on their own account.
    primary.paidOverflow = isPaidOverflowModel(primary.resolvedModel) && !funding.isTenantFunded(primary);
    // Store for the exact-match and semantic caches (each CLONES — the caller still
    // reads the original). Best-effort: a failed store costs a future miss, nothing else.
    await storeOnPrimarySuccess(primary);
    return finalize(primary, tid, startedAt, candidates);
  }

  // A genuine malformed request (400/422) can't be fixed by failover OR by
  // relaxing the schema — surface it straight away.
  if (primary.outcome === 'request_error') {
    return finalize(primary, tid, startedAt, candidates);
  }

  // AUTO-DOWNGRADE: every candidate rejected the `response_format.json_schema`
  // as too complex for its constrained-decoding engine. Rather than hard-fail a
  // feature that just needs a structured answer (hired.video's resume-tailor),
  // relax the request to loose `json_object` mode — no schema, so no
  // constrained-decoding ceiling — and re-run the cascade. The model still
  // returns JSON (the schema is carried into the prompt as guidance); the caller
  // validates it client-side. This is what turns a terminal schema rejection
  // into a delivered result. The downgraded body also feeds the backstop below,
  // so even a saturated pool floors onto a funded model in json_object mode.
  let effectiveBody = body;
  if (primary.outcome === 'schema_too_complex') {
    const downgraded = downgradeResponseFormat(body);
    if (!downgraded) {
      // No strict json_schema to relax (shouldn't happen for this outcome) —
      // surface the terminal error honestly.
      return finalize(primary, tid, startedAt, candidates);
    }
    effectiveBody = downgraded;
    const retry = await dispatcher.dispatch(candidates, downgraded, requestHeaders, { signal });
    // Carry the schema-rejection trace in front of the retry's own attempts so
    // the diagnostic record shows BOTH the rejection and the recovery.
    retry.failovers = [...primary.failovers, ...retry.failovers];
    retry.attempts  = [...(primary.attempts ?? []), ...(retry.attempts ?? [])];
    retry.schemaDowngraded = true;
    if (retry.response.status < 400) {
      retry.paidOverflow = isPaidOverflowModel(retry.resolvedModel) && !funding.isTenantFunded(retry);
      return finalize(retry, tid, startedAt, candidates, 'success');
    }
    // Downgraded cascade still failed for a NON-schema reason (saturation, etc.)
    // — fall through to the funded backstop with the downgraded body.
    primary = retry;
  }

  // Primary cascade failed (saturated free pool, cascade-exhausted 429, etc.).
  // Fire the guaranteed paid backstop on the credited key before giving up so
  // the caller gets a real answer instead of `AI_UNAVAILABLE`. On success,
  // splice the primary cascade's diagnostics in front of the backstop's so the
  // trace still records everything that was tried. Uses `effectiveBody` so a
  // schema-downgraded request floors onto the backstop in json_object mode too.
  const backstop = cfg.disablePaidOverflow ? null : await dispatcher.dispatchBackstop(effectiveBody, requestHeaders);
  if (backstop) {
    backstop.failovers = [...primary.failovers, ...backstop.failovers];
    backstop.retries   = primary.retries + backstop.retries;
    backstop.attempts  = [...(primary.attempts ?? []), ...(backstop.attempts ?? [])];
    backstop.paidOverflow = !funding.isTenantFunded(backstop);
    if (effectiveBody !== body) backstop.schemaDowngraded = true;
    return finalize(backstop, tid, startedAt, [...candidates, ...cfg.backstopModels], 'success');
  }
  return finalize(primary, tid, startedAt, candidates);
}
