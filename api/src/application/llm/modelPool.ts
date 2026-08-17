/**
 * Model pool composition — WHICH models exist, in what order, for which plan.
 *
 * Carved out of `LlmProxyService`, which had grown to 3,240 lines and 77 exports:
 * the largest module in the application layer, and the one the most code depends
 * on. This half of it answers a question that has nothing to do with dispatching
 * a request — it is static catalog data plus the derivations over it (plan tiers,
 * coding pool, BYO flagships, attempt budgets, timeouts).
 *
 * Deliberately a LEAF: it imports the vendor catalogs and nothing else from this
 * package, so `poolRouting` can depend on it without a cycle back through the
 * service. (An earlier cut had `poolRouting` import these constants from
 * `LlmProxyService` directly, which deadlocked at module-eval time: the pool sets
 * are built eagerly at import, unlike drizzle's lazy table references.)
 *
 * `LlmProxyService` re-exports everything here, so no caller changed.
 */

import {
  catalogEntry,
  dispatchVendor,
  autoRoutableModelsByTier,
  parseVendorPrefix,
  tierForModel,
  vendorForModel,
  MAX_VENDOR_CALL_TIMEOUT_MS,
  type VendorId,
} from './vendors';
import {
  byoVendorIdsFromCredentials,
} from './tenantProviderKeyService';
import type { EffectivePlan } from '../../domain/tenant/effectivePlan';

// ---------------------------------------------------------------------------
// Pool composition (derived from vendor catalogs — single source of truth)
//
// Multi-vendor by construction. `modelsByTier` walks every registered vendor
// in registry MODULES order (cerebras → ollama → nvidia → openrouter), so the
// free pool naturally starts with sub-200ms TTFT Cerebras entries and ends
// with the highest-variance OpenRouter free tier. When a vendor's key isn't
// bound, its models stay in the pool but are filtered out at dispatch by
// `dispatchVendor`'s no-key skip — and surfaced as `available: false` in
// `status()` so the admin UI doesn't claim availability for unbound vendors.
// ---------------------------------------------------------------------------

// `autoRoutableModelsByTier` (not `modelsByTier`) is the pool composer: it walks
// the same registry order but DROPS vendors that opt out of auto-routing
// (`autoRoute: false`, currently Ollama). A non-auto-route vendor stays in the
// catalog — reachable via an explicit `ollama/<id>` pin — but is never a model a
// FREE/PRO cascade can silently fall onto. (Fixes: a cloud coding agent cascading
// into `ollama/gpt-oss:120b`, which 400s on the tool payload.)

/**
 * The vendor whose models lead every PAID list. Cloudflare Workers AI bills in
 * "neurons" with the first ~10,000/day FREE, so draining a paid pool through
 * Cloudflare BEFORE any metered vendor makes that overflow effectively free up to
 * the daily allowance. Single source for the lead-vendor choice so the general
 * paid pool and the coding pools never disagree on which vendor to prefer.
 */
export const PAID_LEAD_VENDOR: VendorId = 'cloudflare';

/**
 * Reorder a model pool so `vendor`'s models lead, preserving each group's relative
 * order. Used to surface the free-daily-allowance vendor ({@link PAID_LEAD_VENDOR})
 * first in PAID pools so metered spend is deferred until its allowance is spent.
 * No-op for a vendor with no models in the pool (e.g. an unbound Cloudflare key
 * still leaves the rest of the pool in registry order).
 */
export function leadPoolWithVendor(pool: readonly string[], vendor: VendorId): string[] {
  const lead = pool.filter((m) => vendorForModel(m) === vendor);
  if (lead.length === 0) return [...pool];
  const rest = pool.filter((m) => vendorForModel(m) !== vendor);
  return [...lead, ...rest];
}

/** Auto-routable free-tier model ids across every registered cloud vendor. */
export const FREE_MODEL_POOL: readonly string[] = autoRoutableModelsByTier('FREE');

/**
 * Auto-routable paid-tier model ids (STANDARD / PREMIUM / ULTRA) across vendors,
 * LED BY {@link PAID_LEAD_VENDOR} (Cloudflare) so its free daily neuron allowance
 * is spent before any metered vendor; the remaining paid models follow in registry
 * (TTFT) order.
 */
export const PRO_PAID_MODEL_POOL: readonly string[] =
  leadPoolWithVendor(autoRoutableModelsByTier('STANDARD', 'PREMIUM', 'ULTRA'), PAID_LEAD_VENDOR);

/** Pro tries free first (cost-optimized), falls over to paid. */
export const PRO_MODEL_POOL: readonly string[] = [...FREE_MODEL_POOL, ...PRO_PAID_MODEL_POOL];

/**
 * Curated agentic-coding pool — models that reliably (a) honour multi-turn
 * `tools` / `tool_choice` round-trips AND (b) write competent code. This is the
 * SINGLE SOURCE OF TRUTH for "what can drive a cloud coding agent":
 *   - a cloud execution pins its model from here (see `runCloudToolLoop`),
 *   - the user-facing cloud-agent model picker is filtered to this list,
 *   - `TOOL_CAPABLE_MODELS` / `STRUCTURED_OUTPUT_MODELS` are DERIVED from it,
 * so the picker, the runtime default, and the capability-reorder can never drift
 * apart again (the bug this replaces: the capability sets pinned the retired
 * `anthropic/claude-3.7-sonnet`, scoring every current Anthropic model 0 so it
 * never floated up for a tools request).
 *
 * Ordered best-first across plans: PREMIUM coding models lead (Pro tenants land
 * here), then the strongest FREE tool-capable models as the Free-plan / fallback
 * tail. Every id MUST exist in a vendor catalog — `LlmProxyService.codingPool.test`
 * asserts this so a catalog rename trips CI instead of silently degrading routing.
 */
// Every id below is verified against the live OpenRouter /models API (all are
// tool-capable). The cloud gateway dispatches free runs on the OpenRouter free
// key, so the FREE tail must be real OpenRouter `:free` slugs — NOT vendor-direct
// NIM/Cerebras ids that 404 there. Keep this in sync with the live API, not from
// memory (`LlmProxyService.codingPool.test` asserts every id is in the catalog).
export const CODING_MODEL_POOL: readonly string[] = [
  // PAID, CLOUDFLARE FIRST — every `@cf/*` coder is FREE up to the daily neuron
  // allowance (Cloudflare = PAID_LEAD_VENDOR), so a paid coding run spends that
  // free allowance BEFORE any metered coder. This is also why Anthropic is no
  // longer the lead: the metered coders (OpenRouter-routed Anthropic/OpenAI/etc.)
  // follow the free Cloudflare neurons. All `@cf/*` ids are verified function-
  // calling-capable against the live Cloudflare catalog (see cloudflare.ts).
  //
  // Ordered BIG-CONTEXT-FIRST, not just by quality: a coding context routinely
  // exceeds a small window, so a small-window model leading the pool 413s on the
  // first turn (the 97K-into-32K bug). glm-4.7-flash (128K) leads as the cost-
  // effective big-window coder; kimi (256K) handles the largest contexts; the 32K
  // qwen3-30b is LAST (a 413 there cascades up, see CASCADE_STATUSES).
  '@cf/zai-org/glm-4.7-flash',                 // 128K ctx, STANDARD — big-window coder (Cloudflare) — Pro coding default
  '@cf/moonshotai/kimi-k2.7-code',             // 256K ctx, PREMIUM — frontier code model for huge contexts (Cloudflare)
  '@cf/qwen/qwen3-30b-a3b-fp8',                // 32K ctx, STANDARD — small/fast; great first pass for SMALL tasks
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast',  // 24K ctx, STANDARD — small/fast; great first pass for SMALL tasks
  // PAID, METERED — strong agentic coders reachable by Pro tenants on the credited key.
  'anthropic/claude-sonnet-5',
  'openai/gpt-4.1',
  'xiaomi/mimo-v2.5',                          // Programming #1 on OpenRouter, $0.14/$0.28
  'qwen/qwen3.7-plus',                         // agentic coder + vision, $0.40/$1.60
  'deepseek/deepseek-v4-flash',               // fast cheap coder, $0.10/$0.20
  // FREE — strong agentic coders on the OpenRouter free key (the cloud default).
  // Standardized lead: MiniMax M2.7 on NVIDIA NIM (`minimaxai/minimax-m2.7`).
  // ROLLED BACK from M3 2026-08-17: M3 is the newer generation but its NIM endpoint
  // is presently unreliable — it either 404s or accepts a request and then hangs mid-
  // stream with no error, which the Canvas Brain agentic loop cannot route around
  // (it soft-pins whichever model answers the FIRST tool call for the rest of the
  // turn, so a stall on the pool leader exhausts both retries with no proven
  // fallback and kills the turn — see `creationCanvasAi.ts`'s `switchToProvenModel`).
  // M2.7 is confirmed live on NIM; swap back to M3 once NVIDIA's endpoint stabilizes.
  // This needs NVIDIA_API_KEY bound on the gateway; if it's unbound the NIM default
  // no-key-skips at dispatch and the run fails over to the current OpenRouter `:free`
  // frontier tail below.
  'minimaxai/minimax-m2.7',                   // current free agentic coder (NVIDIA NIM) — standardized default
  'nvidia/nemotron-3-ultra-550b-a55b:free',   // Programming #6, 1M context
  'poolside/laguna-s-2.1:free',               // current flagship coding-agent model
  'cohere/north-mini-code:free',              // code-specialized, 256K context
  'nvidia/nemotron-3-super-120b-a12b:free',   // agentic reasoning fallback
  'google/gemma-4-26b-a4b-it:free',           // multimodal tools + structured output
  'openai/gpt-oss-20b:free',                  // compact tool-capable reliability tail
  // DIRECT-ANTHROPIC reliability floor (NVIDIA-of-last-resort). Served by the
  // `anthropic` vendor on the operator's CLAUDE_API_KEY — a vendor-diverse path
  // independent of OpenRouter. These are `autoRoute: false`, so they never enter a
  // plan pool or the user-facing picker (codingModelsForPlan excludes them); they
  // are listed here ONLY so the cloud loop recognises them as real coders (not a
  // "degraded onto a non-coder" backstop) and so the capability-reorder sets treat
  // them as tool/structured-output capable. Routing onto them happens via
  // CODING_PREMIUM_FALLBACK_MODELS, never auto-selection.
  'claude-sonnet-5',
  'claude-opus-5',
  'claude-opus-4-8',
];

/**
 * Superseded model ids → the live successor the gateway dispatches instead.
 *
 * A pinned model id is DURABLE STATE: it is written onto an agent's `base_model`, a
 * workflow node config, a lane's coding default, and every execution row that ran on
 * it. Vendors ship a new frontier model every few months and eventually 404 the old
 * id — so without a rewrite layer, state pinned months ago starts failing, and the
 * failure surfaces far from its cause (an empty BYO flagship seed reading as "no
 * configured provider is currently usable", never "that model id is retired").
 *
 * This map is that layer, and it is the ONLY place a version bump has to be made:
 * add `old -> new` here and every stored pin, seed constant, and strict dispatch
 * follows on the next request. Entries are chained through {@link canonicalModelId}
 * (a -> b -> c resolves to c), so a bump never requires rewriting earlier rows.
 *
 * Rules for entries:
 *   • Only map WITHIN a vendor and ACROSS a version — never across vendors or tiers
 *     (Opus → Opus, never Opus → Sonnet). A silent tier downgrade is worse than a 404.
 *   • Keep the old id in the vendor CATALOG while the vendor still serves it; this map
 *     changes what we DISPATCH, the catalog changes what we RECOGNISE.
 */
export const SUPERSEDED_MODEL_IDS: Readonly<Record<string, string>> = {
  // Anthropic direct (bare `claude-*` ids on the Messages API).
  'claude-opus-4-8': 'claude-opus-5',
  'claude-opus-4-7': 'claude-opus-5',
  'claude-opus-4-6': 'claude-opus-5',
  'claude-opus-4-5': 'claude-opus-5',
  'claude-opus-4-1': 'claude-opus-5',
  'claude-opus-4-0': 'claude-opus-5',
  'claude-sonnet-4-6': 'claude-sonnet-5',
  'claude-sonnet-4-5': 'claude-sonnet-5',
  'claude-sonnet-4-0': 'claude-sonnet-5',
  // OpenRouter-routed Anthropic slugs share the same supersession. Sonnet only: the
  // OpenRouter catalog carries no Opus slug, and `anthropic/claude-opus-* -> …-sonnet-5`
  // would be a silent TIER DOWNGRADE — worse than a 404, because the run would quietly
  // produce weaker output with nothing in the trace saying the model changed.
  'anthropic/claude-sonnet-4-6': 'anthropic/claude-sonnet-5',
  'anthropic/claude-sonnet-4-5': 'anthropic/claude-sonnet-5',
};

/** Hard ceiling on {@link SUPERSEDED_MODEL_IDS} chain-following — a mis-edit that
 *  introduces a cycle (`a -> b -> a`) must degrade to "return what we have", never
 *  hang the request thread. */
const SUPERSESSION_MAX_HOPS = 8;

/**
 * Resolve a model id through {@link SUPERSEDED_MODEL_IDS} to the id the gateway
 * should actually dispatch. Returns the input unchanged for a live id, an unknown
 * id (the premium OpenRouter long tail is off our catalog by definition and must
 * pass through untouched), or a blank/non-string value.
 *
 * Apply this at every seam where a STORED or CALLER-SUPPLIED model id enters the
 * dispatch path — never to the curated pool constants, which are edited directly.
 * Pure + unit-testable.
 */
export function canonicalModelId(model: string | undefined | null): string {
  const id = typeof model === 'string' ? model.trim() : '';
  if (!id) return '';
  let current = id;
  for (let hop = 0; hop < SUPERSESSION_MAX_HOPS; hop += 1) {
    const next = SUPERSEDED_MODEL_IDS[current];
    if (!next || next === current) return current;
    current = next;
  }
  return current;
}

/**
 * Default driver for a cloud run that has no explicit model selection. The cloud
 * gateway (`ideProxy`) dispatches on the FREE key, so the default must be a model
 * that is actually reachable there — the highest-priority CODING_MODEL_POOL entry
 * that also lives in FREE_MODEL_POOL. Paid coding models stay available via an
 * explicit (strict-pinned) user/agent selection.
 */
export const CODING_DEFAULT_MODEL: string =
  CODING_MODEL_POOL.find((m) => FREE_MODEL_POOL.includes(m)) ?? FREE_MODEL_POOL[0] ?? '';

/**
 * The frontier flagship a single connected provider leads auto-select with — the
 * "premium" model the owner's OWN account serves. NOT a value judgement between
 * vendors: it just maps a connected vendor id → its best in-catalog frontier model,
 * on the DIRECT tenant-keyed route so a resolution is $0 → byo. Anthropic splits by
 * turn shape per the product decision (Opus drives agentic tool-loops, Sonnet drives
 * plain chat). Returns null for a vendor with no mapped flagship. Extend here (one
 * place) when a new BYO provider is added.
 *
 * The OpenAI flagship uses the `direct/<vendor>/` prefix on purpose: a bare
 * `openai/…` id belongs to OpenRouter's `<org>/<slug>` namespace (operator-keyed) —
 * `direct/openai/…` is the only route to the tenant's OWN OpenAI key. `googleai/` is
 * a bespoke prefix already bound to the tenant Google key.
 */
/**
 * The BYO frontier flagship each connected provider leads auto-select with — ONE per
 * vendor (Anthropic splits by turn shape: Opus drives agentic tool-loops, Sonnet plain
 * chat; every other vendor uses one model for both shapes). EVERY id here is a real,
 * tool- and structured-output-capable CODER served on the tenant's OWN key (the
 * `direct/<vendor>/` and bespoke `googleai/` prefixes route to that key, NOT the operator
 * OpenRouter pool — a bare `openai/…` id is OpenRouter's namespace).
 *
 * This map is the SINGLE SOURCE for both {@link providerFrontierFlagship} and the coder-
 * recognition superset {@link RECOGNIZED_CODER_MODELS}: adding a BYO vendor here makes its
 * flagship recognised as a coder automatically. That closes the drift that mislabelled
 * `direct/meta/muse-spark-1.1` (Meta MUSE, a coder) as a "degraded onto a non-coder
 * backstop" — only Anthropic's direct floor had been hand-added to CODING_MODEL_POOL.
 */
const BYO_FRONTIER_FLAGSHIPS: Readonly<Record<string, { agentic: string; chat: string }>> = {
  anthropic: { agentic: 'claude-opus-5', chat: 'claude-sonnet-5' },
  openai:    { agentic: 'direct/openai/gpt-4.1', chat: 'direct/openai/gpt-4.1' },
  'openai-codex': { agentic: 'openai-codex/gpt-5.6-sol', chat: 'openai-codex/gpt-5.6-sol' },
  'xai-oauth': { agentic: 'xai-oauth/grok-4.5', chat: 'xai-oauth/grok-4.5' },
  googleai:  { agentic: 'googleai/gemini-2.5-pro', chat: 'googleai/gemini-2.5-pro' },
  meta:      { agentic: 'direct/meta/muse-spark-1.1', chat: 'direct/meta/muse-spark-1.1' },
  moonshot:  { agentic: 'direct/moonshot/kimi-k2.5', chat: 'direct/moonshot/kimi-k2.5' },
  // A Kimi Code subscription funds a real coder, so a run on it must not report as
  // "degraded onto a non-coder backstop" — which is what its absence here meant, since
  // this map is also the source for RECOGNIZED_CODER_MODELS. It leads auto-select only
  // for a tenant who connected Kimi; when their runtime is offline the edge 403 is a
  // `not_entitled` failover like any other and the cascade moves on.
  'kimi-code': { agentic: 'direct/kimi-code/kimi-for-coding', chat: 'direct/kimi-code/kimi-for-coding' },
  qwen:      { agentic: 'direct/qwen/qwen3-coder-plus', chat: 'direct/qwen/qwen3-max' },
  minimax:   { agentic: 'direct/minimax/MiniMax-M1', chat: 'direct/minimax/MiniMax-Text-01' },
  xai:       { agentic: 'direct/xai/grok-4.5', chat: 'direct/xai/grok-4.5' },
};

function providerFrontierFlagship(vendor: string, agentic: boolean): string | null {
  const f = BYO_FRONTIER_FLAGSHIPS[vendor];
  return f ? (agentic ? f.agentic : f.chat) : null;
}

/**
 * Every BYO frontier coder id (both turn shapes, de-duped) — the connected-account
 * flagships that route only on a tenant's own key and so are (correctly) ABSENT from the
 * auto-routable {@link CODING_MODEL_POOL}. Folded into {@link RECOGNIZED_CODER_MODELS}.
 */
export const BYO_FRONTIER_CODERS: readonly string[] = [
  ...new Set(Object.values(BYO_FRONTIER_FLAGSHIPS).flatMap((f) => [f.agentic, f.chat])),
];

/**
 * The ONE set of models the runtime recognises as real CODERS (tool- + structured-
 * output-capable): the auto-routable {@link CODING_MODEL_POOL} PLUS the BYO frontier
 * flagships ({@link BYO_FRONTIER_CODERS}) that only route on a tenant's own key. The
 * degradation check (`isCodingModelDegraded`), the seed "is this a coder" trace, and the
 * tool/structured-output capability sets all derive from THIS — so a connected-account
 * coding run (e.g. `direct/meta/muse-spark-1.1`) is never mislabelled a non-coder
 * backstop. DISTINCT from CODING_MODEL_POOL, which stays the AUTO-ROUTE/selection pool
 * (plan ordering + `codingModelsForPlan` are unchanged; recognition simply widens).
 */
export const RECOGNIZED_CODER_MODELS: ReadonlySet<string> = new Set<string>([
  ...CODING_MODEL_POOL,
  ...BYO_FRONTIER_CODERS,
]);

/** Best-first rank of a model's catalog tier (ULTRA → PREMIUM → STANDARD → FREE),
 *  used to order the connected providers' flagships by frontier strength from catalog
 *  DATA rather than a hardcoded vendor hierarchy. Unknown tier sorts last. */
function frontierTierRank(model: string): number {
  const order: Record<string, number> = { ULTRA: 0, PREMIUM: 1, STANDARD: 2, FREE: 3 };
  return order[tierForModel(model)] ?? 4;
}

/**
 * The connected owner's OWN premium frontier models to lead auto-select with — ONE
 * flagship per connected provider, so an auto-select turn (no explicit model) uses the
 * owner's account(s) before the free/paid gateway tiers (the "connect your account →
 * it gets used" guarantee the settings/api-keys UI implies).
 *
 * Purely REGISTRATION-DRIVEN and multi-provider: it reflects exactly what the tenant
 * connected — connect only OpenAI → GPT leads; connect all three → all three frontier
 * flagships lead. Ordering: the tenant's own BYO PRECEDENCE (`opts.vendorPriority`,
 * most-preferred gateway vendor id first — e.g. Meta first) wins, with catalog TIER
 * (ULTRA → PREMIUM → STANDARD) as the tiebreak for un-ranked vendors. With no precedence
 * set it degrades to pure tier order (the prior behaviour). The cascade then fails over
 * across the owner's OTHER connected accounts in that order before ever touching a
 * free/paid pool model. It is a SOFT seed: the plan pool stays behind the list as fallback.
 *
 * `byoVendors` is the gateway VENDOR-id set the tenant can serve from their own
 * account (see `byoVendorIdsFromCredentials` / the proxy's connected set). Returns `[]` when
 * nothing is connected — plan routing is then unchanged. Single source both the
 * gateway completion seed ({@link LlmProxyService.complete}) and the cloud-agent pin
 * ({@link pickCloudModel}, which leads with `[0]`) use, so the surfaces never diverge.
 * Every id is a real catalog entry on its direct vendor (`byo` → $0), asserted in
 * `LlmProxyService.codingPool.test`.
 */
export function byoAutoSeedModels(
  byoVendors: ReadonlySet<string> | null | undefined,
  opts: { agentic: boolean; vendorPriority?: readonly string[]; demotedVendors?: ReadonlySet<string> },
): string[] {
  if (!byoVendors || byoVendors.size === 0) return [];
  const flagships = [...byoVendors]
    .map((v) => providerFrontierFlagship(v, opts.agentic))
    .filter((m): m is string => m !== null && isDispatchableSeed(m));
  // TENANT PRECEDENCE first, catalog tier as tiebreak. `vendorPriority` is the tenant's
  // ordered gateway vendor ids (most-preferred first — e.g. Meta first); a flagship's
  // vendor is matched via vendorForModel so `direct/meta/…` → 'meta' lines up. A vendor
  // NOT in the list sorts after every ranked one (Infinity), then falls back to tier —
  // so with NO precedence set this is exactly the prior tier-only order. Array.prototype
  // .sort is stable in V8, so equal keys keep the connected-set iteration order.
  const priority = opts.vendorPriority ?? [];
  // A vendor NOT in the precedence ranks AFTER every ranked one — but with a FINITE
  // sentinel (`priority.length`), not Infinity: two un-ranked vendors must compare
  // EQUAL (rank − rank = 0 → tier tiebreak), and Infinity − Infinity is NaN, which
  // corrupts Array.sort. With no precedence set every rank is 0 → pure tier order.
  const priorityRank = (m: string): number => {
    const i = priority.indexOf(vendorForModel(m));
    return i === -1 ? priority.length : i;
  };
  // UPSTREAM HEALTH is the OUTERMOST sort key — it outranks tenant precedence.
  //
  // This is not a precedence override; it is what makes precedence usable. A
  // vendor on a 5xx streak (see `vendorHealth`) still gets called, still ahead of
  // the plan pool, and still first when it is the ONLY connected account — but it
  // stops LEADING while it is faulting, because leading is precisely what costs a
  // full vendor timeout on every cascade before anything else is tried. Honouring
  // "Meta first" literally through a Meta outage means every request pays 25s to
  // reach the account the tenant would have picked second anyway.
  //
  // Distinct from the COST cooldown by design: that gate REMOVES a capped/broken
  // vendor from the chain, this only REORDERS a healthy-but-flaky one. A demoted
  // vendor clears on its next successful call, not on a timer.
  const demoted = opts.demotedVendors;
  const healthRank = (m: string): number => (demoted?.has(vendorForModel(m)) ? 1 : 0);
  return flagships.sort((a, b) => {
    const h = healthRank(a) - healthRank(b);
    if (h !== 0) return h;
    const p = priorityRank(a) - priorityRank(b);
    if (p !== 0) return p;
    return frontierTierRank(a) - frontierTierRank(b);
  });
}

/** Registered OpenRouter connection refs (`openrouter/<org>/<slug>`), in either shape. */
export type ModelRefs = ReadonlySet<string> | readonly string[] | null | undefined;

/** Membership test that accepts either shape a caller already holds — the proxy keeps
 *  the registered refs as a Set, the credentials resolver as an array — so neither has
 *  to allocate a copy on the hot path just to ask this question. */
function refsHave(refs: ModelRefs, id: string): boolean {
  if (!refs) return false;
  // `Array.isArray` does not narrow a `readonly string[]` union member, so discriminate
  // on the Set surface instead — which is also the cheaper check for the hot-path shape.
  return refs instanceof Set ? refs.has(id) : (refs as readonly string[]).includes(id);
}

function refsCount(refs: ModelRefs): number {
  if (!refs) return 0;
  return refs instanceof Set ? refs.size : (refs as readonly string[]).length;
}

/**
 * Does an explicit model choice preempt the tenant's connected-BYO auto-seed?
 *
 * Connecting your own frontier account is a strong "use MY account" signal, so it
 * leads auto-select UNLESS the explicit model is a deliberate choice ON that account.
 * Returns true (honor the explicit model) when:
 *   • the tenant has NOTHING rankable — no connected provider AND no registered
 *     OpenRouter connection — so normal plan routing applies, OR
 *   • the explicit model is itself served by a connected BYO vendor, OR is one of the
 *     tenant's REGISTERED OpenRouter connection refs (both are deliberate picks on the
 *     owner's own list — e.g. they connected Claude AND pinned claude-opus).
 * Returns false (let the tenant's own precedence lead) for a NON-BYO explicit model
 * while anything is connected — e.g. a default agent base model of `@cf/qwen` must NOT
 * shadow a connected Claude subscription (the exact bug where Ada ran on `@cf/qwen`
 * despite a live subscription).
 *
 * `registeredModels` is load-bearing, not an optimisation. An OpenRouter CONNECTION
 * (0382) contributes no provider row and therefore no BYO *vendor*, so a rule that only
 * consults `byoVendors` is blind to it in BOTH directions: a deliberately-pinned
 * connection ref gets discarded as "not BYO", and a tenant whose ONLY rankable account is
 * a connection has every stale caller default treated as preempting. Both are how a
 * precedence list with an OpenRouter connection at #1 could be silently ignored.
 *
 * This is the SINGLE branching rule the gateway seed ({@link LlmProxyService.complete}),
 * the cloud pin ({@link pickCloudModel}), `byoAwareModel` and the Brain addressed-reply
 * path share, so "the tenant's own account wins over a non-BYO pin" can never drift
 * between the surfaces again.
 */
export function explicitModelPreemptsByo(
  explicit: string | undefined | null,
  byoVendors: ReadonlySet<string> | null | undefined,
  registeredModels?: ModelRefs,
): boolean {
  const trimmed = typeof explicit === 'string' ? explicit.trim() : '';
  if (!trimmed) return false;
  if (refsHave(registeredModels, trimmed)) return true;
  const rankable = (byoVendors?.size ?? 0) + refsCount(registeredModels);
  if (rankable === 0) return true;
  return !!byoVendors?.has(vendorForModel(trimmed));
}

/**
 * A {@link byoAutoSeedModels} output is dispatchable when it's a known bare catalog id
 * (the Anthropic direct ids `claude-*`) OR a vendor-prefixed id (`direct/openai/…`,
 * `googleai/…`) whose PREFIX-STRIPPED model id is a real catalog entry — `isKnownModel`
 * alone looks up the bare index and would false-negative the prefixed BYO seeds.
 * Guards the seed list against a drifted flagship constant. Asserted in
 * `LlmProxyService.codingPool.test`.
 */
export function isDispatchableSeed(id: string): boolean {
  if (isKnownModel(id)) return true;
  const parsed = parseVendorPrefix(id);
  return !!parsed && isKnownModel(parsed.modelId);
}

/**
 * True when `model` is a real catalog id (any vendor, any tier). Callers that
 * hard-pin a model (`modelStrict`) use this to avoid enforcing a typo'd / retired
 * id — which would 503 with no failover — and fall back to a safe default instead.
 */
export function isKnownModel(model: string | undefined): boolean {
  return typeof model === 'string' && model.trim().length > 0 && catalogEntry(model.trim()) !== null;
}

/**
 * Canonical strict-pin resolver — the single source of truth for "did this
 * request ask to hard-pin its model?" Both the request body (`modelStrict`
 * — the gateway-internal flag cloud coding agents set, OR `strict` — the
 * public SDK alias) and an optional `?strict=true` query param feed in here.
 *
 * Strict pin only applies when a non-empty `model` is also present; without a
 * named model there's nothing to pin, so it's a no-op (the gateway routes
 * by shape as usual). Callers normalize via this helper so the entitlement
 * gate, `complete()`'s dispatch branch, and the trace logger never diverge on
 * what counts as strict.
 */
export function resolveStrictPin(
  body: { model?: unknown; modelStrict?: unknown; strict?: unknown },
  queryStrict?: boolean,
): boolean {
  const hasModel = typeof body.model === 'string' && body.model.length > 0;
  if (!hasModel) return false;
  return body.modelStrict === true || body.strict === true || queryStrict === true;
}

/**
 * Per-request inner-timeout override — lets a NON-premium tenant opt a single
 * long call into the extended vendor budget without flipping plans or premium
 * routing. Carried as `body._builderforce.vendorTimeoutMs` (the gateway-internal
 * passthrough envelope, stripped before vendor dispatch).
 *
 * Returns the requested value clamped to `(0, MAX_VENDOR_CALL_TIMEOUT_MS]`, or
 * `undefined` when absent / non-positive / non-numeric — in which case the
 * caller falls back to the proxy's configured `vendorCallTimeoutMs` (plan
 * default). The clamp keeps a one-off override from holding a Worker isolate
 * open longer than the premium path's own ceiling.
 */
export function resolveVendorTimeoutOverride(
  body: Record<string, unknown>,
): number | undefined {
  const envelope = body['_builderforce'];
  if (!envelope || typeof envelope !== 'object') return undefined;
  const raw = (envelope as Record<string, unknown>).vendorTimeoutMs;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.min(Math.floor(n), MAX_VENDOR_CALL_TIMEOUT_MS);
}

/**
 * Per-request prompt-cache retention opt-in — lets a bursty tenant with a large
 * stable prefix keep it warm across idle gaps longer than the 5-minute ephemeral
 * default. Carried as `body._builderforce.cacheTtl` ('1h'); any other value
 * (including absent) resolves to the 5-minute default. Honoured only for
 * caching-capable (Anthropic-family) models by the OpenRouter vendor module —
 * see promptCaching.ts. Returns `'1h'` or `undefined` (= default 5m).
 */
export function resolveCacheTtl(body: Record<string, unknown>): '1h' | undefined {
  const envelope = body['_builderforce'];
  if (!envelope || typeof envelope !== 'object') return undefined;
  return (envelope as Record<string, unknown>).cacheTtl === '1h' ? '1h' : undefined;
}

/**
 * Premium routing pool — top PREMIUM-tier models only, used when a tenant has
 * `premium_override` set. Skips FREE and STANDARD entirely so a single attempt
 * lands on a high-quality model. Three candidates so the cascade has fallback
 * room within the extended outer budget (180s SDK / 60s per-vendor).
 *
 * Derived from `modelsByTier('PREMIUM')` so adding a new PREMIUM model to any
 * vendor catalog automatically extends the candidate list — and the first three
 * in registry order become the active premium cascade.
 */
const PREMIUM_PRIORITY_COUNT = 3;
export const PREMIUM_PRIORITY_POOL: readonly string[] =
  autoRoutableModelsByTier('PREMIUM').slice(0, PREMIUM_PRIORITY_COUNT);

/**
 * Per-vendor-call timeout for premium routing. PREMIUM-tier models on long-
 * context inputs (resume tailoring, structured job extraction) routinely take
 * 30-50s end-to-end; the default 25s budget kills these prematurely. Paired
 * with the extended SDK outer budget so all three premium candidates can be
 * tried within one request.
 */
export const PREMIUM_VENDOR_CALL_TIMEOUT_MS = 60_000;

/**
 * Per-vendor-call timeout for the FREE plan. Free-tier upstreams that haven't
 * started streaming within ~15s are, empirically, going to burn the full 25s
 * default and time out anyway (see the all-`408` free attempts in trace
 * `llm-71b468dd-...`, 2026-06-07). Shrinking the per-attempt budget lets a
 * saturated free pool fail fast so the request reaches the guaranteed paid
 * backstop within the caller's deadline instead of spending 2×25s up front.
 * Paid/premium routing keeps the longer budget — those calls are worth waiting
 * for. The backstop itself overrides this with `PREMIUM_VENDOR_CALL_TIMEOUT_MS`.
 */
export const FREE_VENDOR_CALL_TIMEOUT_MS = 15_000;

/**
 * Guaranteed paid backstop — a single low-cost, low-variance paid model
 * dispatched on the *credited* (Pro) OpenRouter key after the primary cascade
 * fails (or every candidate is on cooldown), regardless of the request's plan.
 *
 * Why this exists separately from `PREMIUM_FALLBACK_MODELS`: that chain runs on
 * whatever key the plan resolves to. On the FREE plan that's the free
 * OpenRouter key, which may lack the credit to actually pay for the paid Gemini
 * entry — so the only "safety net" 402s and the request hard-fails (the
 * `AI_UNAVAILABLE` symptom on hired.video's tailor endpoint). The backstop
 * closes that hole: Builderforce funds this one cheap call (~$0.0001) as the
 * reliability floor so a saturated free pool never surfaces a hard failure.
 */
// Credited OpenRouter safety net after the zero-priced pool is exhausted.
// Muse Glimmer is intentionally NOT in a FREE catalog tier: the live endpoint
// costs $0.35/M input and $1.50/M output, so it must remain paid-overflow only.
export const GUARANTEED_BACKSTOP_MODEL = 'meta/muse-glimmer-30b';

/**
 * Cheapest reliable paid coder — the head of the coding reliability floor and the
 * ONLY coding model treated as paid-overflow by id (see `PAID_OVERFLOW_MODELS`).
 * A `CODING_MODEL_POOL` member reachable on the credited OpenRouter key.
 */
export const CHEAPEST_PAID_CODER = 'deepseek/deepseek-v4-flash'; // $0.10/$0.20

/**
 * Coding-capable premium fallback chain — the coding analogue of
 * `PREMIUM_FALLBACK_MODELS`. A coding run must NEVER fall through to a general
 * non-coder (the gemini-flash family loops on search and ships no edits — see
 * execution #59), so when the curated coding pool is exhausted the cascade
 * escalates to *paid coders* on the credited key instead of the non-coder gemini
 * chain. Vendor-diverse (Cloudflare / DeepSeek / Xiaomi / Anthropic) so one
 * upstream outage doesn't sink the floor. Every id is a paid `CODING_MODEL_POOL`
 * member, so `LlmProxyService.codingPool.test` trips if a rename drifts it off
 * catalog.
 *
 * `leadPoolWithVendor(…, PAID_LEAD_VENDOR)` floats the Cloudflare coder to the
 * head: its first ~10K neurons/day are free, so an exhausted coding cascade spends
 * that allowance before any metered coder. The remaining entries stay cheapest-
 * reliable-first (DeepSeek → Xiaomi → OpenRouter-routed Claude), then the
 * DIRECT-ANTHROPIC last-resort floor: the OpenRouter-routed coders all share
 * OpenRouter's availability, so an OpenRouter-wide outage sinks them together —
 * `claude-sonnet-5` / `claude-opus-5` call Claude DIRECTLY on CLAUDE_API_KEY
 * (independent availability), Sonnet first (cheaper). Any vendor whose key is
 * unbound no-key-skips at dispatch, so the chain degrades cleanly to whatever is
 * reachable and surfaces an honest exhaustion only if nothing is.
 */
export const CODING_PREMIUM_FALLBACK_MODELS: readonly string[] = leadPoolWithVendor([
  CHEAPEST_PAID_CODER,           // $0.10/$0.20 — cheapest reliable paid coder (OpenRouter)
  'xiaomi/mimo-v2.5',            // $0.14/$0.28 — OpenRouter Programming #1
  // Cloudflare Workers AI coders — FREE up to the daily neuron allowance; `leadPoolWithVendor`
  // floats all of these to the head so the free neurons are spent before any metered coder.
  // Ordered FAST-FIRST behind a big-window lead: glm-4.7-flash (128K) leads — it fits the
  // cloud loop's compacted (~15-20K) contexts and is the cost-effective big-window coder;
  // the small/fast qwen (32K) + llama (24K) are the quick failovers (a fast 413 there just
  // cascades). The 256K kimi is LAST among the CF coders: it is the slowest by far — a
  // single completion ran 93s and got a live durable tick orphan-reaped (execution #136) —
  // so it is reached only when a genuinely huge (>128K) context needs it, never auto-picked
  // ahead of a faster coder for a normal turn.
  '@cf/zai-org/glm-4.7-flash',                 // 128K ctx — big-window lead
  '@cf/qwen/qwen3-30b-a3b-fp8',                // 32K ctx — small/fast failover
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast',  // 24K ctx — small/fast failover
  '@cf/moonshotai/kimi-k2.7-code',             // 256K ctx — slowest; huge-context last resort
  'anthropic/claude-sonnet-5',   // strongest agentic coder (via OpenRouter)
  'claude-sonnet-5',             // direct-Anthropic last-resort floor (CLAUDE_API_KEY)
  'claude-opus-5',
], PAID_LEAD_VENDOR);

/**
 * Coding-capable backstop chain — the reliability floor for a *coding* run,
 * dispatched on the credited key after the primary coding cascade fails.
 *
 * `GUARANTEED_BACKSTOP_MODEL` (Muse Glimmer 30B) is a general agentic model,
 * but it is not part of the curated coding pool. Flooring a coding run onto a
 * non-coder means the run flails and gives up without writing code (observed in
 * execution #59), so the coding floor is *coders only* — no general backstop
 * tail. If every paid coder is also down the run surfaces `cascade_exhausted`
 * rather than silently degrading onto a non-coder, because an honest failure
 * beats a coding agent that loops on search and ships nothing.
 */
export const CODING_BACKSTOP_MODELS: readonly string[] = CODING_PREMIUM_FALLBACK_MODELS;

/**
 * Premium fallback chain — appended to *every* non-strict candidate chain so a
 * fully-saturated free pool never surfaces an `LLM_UNAVAILABLE` / cascade-
 * exhausted 429 to the caller. Direct Google AI (`googleai/*`) is tried first
 * because it has the lowest variance and isn't subject to OpenRouter's shared
 * rate limits; the OpenRouter Gemini entry is the vendor-diverse backup so a
 * Google AI outage still resolves through a different upstream.
 *
 * Each entry is skipped at chain-build time when its vendor key is unbound or
 * the model is on cooldown.
 */
export const PREMIUM_FALLBACK_MODELS: readonly string[] = [
  'googleai/gemini-2.5-flash',
  'googleai/gemini-2.5-flash-lite',
  'google/gemini-2.5-flash-lite', // via OpenRouter — vendor-diverse backup
];

/**
 * Paid-overflow model set — the models Builderforce funds on its OWN keys when a
 * tenant's primary cascade is exhausted: the premium fallback chain, the general
 * reliability backstop, and the cheap coding floor (`CHEAPEST_PAID_CODER`). A
 * usage row resolved to one of these is "overflow spend" — metered against a
 * per-tenant daily $ cap so a Free tenant in a tight retry loop can't run up
 * arbitrary spend on our keys (the cap is enforced in the gateway route; see
 * `paid_overflow_daily_cap`).
 *
 * By-id detection is deliberately conservative here: the *stronger* coding-floor
 * coders (`xiaomi/mimo-v2.5`, `anthropic/claude-sonnet-5`) are Pro plan-pool
 * models, so flagging them by id would mis-meter a Pro tenant's legitimate plan
 * usage as overflow. Their genuine overflow case — resolving via the funded
 * coding *backstop* — is metered directly by `complete()` (which sets
 * `paidOverflow = true` on any backstop hit), not by this set. Every id that IS
 * in this set resolves only via the funded path (the gemini fallbacks live in no
 * plan pool; `CHEAPEST_PAID_CODER` is the historically-funded coding floor).
 */
export const PAID_OVERFLOW_MODELS: ReadonlySet<string> = new Set<string>([
  ...PREMIUM_FALLBACK_MODELS,
  CHEAPEST_PAID_CODER,
  GUARANTEED_BACKSTOP_MODEL,
  // Direct-Anthropic floor — unlike `anthropic/claude-sonnet-5` (a Pro plan-pool
  // model whose normal use must NOT be metered as overflow), these bare-id direct
  // models live in NO plan pool: any resolution onto them is Builderforce funding a
  // call on its own CLAUDE_API_KEY, so they are overflow spend by id on every path
  // (primary appended-fallback OR credited backstop) and count against the cap.
  'claude-sonnet-5',
  'claude-opus-5',
  // Superseded but still catalogued (see the Anthropic CATALOG note): a run that
  // resolves onto one is still Builderforce funding its own key, so it stays overflow.
  'claude-opus-4-8',
]);

/** True when `model` resolved via the funded overflow path (premium fallback or
 *  a reliability-floor backstop) — i.e. Builderforce paid for it, not the tenant
 *  via their plan pool. Drives the `paid_overflow` usage flag + per-tenant cap. */
export function isPaidOverflowModel(model: string | undefined | null): boolean {
  return model != null && PAID_OVERFLOW_MODELS.has(model);
}

/**
 * Maximum number of FREE-tier attempts the cascade walks before falling through
 * to the premium fallback chain. Caps "we cycled 20 free models and still
 * 429'd" failure modes: every request now ends with at most 2 free attempts +
 * the premium fallback list, so callers reliably get a successful response
 * even when the free pool is saturated.
 *
 * Non-FREE models in the seed (Pro/Teams paid models, premium-priority routing)
 * are not affected by this cap — they're kept verbatim in the chain so paying
 * tenants still get the models their plan unlocks.
 */
export const FREE_ATTEMPT_BUDGET = 2;

/**
 * Pro/Teams free-tier breadth: paying tenants try MORE free models before the
 * cascade escalates to their paid premium pool. The 2-attempt cap above is
 * tuned for latency-sensitive Free-plan traffic (reach the guaranteed paid
 * backstop fast); a Pro tenant who is *already paying* benefits more from extra
 * free-tier coverage (a wider shot at a $0 model) than from a few hundred ms of
 * latency. Still bounded so the cascade can't walk the whole 40-model free pool.
 */
export const PRO_FREE_ATTEMPT_BUDGET = 5;

/**
 * Plan-aware general FREE-attempt budget (NON-coding). Free → the latency-tuned
 * 2; Pro/Teams → the wider {@link PRO_FREE_ATTEMPT_BUDGET}. Single source so the
 * proxy factory doesn't hardcode the constant — closes the "Pro plan's free-tier
 * section is also capped at 2 attempts, no Pro-specific carve-out" gap.
 *
 * Coding runs are unaffected: they pass `CODING_FREE_ATTEMPT_BUDGET` (the whole
 * free coding pool) explicitly and never consult this.
 */
export function freeAttemptBudgetForPlan(effectivePlan: EffectivePlan): number {
  return effectivePlan === 'free' ? FREE_ATTEMPT_BUDGET : PRO_FREE_ATTEMPT_BUDGET;
}

/**
 * FREE-attempt budget for a CODING run — deliberately the WHOLE free coding pool,
 * not the 2-attempt general cap.
 *
 * A coding run is a long-lived background job (container / durable loop, ~180s
 * outer budget), so unlike an interactive request it values COST over a few
 * seconds of latency. The general 2-attempt cap escalates to PAID coders — and
 * ultimately the funded direct-Anthropic floor on a METERED key — after only two
 * free coders, which is how a $10 Anthropic cap got drained while ~9 free coders
 * (minimax / glm / nemotron / qwen-coder / …) sat untried. Budgeting the entire
 * free coding pool means every free coder is attempted BEFORE any paid coder, so
 * the metered floor is genuinely last-resort (10+ models tried first), not a
 * second-attempt default.
 *
 * Derived from the pool so it tracks automatically as free coders are added.
 */
export const CODING_FREE_ATTEMPT_BUDGET: number =
  CODING_MODEL_POOL.filter((m) => FREE_MODEL_POOL.includes(m)).length;

/** First N models of the active pool form the round-robin "preferred" group.
 *  Aligned with FREE_ATTEMPT_BUDGET so the round-robin window matches the cap. */
export const PREFERRED_POOL_SIZE = 2;

/**
 * Hard cap on how many seed models get a cooldown KV read up-front.
 *
 * The model pool can contain 40+ FREE entries across all vendors. Without this
 * cap, every `complete()` call issued one KV `get` per pool entry just to
 * prefetch cooldown state — ~50 subrequests *before* the first vendor fetch.
 * Cloudflare's per-invocation subrequest cap (50 free / 1000 paid) was being
 * exhausted by the bookkeeping path alone (production trace
 * `llm-2cc6ba1b-...`, 2026-05-26: cooldown reads + 6 vendor attempts =
 * cascade collapse with `Too many subrequests by single Worker invocation`).
 *
 * Why 12: `FREE_ATTEMPT_BUDGET` (=2) + `PREMIUM_FALLBACK_MODELS.length` (3) +
 * caller-pinned hint (1) is the minimum the chain composer can use; 12 leaves
 * headroom for ~6 cooled-and-skipped FREE entries before the composer's
 * walking-the-pool-looking-for-non-cooled loop runs dry — which is far more
 * skips than we've ever observed simultaneously, since cooldowns expire on
 * 5–30 minute windows. The shape-reorder + caller-hint prefix ensures the
 * 12 entries actually queried are the most likely to be tried.
 *
 * Trade-off: a model past index 12 that *is* cooled won't be filtered out of
 * the chain composer's view, so it could be attempted at dispatch time and
 * fail. The dispatcher records the failure and re-cools the model — the next
 * request sees the cooldown if the same model lands in the leading 12. Net
 * effect: a one-request lag on a stale cooldown, in exchange for a hard
 * upper bound on KV subrequests per gateway call.
 */
export const COOLDOWN_PREFETCH_LIMIT = 12;
